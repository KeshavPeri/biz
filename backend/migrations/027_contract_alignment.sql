-- ============================================================
-- 027_contract_alignment.sql
-- Workplan 10-D / B4-003, B4-005, B3-026: immutable generated-v1
-- extraction, deterministic conflicts, two-side override, and hard signing gates.
-- Additive and re-runnable; no historical migration or application row is removed.
-- ============================================================

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS draft_source_sha256 text;

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_draft_source_sha256_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_draft_source_sha256_check CHECK (
    status = 'draft'
    OR (draft_source_sha256 IS NOT NULL AND draft_source_sha256 ~ '^[0-9a-f]{64}$')
) NOT VALID;

-- RLS limits rows, not columns. Preserve the participant-readable contract
-- projection while keeping the authoritative draft digest backend-only.
REVOKE SELECT ON contracts FROM PUBLIC, anon, authenticated;
GRANT SELECT (
    id, deal_id, version, generated_from_summary_id, status, created_at
) ON contracts TO authenticated;

-- Publish a generated v1 draft and durably bind its exact bytes to the contract
-- provenance. The earlier four-argument routine cannot publish a new draft once
-- the check above is installed because it does not supply the required hash.
CREATE OR REPLACE FUNCTION complete_contract_generation_v1(
    p_contract_id uuid,
    p_actor_id uuid,
    p_storage_path text,
    p_source_sha256 text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_contract contracts%ROWTYPE;
    v_expected_path text;
BEGIN
    IF p_source_sha256 !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'contract_source_hash_invalid';
    END IF;

    SELECT * INTO v_contract FROM contracts WHERE id = p_contract_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found'; END IF;
    v_expected_path := v_contract.deal_id::text || '/' || v_contract.id::text || '/draft-v1.pdf';
    IF v_contract.version <> 1 OR p_storage_path <> v_expected_path THEN
        RAISE EXCEPTION 'contract_source_binding_invalid';
    END IF;

    IF v_contract.status = 'draft' THEN
        UPDATE contracts
           SET storage_path = p_storage_path,
               draft_source_sha256 = p_source_sha256,
               status = 'awaiting_signatures'
         WHERE id = p_contract_id
         RETURNING * INTO v_contract;

        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (
            p_actor_id, 'contract_generated', 'deal', v_contract.deal_id,
            jsonb_build_object('contract_id', v_contract.id, 'version', v_contract.version),
            p_ip_address
        );
    ELSIF v_contract.storage_path <> p_storage_path
       OR v_contract.draft_source_sha256 <> p_source_sha256 THEN
        RAISE EXCEPTION 'contract_source_binding_changed';
    END IF;

    RETURN to_jsonb(v_contract);
END;
$$;

CREATE TABLE IF NOT EXISTS contract_alignment_attempts (
    contract_id        uuid PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
    deal_id            uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    summary_id         uuid NOT NULL REFERENCES ai_summaries(id) ON DELETE RESTRICT,
    source_sha256      text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    status             text NOT NULL CHECK (status IN ('pending', 'failed', 'succeeded')),
    attempt_token      uuid NOT NULL DEFAULT gen_random_uuid(),
    lease_until        timestamptz NOT NULL,
    requested_by       uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    failure_code       text CHECK (failure_code IN (
        'rate_limited', 'provider_timeout', 'provider_unavailable',
        'validation_failed', 'pdf_invalid', 'internal_failure'
    )),
    extracted_terms_id uuid UNIQUE REFERENCES extracted_terms(id) ON DELETE RESTRICT,
    started_at         timestamptz NOT NULL DEFAULT now(),
    completed_at       timestamptz,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (status = 'pending' AND failure_code IS NULL AND extracted_terms_id IS NULL)
        OR (status = 'failed' AND failure_code IS NOT NULL AND extracted_terms_id IS NULL)
        OR (status = 'succeeded' AND failure_code IS NULL AND extracted_terms_id IS NOT NULL)
    )
);

ALTER TABLE contract_alignment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contract_alignment_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON contract_alignment_attempts TO service_role;

ALTER TABLE extracted_terms
    ADD COLUMN IF NOT EXISTS generated_from_summary_id uuid REFERENCES ai_summaries(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS contract_version int,
    ADD COLUMN IF NOT EXISTS source_sha256 text,
    ADD COLUMN IF NOT EXISTS schema_version text,
    ADD COLUMN IF NOT EXISTS prompt_version text,
    ADD COLUMN IF NOT EXISTS provider text,
    ADD COLUMN IF NOT EXISTS model text,
    ADD COLUMN IF NOT EXISTS creator_confirmed_by uuid REFERENCES profiles(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS creator_confirmed_at timestamptz,
    ADD COLUMN IF NOT EXISTS brand_confirmed_by uuid REFERENCES profiles(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS brand_confirmed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_extracted_terms_contract_success
    ON extracted_terms(contract_id);

ALTER TABLE extracted_terms DROP CONSTRAINT IF EXISTS extracted_terms_alignment_provenance_check;
ALTER TABLE extracted_terms ADD CONSTRAINT extracted_terms_alignment_provenance_check CHECK (
    generated_from_summary_id IS NOT NULL
    AND contract_version = 1
    AND source_sha256 ~ '^[0-9a-f]{64}$'
    AND btrim(schema_version) <> ''
    AND btrim(prompt_version) <> ''
    AND btrim(provider) <> ''
    AND btrim(model) <> ''
    AND jsonb_typeof(structured_terms) = 'object'
    AND jsonb_typeof(conflicts_detected) = 'array'
    AND ((creator_confirmed_by IS NULL) = (creator_confirmed_at IS NULL))
    AND ((brand_confirmed_by IS NULL) = (brand_confirmed_at IS NULL))
    AND confirmed_by_both = (creator_confirmed_by IS NOT NULL AND brand_confirmed_by IS NOT NULL)
) NOT VALID;

-- Participant reads retain RLS but only through the safe alignment projection.
-- Raw/validated model payload, provenance, hash and actor IDs remain API-only.
REVOKE SELECT ON extracted_terms FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, deal_id, contract_id, conflicts_detected, confirmed_by_both, extracted_at)
    ON extracted_terms TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON extracted_terms FROM PUBLIC, anon, authenticated;
GRANT ALL ON extracted_terms TO service_role;

CREATE OR REPLACE FUNCTION reserve_contract_alignment(
    p_deal_id uuid,
    p_contract_id uuid,
    p_summary_id uuid,
    p_source_sha256 text,
    p_actor_id uuid,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_contract contracts%ROWTYPE;
    v_attempt contract_alignment_attempts%ROWTYPE;
    v_token uuid := gen_random_uuid();
BEGIN
    IF p_source_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'ALIGNMENT_INVALID_HASH'; END IF;

    PERFORM 1 FROM deals
     WHERE id = p_deal_id AND stage = 'approval' AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ALIGNMENT_WRONG_STAGE'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM deal_participants
         WHERE deal_id = p_deal_id AND profile_id = p_actor_id
    ) THEN RAISE EXCEPTION 'ALIGNMENT_NOT_PARTICIPANT'; END IF;

    SELECT * INTO v_contract FROM contracts WHERE id = p_contract_id FOR UPDATE;
    IF NOT FOUND OR v_contract.deal_id <> p_deal_id OR v_contract.version <> 1
       OR v_contract.status <> 'awaiting_signatures'
       OR v_contract.generated_from_summary_id <> p_summary_id
       OR v_contract.storage_path <> p_deal_id::text || '/' || p_contract_id::text || '/draft-v1.pdf' THEN
        RAISE EXCEPTION 'ALIGNMENT_WRONG_CONTRACT';
    END IF;
    IF v_contract.draft_source_sha256 IS NULL
       OR v_contract.draft_source_sha256 <> p_source_sha256 THEN
        RAISE EXCEPTION 'ALIGNMENT_SOURCE_MISMATCH';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM ai_summaries
         WHERE id = p_summary_id AND deal_id = p_deal_id AND status = 'approved'
    ) THEN RAISE EXCEPTION 'ALIGNMENT_WRONG_SUMMARY'; END IF;

    INSERT INTO contract_alignment_attempts (
        contract_id, deal_id, summary_id, source_sha256, status,
        attempt_token, lease_until, requested_by
    ) VALUES (
        p_contract_id, p_deal_id, p_summary_id, p_source_sha256, 'pending',
        v_token, now() + interval '5 minutes', p_actor_id
    ) ON CONFLICT (contract_id) DO NOTHING;

    SELECT * INTO v_attempt
      FROM contract_alignment_attempts
     WHERE contract_id = p_contract_id
     FOR UPDATE;

    IF v_attempt.status = 'succeeded' THEN
        RETURN jsonb_build_object('outcome', 'succeeded');
    ELSIF v_attempt.status = 'pending' AND v_attempt.attempt_token <> v_token
          AND v_attempt.lease_until > now() THEN
        RETURN jsonb_build_object('outcome', 'processing');
    ELSIF v_attempt.status <> 'pending' OR v_attempt.attempt_token <> v_token THEN
        UPDATE contract_alignment_attempts
           SET summary_id = p_summary_id, source_sha256 = p_source_sha256,
               status = 'pending', attempt_token = v_token,
               lease_until = now() + interval '5 minutes', requested_by = p_actor_id,
               failure_code = NULL, extracted_terms_id = NULL,
               started_at = now(), completed_at = NULL, updated_at = now()
         WHERE contract_id = p_contract_id
         RETURNING * INTO v_attempt;
    END IF;

    RETURN jsonb_build_object('outcome', 'reserved', 'attempt_token', v_attempt.attempt_token);
END;
$$;

CREATE OR REPLACE FUNCTION complete_contract_alignment(
    p_attempt_token uuid,
    p_raw_output jsonb,
    p_structured_terms jsonb,
    p_conflicts jsonb,
    p_schema_version text,
    p_prompt_version text,
    p_provider text,
    p_model text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_attempt contract_alignment_attempts%ROWTYPE;
    v_contract contracts%ROWTYPE;
    v_extracted extracted_terms%ROWTYPE;
BEGIN
    SELECT * INTO v_attempt
      FROM contract_alignment_attempts
     WHERE attempt_token = p_attempt_token
     FOR UPDATE;
    IF NOT FOUND OR v_attempt.status <> 'pending' THEN
        RAISE EXCEPTION 'ALIGNMENT_STALE_ATTEMPT';
    END IF;
    SELECT * INTO v_contract FROM contracts WHERE id = v_attempt.contract_id FOR UPDATE;
    IF NOT FOUND OR v_contract.deal_id <> v_attempt.deal_id OR v_contract.version <> 1
       OR v_contract.status <> 'awaiting_signatures'
       OR v_contract.generated_from_summary_id <> v_attempt.summary_id
       OR v_contract.storage_path <> v_attempt.deal_id::text || '/' || v_attempt.contract_id::text || '/draft-v1.pdf'
       OR v_contract.draft_source_sha256 <> v_attempt.source_sha256
       OR NOT EXISTS (
           SELECT 1 FROM ai_summaries
            WHERE id = v_attempt.summary_id AND deal_id = v_attempt.deal_id AND status = 'approved'
       ) THEN RAISE EXCEPTION 'ALIGNMENT_BINDING_CHANGED'; END IF;
    IF jsonb_typeof(p_raw_output) <> 'object'
       OR jsonb_typeof(p_structured_terms) <> 'object'
       OR jsonb_typeof(p_conflicts) <> 'array'
       OR coalesce(btrim(p_schema_version), '') = ''
       OR coalesce(btrim(p_prompt_version), '') = ''
       OR coalesce(btrim(p_provider), '') = ''
       OR coalesce(btrim(p_model), '') = '' THEN
        RAISE EXCEPTION 'ALIGNMENT_INVALID_RESULT';
    END IF;

    INSERT INTO extracted_terms (
        deal_id, contract_id, raw_output, structured_terms, conflicts_detected,
        confirmed_by_both, generated_from_summary_id, contract_version,
        source_sha256, schema_version, prompt_version, provider, model
    ) VALUES (
        v_attempt.deal_id, v_attempt.contract_id, p_raw_output, p_structured_terms,
        p_conflicts, false, v_attempt.summary_id, 1, v_attempt.source_sha256,
        p_schema_version, p_prompt_version, p_provider, p_model
    ) RETURNING * INTO v_extracted;

    UPDATE contract_alignment_attempts
       SET status = 'succeeded', failure_code = NULL,
           extracted_terms_id = v_extracted.id, completed_at = now(), updated_at = now()
     WHERE contract_id = v_attempt.contract_id;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        v_attempt.requested_by, 'contract_alignment_succeeded', 'deal', v_attempt.deal_id,
        jsonb_build_object(
            'contract_id', v_attempt.contract_id,
            'extracted_terms_id', v_extracted.id,
            'source_sha256', v_attempt.source_sha256,
            'conflict_count', jsonb_array_length(p_conflicts)
        ), p_ip_address
    );
    RETURN jsonb_build_object('outcome', 'succeeded', 'extracted_terms_id', v_extracted.id);
END;
$$;

CREATE OR REPLACE FUNCTION fail_contract_alignment(
    p_attempt_token uuid,
    p_failure_code text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_attempt contract_alignment_attempts%ROWTYPE;
BEGIN
    IF p_failure_code NOT IN (
        'rate_limited', 'provider_timeout', 'provider_unavailable',
        'validation_failed', 'pdf_invalid', 'internal_failure'
    ) THEN RAISE EXCEPTION 'ALIGNMENT_INVALID_FAILURE'; END IF;
    SELECT * INTO v_attempt
      FROM contract_alignment_attempts
     WHERE attempt_token = p_attempt_token
     FOR UPDATE;
    IF NOT FOUND OR v_attempt.status <> 'pending' THEN
        RAISE EXCEPTION 'ALIGNMENT_STALE_ATTEMPT';
    END IF;
    UPDATE contract_alignment_attempts
       SET status = 'failed', failure_code = p_failure_code,
           completed_at = now(), updated_at = now()
     WHERE contract_id = v_attempt.contract_id;
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        v_attempt.requested_by, 'contract_alignment_failed', 'deal', v_attempt.deal_id,
        jsonb_build_object('contract_id', v_attempt.contract_id, 'failure_code', p_failure_code),
        p_ip_address
    );
    RETURN jsonb_build_object('outcome', 'failed');
END;
$$;

CREATE OR REPLACE FUNCTION confirm_contract_alignment(
    p_deal_id uuid,
    p_extracted_terms_id uuid,
    p_actor_id uuid,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_extracted extracted_terms%ROWTYPE;
    v_role participant_role_enum;
    v_side text;
    v_recorded boolean := false;
BEGIN
    SELECT * INTO v_extracted
      FROM extracted_terms
     WHERE id = p_extracted_terms_id
     FOR UPDATE;
    IF NOT FOUND OR v_extracted.deal_id <> p_deal_id
       OR jsonb_array_length(v_extracted.conflicts_detected) = 0
       OR NOT EXISTS (
           SELECT 1 FROM contract_alignment_attempts
            WHERE contract_id = v_extracted.contract_id AND status = 'succeeded'
              AND extracted_terms_id = v_extracted.id
       )
       OR NOT EXISTS (
           SELECT 1 FROM contracts
            WHERE id = v_extracted.contract_id AND deal_id = p_deal_id
              AND version = v_extracted.contract_version
              AND generated_from_summary_id = v_extracted.generated_from_summary_id
              AND draft_source_sha256 = v_extracted.source_sha256
              AND status = 'awaiting_signatures'
       ) THEN RAISE EXCEPTION 'ALIGNMENT_STALE'; END IF;
    SELECT participant_role INTO v_role
      FROM deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role = 'creator' THEN
        v_side := 'creator';
        IF v_extracted.creator_confirmed_by IS NULL THEN
            UPDATE extracted_terms
               SET creator_confirmed_by = p_actor_id, creator_confirmed_at = now(),
                   confirmed_by_both = (brand_confirmed_by IS NOT NULL)
             WHERE id = v_extracted.id;
            v_recorded := true;
        END IF;
    ELSIF v_role IN ('brand_admin', 'brand_maker') THEN
        v_side := 'brand';
        IF v_extracted.brand_confirmed_by IS NULL THEN
            UPDATE extracted_terms
               SET brand_confirmed_by = p_actor_id, brand_confirmed_at = now(),
                   confirmed_by_both = (creator_confirmed_by IS NOT NULL)
             WHERE id = v_extracted.id;
            v_recorded := true;
        END IF;
    ELSE
        RAISE EXCEPTION 'ALIGNMENT_NOT_ELIGIBLE';
    END IF;

    UPDATE extracted_terms
       SET confirmed_by_both = (creator_confirmed_by IS NOT NULL AND brand_confirmed_by IS NOT NULL)
     WHERE id = v_extracted.id
     RETURNING * INTO v_extracted;

    IF v_recorded THEN
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (
            p_actor_id, 'contract_alignment_override_confirmed', 'deal', p_deal_id,
            jsonb_build_object(
                'contract_id', v_extracted.contract_id,
                'extracted_terms_id', v_extracted.id,
                'side', v_side,
                'conflict_count', jsonb_array_length(v_extracted.conflicts_detected),
                'confirmed_by_both', v_extracted.confirmed_by_both
            ), p_ip_address
        );
    END IF;
    RETURN jsonb_build_object(
        'outcome', CASE WHEN v_extracted.confirmed_by_both THEN 'overridden' ELSE 'pending_other_side' END,
        'idempotent', NOT v_recorded,
        'confirmed_by_both', v_extracted.confirmed_by_both
    );
END;
$$;

CREATE OR REPLACE FUNCTION contract_alignment_is_ready(
    p_deal_id uuid,
    p_contract_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM contracts c
          JOIN contract_alignment_attempts a
            ON a.contract_id = c.id AND a.status = 'succeeded'
          JOIN extracted_terms e
            ON e.id = a.extracted_terms_id
           AND e.contract_id = c.id
           AND e.deal_id = c.deal_id
           AND e.generated_from_summary_id = c.generated_from_summary_id
           AND e.contract_version = c.version
           AND e.source_sha256 = a.source_sha256
           AND e.source_sha256 = c.draft_source_sha256
         WHERE c.id = p_contract_id AND c.deal_id = p_deal_id AND c.version = 1
           AND jsonb_typeof(e.conflicts_detected) = 'array'
           AND (jsonb_array_length(e.conflicts_detected) = 0 OR e.confirmed_by_both)
    );
$$;

-- Database hard gates cover direct/RPC signature writes, held maker payloads,
-- checker release, execution, and Approval -> Creating even if application code
-- regresses or a service-role path calls the old routines directly.
CREATE OR REPLACE FUNCTION enforce_contract_alignment_on_signature()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_deal_id uuid;
BEGIN
    SELECT deal_id INTO v_deal_id FROM contracts WHERE id = NEW.contract_id;
    IF v_deal_id IS NULL OR NOT contract_alignment_is_ready(v_deal_id, NEW.contract_id) THEN
        RAISE EXCEPTION 'CONTRACT_ALIGNMENT_REQUIRED';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_signature_alignment_gate ON contract_signatures;
CREATE TRIGGER contract_signature_alignment_gate
BEFORE INSERT ON contract_signatures
FOR EACH ROW EXECUTE FUNCTION enforce_contract_alignment_on_signature();

CREATE OR REPLACE FUNCTION enforce_contract_alignment_on_held_request()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_contract_id uuid;
BEGIN
    IF NEW.action_type = 'contract_signing' THEN
        BEGIN
            v_contract_id := (NEW.action_payload ->> 'contract_id')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'CONTRACT_ALIGNMENT_REQUIRED';
        END;
        IF v_contract_id IS NULL OR NOT contract_alignment_is_ready(NEW.deal_id, v_contract_id) THEN
            RAISE EXCEPTION 'CONTRACT_ALIGNMENT_REQUIRED';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS held_contract_alignment_gate ON maker_checker_requests;
CREATE TRIGGER held_contract_alignment_gate
BEFORE INSERT ON maker_checker_requests
FOR EACH ROW EXECUTE FUNCTION enforce_contract_alignment_on_held_request();

CREATE OR REPLACE FUNCTION enforce_contract_alignment_on_execution()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'executed' AND OLD.status IS DISTINCT FROM 'executed'
       AND NOT contract_alignment_is_ready(NEW.deal_id, NEW.id) THEN
        RAISE EXCEPTION 'CONTRACT_ALIGNMENT_REQUIRED';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_execution_alignment_gate ON contracts;
CREATE TRIGGER contract_execution_alignment_gate
BEFORE UPDATE OF status ON contracts
FOR EACH ROW EXECUTE FUNCTION enforce_contract_alignment_on_execution();

CREATE OR REPLACE FUNCTION enforce_contract_alignment_on_creating()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_contract_id uuid;
BEGIN
    IF OLD.stage = 'approval' AND NEW.stage = 'creating' THEN
        SELECT id INTO v_contract_id
          FROM contracts
         WHERE deal_id = NEW.id AND version = 1 AND status = 'executed'
         LIMIT 1;
        IF v_contract_id IS NULL OR NOT contract_alignment_is_ready(NEW.id, v_contract_id) THEN
            RAISE EXCEPTION 'CONTRACT_ALIGNMENT_REQUIRED';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deal_creating_alignment_gate ON deals;
CREATE TRIGGER deal_creating_alignment_gate
BEFORE UPDATE OF stage ON deals
FOR EACH ROW EXECUTE FUNCTION enforce_contract_alignment_on_creating();

REVOKE ALL ON FUNCTION reserve_contract_alignment(uuid, uuid, uuid, text, uuid, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_contract_generation_v1(uuid, uuid, text, text, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_contract_alignment(uuid, jsonb, jsonb, jsonb, text, text, text, text, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_contract_alignment(uuid, text, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION confirm_contract_alignment(uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION contract_alignment_is_ready(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enforce_contract_alignment_on_signature()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enforce_contract_alignment_on_held_request()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enforce_contract_alignment_on_execution()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enforce_contract_alignment_on_creating()
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION reserve_contract_alignment(uuid, uuid, uuid, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION complete_contract_generation_v1(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION complete_contract_alignment(uuid, jsonb, jsonb, jsonb, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION fail_contract_alignment(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION confirm_contract_alignment(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION contract_alignment_is_ready(uuid, uuid) TO service_role;
