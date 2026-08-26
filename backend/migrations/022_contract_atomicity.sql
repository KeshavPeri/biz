-- ============================================================
-- 022_contract_atomicity.sql
-- Phase 9 tasks 9.11/9.12: retry-safe contract generation, append-only
-- signatures, atomic maker-checker release, and private wet-sign uploads.
--
-- PDF rendering/upload necessarily happens outside Postgres. The routines below
-- make each database boundary atomic and idempotent so a retry can safely finish
-- file work without duplicating a contract, signature, audit event, or stage
-- transition. No existing application data is deleted.
-- ============================================================

-- One platform-generated v1 row, one signer record per person, and exactly one
-- signature for each side. These also close concurrent double-tap races.
CREATE UNIQUE INDEX IF NOT EXISTS contract_signatures_contract_signer_unique
    ON contract_signatures (contract_id, signer_id);

CREATE UNIQUE INDEX IF NOT EXISTS contract_signatures_creator_side_unique
    ON contract_signatures (contract_id)
    WHERE on_behalf_of_brand_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contract_signatures_brand_side_unique
    ON contract_signatures (contract_id)
    WHERE on_behalf_of_brand_id IS NOT NULL;

-- A deal can have only one live held contract-signing action. A rejected request
-- falls out of this index, allowing the maker to correct and retry.
CREATE UNIQUE INDEX IF NOT EXISTS maker_checker_one_pending_contract_signing_unique
    ON maker_checker_requests (deal_id, action_type)
    WHERE status = 'pending' AND action_type = 'contract_signing';

ALTER TABLE contract_signatures
    ADD CONSTRAINT contract_signatures_mode_payload_check
    CHECK (
        (signature_mode IN ('stored', 'drawn') AND bypass_reason IS NULL AND physical_doc_path IS NULL)
        OR
        (signature_mode = 'print_bypass' AND length(btrim(bypass_reason)) BETWEEN 3 AND 500
         AND physical_doc_path IS NOT NULL)
    ) NOT VALID;

ALTER TABLE contract_signatures VALIDATE CONSTRAINT contract_signatures_mode_payload_check;

-- Migration 020 allowed any participant to upload into another participant's
-- wet-sign folder. Replace it with an owner-folder policy and add recoverable
-- cleanup for a failed/abandoned upload.
DROP POLICY IF EXISTS "contracts_participant_wet_upload" ON storage.objects;
CREATE POLICY "contracts_participant_wet_upload"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'contracts'
        AND is_deal_participant((storage.foldername(name))[1]::uuid)
        AND (storage.foldername(name))[3] = 'wet-signatures'
        AND (storage.foldername(name))[4] = auth.uid()::text
        AND lower(storage.extension(name)) = 'pdf'
    );

CREATE POLICY "contracts_participant_wet_delete_own"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'contracts'
        AND is_deal_participant((storage.foldername(name))[1]::uuid)
        AND (storage.foldername(name))[3] = 'wet-signatures'
        AND (storage.foldername(name))[4] = auth.uid()::text
        AND lower(storage.extension(name)) = 'pdf'
    );

-- Reserve or recover the single v1 contract under a deal-row lock. The approved
-- summary is selected inside the same transaction, so generation can never be
-- based on an unapproved or raced summary.
CREATE OR REPLACE FUNCTION reserve_contract_v1(
    p_deal_id uuid,
    p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_stage deal_stage_enum;
    v_summary_id uuid;
    v_contract contracts%ROWTYPE;
    v_created boolean := false;
BEGIN
    SELECT stage INTO v_stage
      FROM deals
     WHERE id = p_deal_id AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'deal_not_found';
    ELSIF v_stage <> 'approval' THEN
        RAISE EXCEPTION 'deal_not_in_approval';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM deal_participants
         WHERE deal_id = p_deal_id AND profile_id = p_actor_id
    ) THEN
        RAISE EXCEPTION 'not_participant';
    END IF;

    SELECT id INTO v_summary_id
      FROM ai_summaries
     WHERE deal_id = p_deal_id AND status = 'approved'
     ORDER BY generated_at DESC, id DESC
     LIMIT 1;

    IF v_summary_id IS NULL THEN
        RAISE EXCEPTION 'approved_summary_required';
    END IF;

    INSERT INTO contracts (
        deal_id, version, storage_path, generated_from_summary_id, status
    ) VALUES (
        p_deal_id, 1, '', v_summary_id, 'draft'
    )
    ON CONFLICT (deal_id, version) DO NOTHING
    RETURNING * INTO v_contract;

    IF FOUND THEN
        v_created := true;
    ELSE
        SELECT * INTO v_contract
          FROM contracts
         WHERE deal_id = p_deal_id AND version = 1;
    END IF;

    RETURN jsonb_build_object(
        'created', v_created,
        'contract', to_jsonb(v_contract)
    );
END;
$$;

-- Publish a successfully uploaded draft and its audit row exactly once.
CREATE OR REPLACE FUNCTION complete_contract_generation(
    p_contract_id uuid,
    p_actor_id uuid,
    p_storage_path text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_contract contracts%ROWTYPE;
BEGIN
    SELECT * INTO v_contract FROM contracts WHERE id = p_contract_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found'; END IF;

    IF v_contract.status = 'draft' THEN
        UPDATE contracts
           SET storage_path = p_storage_path, status = 'awaiting_signatures'
         WHERE id = p_contract_id
         RETURNING * INTO v_contract;

        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (
            p_actor_id, 'contract_generated', 'deal', v_contract.deal_id,
            jsonb_build_object('contract_id', v_contract.id, 'version', v_contract.version),
            p_ip_address
        );
    END IF;

    RETURN to_jsonb(v_contract);
END;
$$;

-- Apply a creator or ungated brand signature and its immutable audit record in
-- one transaction. The service validates payload bytes; constraints/locks own
-- the concurrency boundary.
CREATE OR REPLACE FUNCTION apply_contract_signature(
    p_deal_id uuid,
    p_contract_id uuid,
    p_signer_id uuid,
    p_on_behalf_of_brand_id uuid,
    p_signature_mode text,
    p_signature_ref text,
    p_bypass_reason text,
    p_physical_doc_path text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_contract contracts%ROWTYPE;
    v_deal deals%ROWTYPE;
    v_signature contract_signatures%ROWTYPE;
BEGIN
    SELECT * INTO v_contract FROM contracts WHERE id = p_contract_id FOR UPDATE;
    IF NOT FOUND OR v_contract.deal_id <> p_deal_id THEN RAISE EXCEPTION 'contract_not_found'; END IF;

    SELECT * INTO v_deal FROM deals WHERE id = p_deal_id AND deleted_at IS NULL;
    IF NOT FOUND OR v_deal.stage <> 'approval' OR v_contract.status <> 'awaiting_signatures' THEN
        RAISE EXCEPTION 'contract_not_awaiting_signatures';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM deal_participants
         WHERE deal_id = p_deal_id AND profile_id = p_signer_id
    ) THEN RAISE EXCEPTION 'not_participant'; END IF;

    INSERT INTO contract_signatures (
        contract_id, signer_id, on_behalf_of_brand_id, signature_mode,
        signature_ref, bypass_reason, physical_doc_path, ip_address
    ) VALUES (
        p_contract_id, p_signer_id, p_on_behalf_of_brand_id,
        p_signature_mode::signature_mode_enum, p_signature_ref,
        p_bypass_reason, p_physical_doc_path, p_ip_address
    ) RETURNING * INTO v_signature;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_signer_id, 'contract_signature_applied', 'deal', p_deal_id,
        jsonb_build_object(
            'contract_id', p_contract_id,
            'signature_id', v_signature.id,
            'mode', p_signature_mode,
            'side', CASE WHEN p_on_behalf_of_brand_id IS NULL THEN 'creator' ELSE 'brand' END,
            'wet_signed_upload', p_physical_doc_path IS NOT NULL
        ),
        p_ip_address
    );

    RETURN to_jsonb(v_signature);
END;
$$;

-- Contract-signing checker decisions are special because approval must release
-- the maker's held signature in the SAME transaction. Rejection inserts none.
CREATE OR REPLACE FUNCTION decide_contract_signing_request(
    p_request_id uuid,
    p_checker_id uuid,
    p_decision text,
    p_comment text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_request maker_checker_requests%ROWTYPE;
    v_payload jsonb;
    v_contract contracts%ROWTYPE;
    v_deal deals%ROWTYPE;
    v_signature contract_signatures%ROWTYPE;
    v_new_status maker_checker_status_enum;
BEGIN
    SELECT * INTO v_request
      FROM maker_checker_requests
     WHERE id = p_request_id
     FOR UPDATE;

    IF NOT FOUND OR v_request.action_type <> 'contract_signing' THEN
        RAISE EXCEPTION 'approval_request_not_found';
    ELSIF v_request.status <> 'pending' THEN
        RETURN jsonb_build_object(
            'status', v_request.status,
            'request_id', v_request.id,
            'already_decided', true,
            'signature_applied', false
        );
    ELSIF v_request.checker_id <> p_checker_id THEN
        RAISE EXCEPTION 'not_assigned_checker';
    ELSIF v_request.initiated_by = p_checker_id THEN
        RAISE EXCEPTION 'segregation_of_duties';
    ELSIF p_decision NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'invalid_decision';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM deal_participants
         WHERE deal_id = v_request.deal_id AND profile_id = p_checker_id
           AND participant_role = 'brand_checker'
    ) THEN RAISE EXCEPTION 'checker_role_required'; END IF;

    v_new_status := CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END;

    IF p_decision = 'approve' THEN
        v_payload := v_request.action_payload;
        IF v_payload IS NULL THEN RAISE EXCEPTION 'signature_payload_missing'; END IF;

        SELECT * INTO v_contract
          FROM contracts
         WHERE id = (v_payload ->> 'contract_id')::uuid
         FOR UPDATE;
        SELECT * INTO v_deal FROM deals WHERE id = v_request.deal_id AND deleted_at IS NULL;

        IF v_contract.id IS NULL OR v_deal.id IS NULL
           OR v_contract.deal_id <> v_request.deal_id
           OR v_contract.status <> 'awaiting_signatures' OR v_deal.stage <> 'approval' THEN
            RAISE EXCEPTION 'contract_not_awaiting_signatures';
        END IF;

        INSERT INTO contract_signatures (
            contract_id, signer_id, on_behalf_of_brand_id, signature_mode,
            signature_ref, bypass_reason, physical_doc_path, ip_address
        ) VALUES (
            v_contract.id,
            v_request.initiated_by,
            v_deal.brand_id,
            (v_payload ->> 'mode')::signature_mode_enum,
            v_payload ->> 'signature_ref',
            v_payload ->> 'bypass_reason',
            v_payload ->> 'physical_doc_path',
            v_payload ->> 'ip_address'
        ) RETURNING * INTO v_signature;

        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (
            v_request.initiated_by, 'contract_signature_applied', 'deal', v_request.deal_id,
            jsonb_build_object(
                'contract_id', v_contract.id,
                'signature_id', v_signature.id,
                'mode', v_payload ->> 'mode',
                'side', 'brand',
                'released_by_request_id', v_request.id,
                'wet_signed_upload', (v_payload ->> 'physical_doc_path') IS NOT NULL
            ),
            v_payload ->> 'ip_address'
        );
    END IF;

    UPDATE maker_checker_requests
       SET status = v_new_status, comment = p_comment, decided_at = now()
     WHERE id = v_request.id;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_checker_id, 'maker_checker.' || v_new_status::text,
        'maker_checker_request', v_request.id,
        jsonb_build_object(
            'action_type', 'contract_signing',
            'initiated_by', v_request.initiated_by,
            'signature_applied', p_decision = 'approve'
        ),
        p_ip_address
    );

    RETURN jsonb_build_object(
        'status', v_new_status,
        'request_id', v_request.id,
        'deal_id', v_request.deal_id,
        'contract_id', v_payload ->> 'contract_id',
        'maker_id', v_request.initiated_by,
        'signature_applied', p_decision = 'approve'
    );
END;
$$;

-- Mark the deterministic executed PDF as authoritative exactly once. The later
-- stage-engine call is separately conditional/atomic; retries reconcile either
-- side of the file/database boundary.
CREATE OR REPLACE FUNCTION complete_contract_execution(
    p_contract_id uuid,
    p_actor_id uuid,
    p_storage_path text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_contract contracts%ROWTYPE;
    v_deal deals%ROWTYPE;
    v_creator_count integer;
    v_brand_count integer;
    v_completed boolean := false;
BEGIN
    SELECT * INTO v_contract FROM contracts WHERE id = p_contract_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found'; END IF;
    SELECT * INTO v_deal FROM deals WHERE id = v_contract.deal_id;

    SELECT count(*) FILTER (WHERE signer_id = v_deal.creator_id AND on_behalf_of_brand_id IS NULL),
           count(*) FILTER (WHERE on_behalf_of_brand_id = v_deal.brand_id)
      INTO v_creator_count, v_brand_count
      FROM contract_signatures
     WHERE contract_id = p_contract_id;

    IF v_creator_count <> 1 OR v_brand_count <> 1 THEN
        RAISE EXCEPTION 'required_signatures_missing';
    END IF;

    IF v_contract.status = 'awaiting_signatures' THEN
        UPDATE contracts
           SET storage_path = p_storage_path, status = 'executed'
         WHERE id = p_contract_id
         RETURNING * INTO v_contract;
        v_completed := true;

        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (
            p_actor_id, 'contract_executed', 'deal', v_contract.deal_id,
            jsonb_build_object('contract_id', v_contract.id, 'version', v_contract.version),
            p_ip_address
        );
    END IF;

    RETURN jsonb_build_object('completed', v_completed, 'contract', to_jsonb(v_contract));
END;
$$;

-- Every routine is backend-only. Migration 013's default grants would otherwise
-- expose new functions to authenticated clients.
REVOKE ALL ON FUNCTION reserve_contract_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_contract_generation(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_contract_signature(uuid, uuid, uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION decide_contract_signing_request(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_contract_execution(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION reserve_contract_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION complete_contract_generation(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION apply_contract_signature(uuid, uuid, uuid, uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION decide_contract_signing_request(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION complete_contract_execution(uuid, uuid, text, text) TO service_role;
