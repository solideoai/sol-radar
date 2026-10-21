-- Only referenced raw files are readable. Parsed/training/health objects have no user policy.
-- Bucket provisioning uses Storage API; managed storage schema/objects are never changed with SQL.
create policy "sol_raw_documents_read" on storage.objects for select to authenticated
using (
  (select public.is_active_user())
  and (select exists(select 1 from public.my_sol_org_ids(array['ADMIN','SALES','ANALYST','VIEWER'])))
  and exists (
    select 1 from public.bid_documents d
    where d.storage_bucket=storage.objects.bucket_id and d.object_key=storage.objects.name
      and d.download_status='OK' and d.raw_storage_id is not null
  )
);
