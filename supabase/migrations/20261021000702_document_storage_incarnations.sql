-- ADR-048: fence stale external deletes without changing committed Storage migrations.
-- Existing raw/parsed bytes and document foreign keys keep their original paths.
alter table public.document_storage_objects add column logical_path text;
update public.document_storage_objects set logical_path=path;
alter table public.document_storage_objects
  alter column logical_path set not null,
  add constraint document_storage_objects_logical_path_check check
    (logical_path !~ '(^|/)\.\.?(/|$)' and logical_path ~ '^(raw|parsed)/bids/.+/[^/]+$'),
  add constraint document_storage_objects_bucket_logical_path_key unique(bucket,logical_path),
  add constraint document_storage_objects_incarnation_path_check check
    (path=logical_path or path=regexp_replace(logical_path, '/([^/]+)$', '/' || id::text || '/\1'));

create or replace function public.claim_document_storage(p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare o public.document_storage_objects; token uuid := (p->>'leaseToken')::uuid; object_id uuid := gen_random_uuid();
begin
  if token is null then raise exception 'storage_invalid_lease'; end if;
  -- Never reuse a physical key after deletion. An expired deleter can still finish its Storage request.
  insert into public.document_storage_objects(id,bucket,logical_path,path,sha256,size_bytes,mime_type,lease_token,lease_until)
  values(object_id,p->>'bucket',p->>'path',regexp_replace(p->>'path','/([^/]+)$','/'||object_id::text||'/\1'),p->>'sha256',(p->>'sizeBytes')::bigint,p->>'mimeType',token,now()+interval '5 minutes')
  on conflict(bucket,logical_path) do nothing;
  select * into strict o from public.document_storage_objects where bucket=p->>'bucket' and logical_path=p->>'path' for update;
  if o.sha256 <> p->>'sha256' or o.size_bytes <> (p->>'sizeBytes')::bigint or o.mime_type <> p->>'mimeType' then
    raise exception 'storage_metadata_mismatch';
  end if;
  if o.status='DELETE_PENDING' or (o.lease_until > now() and o.lease_token <> token) then
    raise exception 'storage_busy';
  end if;
  update public.document_storage_objects set lease_token=token,lease_until=now()+interval '5 minutes',updated_at=now() where id=o.id;
  return jsonb_build_object('id',o.id,'path',o.path,'status',o.status);
end;
$$;

-- Guard direct worker updates too: a DELETE_PENDING object may never gain a reference.
create or replace function public.guard_document_storage_reference() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare o public.document_storage_objects;
begin
  for o in select * from public.document_storage_objects
    where id in (new.raw_storage_id,new.parsed_storage_id) order by id for update loop
    if o.status <> 'STORED' then raise exception 'storage_not_stored'; end if;
    if o.id=new.raw_storage_id then
      if o.bucket is distinct from new.storage_bucket or o.path is distinct from new.object_key
        or o.sha256 is distinct from new.sha256 or o.size_bytes is distinct from new.size_bytes
        or o.logical_path not like 'raw/bids/'||new.bid_id::text||'/'||new.revision_id::text||'/'||o.sha256||'.%' then
        raise exception 'storage_reference_mismatch';
      end if;
    else
      if o.bucket is distinct from new.text_storage_bucket or o.path is distinct from new.text_object_key
        or new.download_status <> 'OK' or new.raw_storage_id is null
        or o.logical_path not like 'parsed/bids/'||new.bid_id::text||'/'||new.revision_id::text||'/'||new.sha256||'/%/result.json' then
        raise exception 'storage_reference_mismatch';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
