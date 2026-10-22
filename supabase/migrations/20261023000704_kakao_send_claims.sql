-- ADR-038: record the delivery intention before the external side effect.
-- A claim is never leased or automatically released: interruption after claiming may drop one message,
-- while success followed by a lost DB response must never trigger another external send.
create table if not exists public.kakao_send_claims (
  claim_key text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  bid_id uuid references public.bid_notices(id) on delete cascade,
  outbox_event_id uuid references public.outbox_events(id) on delete set null,
  notification_id uuid references public.notifications(id) on delete set null,
  claimed_at timestamptz not null default now()
);
alter table public.kakao_send_claims enable row level security;
revoke all on table public.kakao_send_claims from public,anon,authenticated;

create or replace function public.claim_kakao_notification(p_notification_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n public.notifications; v_bid_id uuid; v_claimed text;
begin
  select * into n from public.notifications where id=p_notification_id for update;
  if not found or n.channel<>'KAKAO' or n.type<>'BID_RECOMMENDED'
    or n.status not in ('PENDING','FAILED') then return false; end if;
  v_bid_id := (n.payload->>'bidId')::uuid;
  if v_bid_id is null then return false; end if;
  -- Includes receipts written before this migration. Unknown outcomes are terminal too.
  if exists(select 1 from public.notifications x where x.user_id=n.user_id
    and x.channel='KAKAO' and x.type='BID_RECOMMENDED' and x.payload->>'bidId'=v_bid_id::text
    and (x.status='SENT' or (x.status='DEAD' and x.error='TIMEOUT_UNKNOWN'))) then return false; end if;
  -- The exact user+bid unique key serializes different events and organizations without a hash collision.
  insert into public.kakao_send_claims(claim_key,user_id,bid_id,notification_id)
  values('BID:'||n.user_id::text||':'||v_bid_id::text,n.user_id,v_bid_id,n.id)
  on conflict(claim_key) do nothing returning claim_key into v_claimed;
  if v_claimed is null then return false; end if;
  update public.notifications set status='DEAD',error='TIMEOUT_UNKNOWN' where id=n.id;
  return true;
end;
$$;

create or replace function public.claim_kakao_test(p_outbox_event_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare e public.outbox_events; v_user_id uuid; v_claimed text;
begin
  select * into e from public.outbox_events where id=p_outbox_event_id for update;
  if not found or e.event_type<>'KAKAO_TEST' or e.status not in ('PENDING','FAILED') then return false; end if;
  v_user_id := (e.payload->>'userId')::uuid;
  if v_user_id is null then return false; end if;
  insert into public.kakao_send_claims(claim_key,user_id,outbox_event_id)
  values('TEST:'||e.id::text,v_user_id,e.id)
  on conflict(claim_key) do nothing returning claim_key into v_claimed;
  return v_claimed is not null;
end;
$$;
revoke all on function public.claim_kakao_notification(uuid) from public,anon,authenticated;
revoke all on function public.claim_kakao_test(uuid) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
  revoke all on table public.kakao_send_claims from service_role;
  grant select,insert on public.kakao_send_claims to service_role;
  grant execute on function public.claim_kakao_notification(uuid) to service_role;
  grant execute on function public.claim_kakao_test(uuid) to service_role;
end if; end $$;
