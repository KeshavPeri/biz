-- ============================================================
-- 023_contract_payload_privacy.sql
-- Phase 9.12 security hardening: keep signature snapshots/IP/private evidence
-- paths out of participant-readable PostgREST columns, and store held maker
-- payloads in a service-only table until the checker decides.
-- ============================================================

CREATE TABLE held_contract_signature_payloads (
    request_id        uuid PRIMARY KEY REFERENCES maker_checker_requests(id) ON DELETE CASCADE,
    contract_id       uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    signature_mode    signature_mode_enum NOT NULL,
    signature_ref     text NOT NULL,
    bypass_reason     text,
    physical_doc_path text,
    signer_ip_address text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (signature_mode IN ('stored', 'drawn') AND bypass_reason IS NULL AND physical_doc_path IS NULL)
        OR
        (signature_mode = 'print_bypass' AND length(btrim(bypass_reason)) BETWEEN 3 AND 500
         AND physical_doc_path IS NOT NULL)
    )
);

ALTER TABLE held_contract_signature_payloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE held_contract_signature_payloads FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE held_contract_signature_payloads TO service_role;

-- RLS controls rows, not columns. Replace broad participant SELECT grants with
-- an explicit safe projection so signature snapshots, IPs, wet-document paths,
-- and held payload JSON cannot be queried directly with the anon client.
REVOKE SELECT ON contract_signatures FROM anon, authenticated;
GRANT SELECT (
    id, contract_id, signer_id, on_behalf_of_brand_id, signature_mode, signed_at
) ON contract_signatures TO authenticated;

REVOKE SELECT ON maker_checker_requests FROM anon, authenticated;
GRANT SELECT (
    id, deal_id, action_type, initiated_by, checker_id, status, comment, created_at, decided_at
) ON maker_checker_requests TO authenticated;

-- Atomically create the visible approval request plus its private held payload.
CREATE OR REPLACE FUNCTION create_held_contract_signing_request(
    p_deal_id uuid,
    p_initiated_by uuid,
    p_checker_id uuid,
    p_contract_id uuid,
    p_signature_mode text,
    p_signature_ref text,
    p_bypass_reason text,
    p_physical_doc_path text,
    p_signer_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing maker_checker_requests%ROWTYPE;
    v_private held_contract_signature_payloads%ROWTYPE;
    v_request maker_checker_requests%ROWTYPE;
BEGIN
    SELECT * INTO v_existing
      FROM maker_checker_requests
     WHERE deal_id = p_deal_id AND action_type = 'contract_signing' AND status = 'pending'
     FOR UPDATE;

    IF FOUND THEN
        SELECT * INTO v_private FROM held_contract_signature_payloads WHERE request_id = v_existing.id;
        IF v_existing.initiated_by = p_initiated_by
           AND v_existing.checker_id = p_checker_id
           AND v_private.contract_id = p_contract_id
           AND v_private.signature_mode = p_signature_mode::signature_mode_enum
           AND v_private.signature_ref = p_signature_ref
           AND v_private.bypass_reason IS NOT DISTINCT FROM p_bypass_reason
           AND v_private.physical_doc_path IS NOT DISTINCT FROM p_physical_doc_path THEN
            RETURN jsonb_build_object(
                'status', 'held', 'requires_checker', true,
                'request_id', v_existing.id, 'checker_id', v_existing.checker_id,
                'idempotent', true
            );
        END IF;
        RAISE EXCEPTION 'pending_contract_signing_exists';
    END IF;

    INSERT INTO maker_checker_requests (
        deal_id, action_type, initiated_by, checker_id, status, action_payload
    ) VALUES (
        p_deal_id, 'contract_signing', p_initiated_by, p_checker_id, 'pending',
        jsonb_build_object('contract_id', p_contract_id)
    ) RETURNING * INTO v_request;

    INSERT INTO held_contract_signature_payloads (
        request_id, contract_id, signature_mode, signature_ref, bypass_reason,
        physical_doc_path, signer_ip_address
    ) VALUES (
        v_request.id, p_contract_id, p_signature_mode::signature_mode_enum,
        p_signature_ref, p_bypass_reason, p_physical_doc_path, p_signer_ip_address
    );

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_initiated_by, 'maker_checker.request_created', 'maker_checker_request', v_request.id,
        jsonb_build_object('action_type', 'contract_signing', 'checker_id', p_checker_id),
        p_signer_ip_address
    );

    RETURN jsonb_build_object(
        'status', 'held', 'requires_checker', true,
        'request_id', v_request.id, 'checker_id', p_checker_id,
        'idempotent', false
    );
END;
$$;

-- Override migration 022's decision routine: the public request carries only a
-- contract id; all signature material comes from the service-only payload row.
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
    v_payload held_contract_signature_payloads%ROWTYPE;
    v_contract contracts%ROWTYPE;
    v_deal deals%ROWTYPE;
    v_signature contract_signatures%ROWTYPE;
    v_new_status maker_checker_status_enum;
BEGIN
    SELECT * INTO v_request FROM maker_checker_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND OR v_request.action_type <> 'contract_signing' THEN
        RAISE EXCEPTION 'approval_request_not_found';
    ELSIF v_request.status <> 'pending' THEN
        RETURN jsonb_build_object(
            'status', v_request.status, 'request_id', v_request.id,
            'already_decided', true, 'signature_applied', false
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

    SELECT * INTO v_payload FROM held_contract_signature_payloads WHERE request_id = v_request.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'signature_payload_missing'; END IF;
    v_new_status := CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END;

    IF p_decision = 'approve' THEN
        SELECT * INTO v_contract FROM contracts WHERE id = v_payload.contract_id FOR UPDATE;
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
            v_contract.id, v_request.initiated_by, v_deal.brand_id,
            v_payload.signature_mode, v_payload.signature_ref,
            v_payload.bypass_reason, v_payload.physical_doc_path,
            v_payload.signer_ip_address
        ) RETURNING * INTO v_signature;

        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (
            v_request.initiated_by, 'contract_signature_applied', 'deal', v_request.deal_id,
            jsonb_build_object(
                'contract_id', v_contract.id, 'signature_id', v_signature.id,
                'mode', v_payload.signature_mode, 'side', 'brand',
                'released_by_request_id', v_request.id,
                'wet_signed_upload', v_payload.physical_doc_path IS NOT NULL
            ),
            v_payload.signer_ip_address
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
            'action_type', 'contract_signing', 'initiated_by', v_request.initiated_by,
            'signature_applied', p_decision = 'approve'
        ),
        p_ip_address
    );

    RETURN jsonb_build_object(
        'status', v_new_status, 'request_id', v_request.id,
        'deal_id', v_request.deal_id, 'contract_id', v_payload.contract_id,
        'maker_id', v_request.initiated_by,
        'signature_applied', p_decision = 'approve',
        'physical_doc_path', v_payload.physical_doc_path
    );
END;
$$;

REVOKE ALL ON FUNCTION create_held_contract_signing_request(uuid, uuid, uuid, uuid, text, text, text, text, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION decide_contract_signing_request(uuid, uuid, text, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_held_contract_signing_request(uuid, uuid, uuid, uuid, text, text, text, text, text)
    TO service_role;
GRANT EXECUTE ON FUNCTION decide_contract_signing_request(uuid, uuid, text, text, text)
    TO service_role;
