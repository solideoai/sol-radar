-- ADR-047: private Supabase Storage. Existing documents/keys and old objects are preserved.
-- Worker-only invoker RPCs serialize immutable upload, reference attachment and orphan deletion.
create table public.document_storage_objects (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket ~ '^[a-z][a-z0-9-]{2,62}$'),
  logical_path text not null check (logical_path !~ '(^|/)\.\.?(/|$)' and logical_path ~ '^(raw|parsed)/bids/.+/[^/]+$'),
  path text not null check (path !~ '(^|/)\.\.?(/|$)' and path ~ '^(raw|parsed)/bids/'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  mime_type text not null,
  status text not null default 'UPLOADING' check (status in ('UPLOADING','STORED','DELETE_PENDING','ERROR')),
  lease_token uuid not null,
  lease_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bucket, logical_path),
  unique(bucket, path),
  check (path = regexp_replace(logical_path, '/([^/]+)$', '/' || id::text || '/\1')),
  unique(id, bucket, path)
);
alter table public.document_storage_objects enable row level security;
revoke all on public.document_storage_objects from public, anon, authenticated;
grant all on public.document_storage_objects to service_role;
create index document_storage_reconcile_idx on public.document_storage_objects(created_at, lease_until);

alter table public.bid_documents
  add column storage_bucket text,
  add column text_storage_bucket text,
  add column raw_storage_id uuid,
  add column parsed_storage_id uuid,
  add column uploaded_at timestamptz,
  add column parsed_at timestamptz,
  add column download_error_message text check (length(download_error_message) <= 500),
  add column parse_error_message text check (length(parse_error_message) <= 500),
  add column processing_attempt_id uuid,
  add column processing_lease_until timestamptz,
  add constraint bid_documents_raw_storage_fk foreign key(raw_storage_id, storage_bucket, object_key)
    references public.document_storage_objects(id, bucket, path),
  add constraint bid_documents_parsed_storage_fk foreign key(parsed_storage_id, text_storage_bucket, text_object_key)
    references public.document_storage_objects(id, bucket, path),
  add constraint bid_documents_raw_storage_complete check
    (raw_storage_id is null or (storage_bucket is not null and object_key is not null)),
  add constraint bid_documents_parsed_storage_complete check
    (parsed_storage_id is null or (text_storage_bucket is not null and text_object_key is not null));
alter table public.bid_documents drop constraint bid_documents_revision_id_sha256_key;
create index bid_documents_revision_sha_idx on public.bid_documents(revision_id, sha256);
create index bid_documents_raw_storage_idx on public.bid_documents(raw_storage_id);
create index bid_documents_parsed_storage_idx on public.bid_documents(parsed_storage_id);

create function public.claim_document_storage(p jsonb) returns jsonb
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
create function public.guard_document_storage_reference() returns trigger
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
create trigger guard_document_storage_reference before insert or update on public.bid_documents
for each row execute function public.guard_document_storage_reference();

create function public.finish_document_storage(p jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare o public.document_storage_objects; d public.bid_documents;
begin
  select * into o from public.document_storage_objects where id=(p->>'objectId')::uuid for update;
  if not found or o.status='DELETE_PENDING' or o.lease_token is distinct from (p->>'leaseToken')::uuid
    or o.lease_until < now() then raise exception 'storage_lease_lost'; end if;
  select * into d from public.bid_documents where id=(p->>'documentId')::uuid for update;
  if not found then raise exception 'storage_document_missing'; end if;
  update public.document_storage_objects set status='STORED',lease_until=now(),updated_at=now() where id=o.id;
  if p->>'kind'='raw' then
    if d.raw_storage_id=o.id and d.download_status='OK' then return; end if;
    update public.bid_documents set
      raw_storage_id=o.id,storage_bucket=o.bucket,object_key=o.path,sha256=o.sha256,size_bytes=o.size_bytes,
      mime_type=o.mime_type,format=p->>'format',download_status='OK',download_error_code=null,download_error_message=null,
      uploaded_at=now(),parse_status='PENDING',parse_error_code=null,parse_error_message=null,
      parsed_storage_id=null,text_storage_bucket=null,text_object_key=null,parsed_at=null,parser_id=null,parse_quality=null,page_count=null
    where id=d.id;
  elsif p->>'kind'='parsed' then
    if coalesce(p->>'parseStatus','') not in ('PARSED','PARTIAL') or coalesce(p->>'parserId','')='' then
      raise exception 'storage_invalid_parse';
    end if;
    update public.bid_documents set parsed_storage_id=o.id,text_storage_bucket=o.bucket,text_object_key=o.path,
      parse_status=p->>'parseStatus',parser_id=p->>'parserId',parse_quality=p->'parseQuality',page_count=(p->>'pageCount')::integer,
      parsed_at=now(),parse_error_code=null,parse_error_message=null where id=d.id;
  else raise exception 'storage_invalid_kind'; end if;
end;
$$;

create function public.claim_document_storage_delete(p_id uuid,p_token uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare o public.document_storage_objects;
begin
  if p_token is null then raise exception 'storage_invalid_lease'; end if;
  select * into o from public.document_storage_objects where id=p_id for update;
  if not found or o.created_at > now()-interval '24 hours'
    or (o.lease_until > now() and o.status <> 'STORED') then return null; end if;
  -- A STORED object still under an upload/re-attachment lease must also be retained.
  if o.status='STORED' and o.lease_until > now() then return null; end if;
  if exists(select 1 from public.bid_documents where raw_storage_id=o.id or parsed_storage_id=o.id) then return null; end if;
  update public.document_storage_objects set status='DELETE_PENDING',lease_token=p_token,lease_until=now()+interval '5 minutes',updated_at=now() where id=o.id;
  return jsonb_build_object('id',o.id,'bucket',o.bucket,'path',o.path);
end;
$$;

create function public.finish_document_storage_delete(p_id uuid,p_token uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.document_storage_objects where id=p_id and status='DELETE_PENDING' and lease_token=p_token;
  if not found then raise exception 'storage_lease_lost'; end if;
end;
$$;

create function public.document_storage_candidates(p_limit integer default 100)
returns setof public.document_storage_objects language sql stable security invoker set search_path = '' as $$
  select o.* from public.document_storage_objects o
  where o.created_at <= now()-interval '24 hours' and o.lease_until <= now()
    and not exists(select 1 from public.bid_documents d where d.raw_storage_id=o.id or d.parsed_storage_id=o.id)
  order by o.created_at limit greatest(1,least(p_limit,100));
$$;

revoke all on function public.claim_document_storage(jsonb),public.finish_document_storage(jsonb),
  public.guard_document_storage_reference(),public.claim_document_storage_delete(uuid,uuid),public.finish_document_storage_delete(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.claim_document_storage(jsonb),public.finish_document_storage(jsonb),
  public.guard_document_storage_reference(),public.claim_document_storage_delete(uuid,uuid),public.finish_document_storage_delete(uuid,uuid)
  to service_role;
revoke all on function public.document_storage_candidates(integer) from public,anon,authenticated;
grant execute on function public.document_storage_candidates(integer) to service_role;
