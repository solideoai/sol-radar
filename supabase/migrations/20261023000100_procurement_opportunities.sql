-- ADR-047: source 공고/revision/FK는 보존하고 사업기회·출처·관련성·수집 증거를 추가한다.
-- 운영 적용은 별도 승인. 이미 적용된 migration은 수정하지 않는다.

alter table public.bid_notices drop constraint bid_notices_source_check;
alter table public.bid_notices add constraint bid_notices_source_check check (source in (
  'fixture','g2b-bid-notice','g2b-pre-spec','g2b-order-plan','g2b-procurement-request',
  'kwater-bid-notice','kwater-procurement-plan','lh-bid-notice','lh-pre-specification','kepco-ebid-contract'
));
alter table public.bid_notices drop constraint bid_notices_stage_check;
alter table public.bid_notices add constraint bid_notices_stage_check check
  (stage in ('PLAN','PROCUREMENT_REQUEST','PRE_SPEC','NOTICE','OPENING','AWARD','CONTRACT'));
alter table public.ingest_runs drop constraint ingest_runs_source_check;
alter table public.ingest_runs add constraint ingest_runs_source_check check
  (source in ('fixture','g2b','kwater','lh','kepco'));
alter table public.ingest_runs add column service_key text;
alter table public.ingest_runs add column operation text;
alter table public.ingest_runs add column partition_key text;
alter table public.ingest_runs add column completeness text not null default 'COMPLETE'
  check (completeness in ('COMPLETE','PARTIAL','UNKNOWN'));
alter table public.ingest_runs add column fetched_count integer not null default 0 check (fetched_count>=0);
create index ingest_runs_service_partition_idx on public.ingest_runs(service_key,partition_key,started_at desc);

create table public.procurement_agencies (
  id uuid primary key default gen_random_uuid(),
  code_namespace text not null,
  agency_code text not null,
  name text not null,
  aliases text[] not null default '{}',
  unique(code_namespace,agency_code)
);
alter table public.procurement_agencies enable row level security;
alter table public.bid_notices add column source_family text check (source_family in ('G2B','KWATER','LH','KEPCO'));
alter table public.bid_notices add column service_id text;
alter table public.bid_notices add column provider_company_id text;
alter table public.bid_notices add column provider_record_key text;
alter table public.bid_notices add column procuring_agency_id uuid references public.procurement_agencies(id);
create index bid_notices_family_agency_idx on public.bid_notices(source_family,procuring_agency_id,stage,published_at desc);

create table public.bid_opportunities (
  id uuid primary key default gen_random_uuid(),
  canonical_notice_id uuid not null references public.bid_notices(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  identity_version text not null default 'opportunity/v0.1',
  canonical_reason jsonb not null default '{"policy":"canonical/v0.1","reason":"INITIAL_RECORD"}',
  is_demo boolean not null,
  superseded_by uuid references public.bid_opportunities(id),
  check (superseded_by is distinct from id)
);
alter table public.bid_opportunities enable row level security;
create table public.opportunity_notice_links (
  bid_id uuid primary key references public.bid_notices(id) on delete cascade,
  opportunity_id uuid not null references public.bid_opportunities(id) on delete cascade,
  relation text not null check (relation in ('PRIMARY','DUPLICATE','STAGE_LINK')),
  evidence jsonb not null default '{}',
  policy_version text not null default 'opportunity/v0.1',
  history jsonb not null default '[]' check (jsonb_typeof(history)='array'),
  decided_at timestamptz not null default now()
);
alter table public.opportunity_notice_links enable row level security;
create index opportunity_notice_links_opportunity_idx on public.opportunity_notice_links(opportunity_id);
create table public.notice_match_candidates (
  id uuid primary key default gen_random_uuid(),
  left_bid_id uuid not null references public.bid_notices(id) on delete cascade,
  right_bid_id uuid not null references public.bid_notices(id) on delete cascade,
  outcome text not null check (outcome in ('CONFIRMED_DUPLICATE','CANDIDATE','DISTINCT')),
  reasons text[] not null default '{}',
  evidence jsonb not null default '{}',
  policy_version text not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  check (left_bid_id < right_bid_id),
  unique(left_bid_id,right_bid_id,policy_version,input_hash)
);
alter table public.notice_match_candidates enable row level security;
create table public.bid_notice_events (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bid_notices(id) on delete cascade,
  revision_id uuid not null references public.bid_revisions(id) on delete cascade,
  kind text not null check (kind in ('CREATED','AMENDED','CANCELLED','FAILED','OPENED','ENDED')),
  provider_status text,
  occurred_at timestamptz not null default now(),
  related_bid_id uuid references public.bid_notices(id),
  evidence jsonb not null default '{}',
  unique(revision_id,kind),
  foreign key(revision_id,bid_id) references public.bid_revisions(id,bid_id) on delete cascade
);
alter table public.bid_notice_events enable row level security;
create table public.bid_relevance_assessments (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.bid_revisions(id) on delete cascade,
  policy_version text not null,
  input_hash text not null,
  state text not null check (state in ('UNCLASSIFIED','CANDIDATE','RELEVANT','LOW_RELEVANCE','NEEDS_REVIEW')),
  categories text[] not null default '{}',
  tags text[] not null default '{}',
  relevance_score integer check (relevance_score between 0 and 100),
  evidence jsonb not null default '[]',
  missing_channels text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(revision_id,policy_version,input_hash)
);
alter table public.bid_relevance_assessments enable row level security;
create index bid_relevance_revision_idx on public.bid_relevance_assessments(revision_id,created_at desc,id);

-- Storage 원장과 중복되지 않는 전송/처리 증거. 정제 payload만 저장하고 원문 object 참조는 통합 후 사용한다.
create table public.ingest_payloads (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ingest_runs(id) on delete cascade,
  service_key text not null,
  operation text not null,
  partition_key text not null default '',
  content_type text not null,
  sanitized_payload jsonb not null,
  object_ref text,
  payload_hash text not null,
  parser_version text not null default 'external-envelope/v0.1',
  fetched_at timestamptz not null default now(),
  unique(run_id,service_key,operation,partition_key,payload_hash),
  check (octet_length(sanitized_payload::text)<=2097152)
);
alter table public.ingest_payloads enable row level security;
create table public.ingest_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ingest_runs(id) on delete cascade,
  source_record_key text not null,
  payload_hash text not null,
  payload_id uuid references public.ingest_payloads(id),
  bid_id uuid references public.bid_notices(id) on delete set null,
  revision_id uuid references public.bid_revisions(id) on delete set null,
  outcome text not null check (outcome in ('CREATED','CHANGED','CANCELLED','DUPLICATE','QUARANTINED')),
  error_code text,
  created_at timestamptz not null default now(),
  unique(run_id,source_record_key,payload_hash)
);
alter table public.ingest_run_items enable row level security;

-- 새 공고는 항상 자기 사업기회에서 시작한다. 유사 제목만으로 합치는 트리거는 두지 않는다.
create function public.initialize_bid_opportunity() returns trigger language plpgsql set search_path='' as $$
declare v_id uuid;
begin
  insert into public.bid_opportunities(canonical_notice_id,first_seen_at,is_demo)
  values(new.id,new.created_at,new.is_demo) returning id into v_id;
  insert into public.opportunity_notice_links(bid_id,opportunity_id,relation)
  values(new.id,v_id,'PRIMARY');
  return new;
end;
$$;
revoke all on function public.initialize_bid_opportunity() from public,anon,authenticated;
create trigger initialize_bid_opportunity after insert on public.bid_notices
  for each row execute function public.initialize_bid_opportunity();
insert into public.bid_opportunities(canonical_notice_id,first_seen_at,is_demo)
  select id,created_at,is_demo from public.bid_notices;
insert into public.opportunity_notice_links(bid_id,opportunity_id,relation)
  select canonical_notice_id,id,'PRIMARY' from public.bid_opportunities;

create function public.populate_procurement_source() returns trigger language plpgsql set search_path='' as $$
begin
  new.source_family := case when new.source like 'g2b-%' then 'G2B'
    when new.source like 'kwater-%' then 'KWATER' when new.source like 'lh-%' then 'LH'
    when new.source='kepco-ebid-contract' then 'KEPCO' else null end;
  new.service_id := case new.source when 'g2b-bid-notice' then '15129394' when 'g2b-pre-spec' then '15129437'
    when 'g2b-order-plan' then '15129462' when 'g2b-procurement-request' then '15129468'
    when 'kwater-bid-notice' then '15101635' when 'kwater-procurement-plan' then '15102588'
    when 'lh-bid-notice' then '15159012' when 'lh-pre-specification' then '15159011'
    when 'kepco-ebid-contract' then '15148223' else null end;
  return new;
end;
$$;
revoke all on function public.populate_procurement_source() from public,anon,authenticated;
create trigger populate_procurement_source before insert or update of source on public.bid_notices
  for each row execute function public.populate_procurement_source();
update public.bid_notices set source=source;

-- 출처의 수정/취소와 분리 후에도 동일한 대표 선정 규칙을 적용한다.
create function public.refresh_bid_opportunity(p_id uuid) returns void language plpgsql set search_path='' as $$
declare chosen public.bid_notices;
begin
  perform 1 from public.bid_opportunities where id=p_id for update;
  select n.* into chosen from public.opportunity_notice_links l join public.bid_notices n on n.id=l.bid_id
    where l.opportunity_id=p_id order by
    case when n.stage='NOTICE' and n.status<>'CANCELLED' then 0 when n.stage='NOTICE' then 1
      when n.stage='PRE_SPEC' then 2 when n.stage='PROCUREMENT_REQUEST' then 3 when n.stage='PLAN' then 4 else 5 end,
    case when n.source_family in ('KWATER','LH','KEPCO') then 0 else 1 end,
    n.published_at desc nulls last,n.id limit 1;
  if chosen.id is null then return; end if;
  update public.bid_opportunities set canonical_notice_id=chosen.id,
    canonical_reason=jsonb_build_object('policy','canonical/v0.1','reason','VALID_NOTICE_THEN_NATIVE_SOURCE_THEN_PUBLISHED_ID',
      'bidId',chosen.id,'stage',chosen.stage,'status',chosen.status,'source',chosen.source,'publishedAt',chosen.published_at)
    where id=p_id;
end;
$$;
revoke all on function public.refresh_bid_opportunity(uuid) from public,anon,authenticated;
create function public.refresh_changed_bid_opportunity() returns trigger language plpgsql set search_path='' as $$
begin
  perform public.refresh_bid_opportunity((select opportunity_id from public.opportunity_notice_links where bid_id=new.id));
  return new;
end;
$$;
revoke all on function public.refresh_changed_bid_opportunity() from public,anon,authenticated;
create trigger refresh_changed_bid_opportunity after update of status,stage,published_at,source,latest_revision on public.bid_notices
  for each row execute function public.refresh_changed_bid_opportunity();

-- Worker/운영자 CLI만 확정 증거로 연결한다. 원래 FK는 이동하지 않고 연결의 이전 상태를 보존한다.
create function public.link_bid_opportunity(p_bid_id uuid,p_opportunity_id uuid,p_relation text,p_evidence jsonb)
returns void language plpgsql set search_path='' as $$
declare v_old public.opportunity_notice_links; v_demo boolean; v_target public.bid_opportunities;
begin
  if p_relation not in ('PRIMARY','DUPLICATE','STAGE_LINK')
    or jsonb_typeof(p_evidence) is distinct from 'object'
    or coalesce(p_evidence->>'kind','') not in ('OFFICIAL_REFERENCE','OPERATOR_CONFIRMED')
    or nullif(p_evidence->>'reference','') is null then raise exception 'verified identity evidence required'; end if;
  -- 연결 작업은 드물다. 반대 방향 동시 병합의 순환·교착을 막고 대표/이전 기회를 같은 잠금 아래 바꾼다.
  lock table public.bid_opportunities in share row exclusive mode;
  select * into strict v_old from public.opportunity_notice_links where bid_id=p_bid_id for update;
  select * into strict v_target from public.bid_opportunities where id=p_opportunity_id for update;
  select is_demo into strict v_demo from public.bid_notices where id=p_bid_id;
  if v_demo is distinct from v_target.is_demo then raise exception 'origin mismatch'; end if;
  if v_target.superseded_by is not null then raise exception 'target superseded'; end if;
  if v_old.opportunity_id=p_opportunity_id then return; end if;
  update public.opportunity_notice_links set opportunity_id=p_opportunity_id,relation=p_relation,evidence=p_evidence,
    history=history||jsonb_build_array(jsonb_build_object('opportunityId',v_old.opportunity_id,'relation',v_old.relation,'evidence',v_old.evidence,'decidedAt',v_old.decided_at)),decided_at=now()
    where bid_id=p_bid_id;
  if not exists(select 1 from public.opportunity_notice_links where opportunity_id=v_old.opportunity_id) then
    update public.bid_opportunities set superseded_by=p_opportunity_id where id=v_old.opportunity_id;
  else
    perform public.refresh_bid_opportunity(v_old.opportunity_id);
  end if;
  update public.bid_opportunities set first_seen_at=least(first_seen_at,(select first_seen_at from public.bid_opportunities where id=v_old.opportunity_id)) where id=p_opportunity_id;
  perform public.refresh_bid_opportunity(p_opportunity_id);
end;
$$;
revoke all on function public.link_bid_opportunity(uuid,uuid,text,jsonb) from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array['procurement_agencies','bid_opportunities','opportunity_notice_links','notice_match_candidates','bid_notice_events','bid_relevance_assessments'] loop
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    execute format('grant select on table public.%I to authenticated',t);
    execute format('create policy "활동 중 회원 읽기" on public.%I for select to authenticated using ((select public.is_active_user()))',t);
  end loop;
  foreach t in array array['ingest_payloads','ingest_run_items'] loop
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
  end loop;
  if exists(select 1 from pg_roles where rolname='service_role') then
    foreach t in array array['procurement_agencies','bid_opportunities','opportunity_notice_links','notice_match_candidates','bid_notice_events','bid_relevance_assessments','ingest_payloads','ingest_run_items'] loop
      execute format('grant all on table public.%I to service_role',t);
    end loop;
    grant execute on function public.link_bid_opportunity(uuid,uuid,text,jsonb) to service_role;
    grant execute on function public.refresh_bid_opportunity(uuid) to service_role;
  end if;
end;
$$;
