-- Phase 9 tasks 9.11/9.12. Private, participant-scoped contract PDFs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf'];

create policy "contracts_participant_read" on storage.objects for select to authenticated using (
  bucket_id = 'contracts' and is_deal_participant((storage.foldername(name))[1]::uuid)
);
create policy "contracts_participant_wet_upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'contracts' and is_deal_participant((storage.foldername(name))[1]::uuid)
  and (storage.foldername(name))[3] = 'wet-signatures' and lower(storage.extension(name)) = 'pdf'
);
create unique index contracts_deal_version_unique on contracts (deal_id, version);
