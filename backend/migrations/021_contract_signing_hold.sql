-- Keep contract-signing payload with the existing maker-checker request; this is
-- not a parallel approval system. It is only read by the service-role release.
alter table maker_checker_requests add column if not exists action_payload jsonb;
create unique index if not exists maker_checker_pending_contract_signing_unique
  on maker_checker_requests (deal_id, action_type, initiated_by)
  where status = 'pending' and action_type = 'contract_signing';
