-- 참고 낙찰가 범위(스펙 polaris/specs/in-progress/2026-11-02-award-reference-price.md, ADR-077)
--
-- 나라장터 지난 공고와 낙찰 결과를 공고번호·차수로 이은 행이다. 공고 상세 카드가 같은 분류·비슷한 금액대의
-- 낙찰률(낙찰금액 ÷ 기준금액) 사분위를 계산할 때 읽는다.
-- - 지난 공고는 bid_notices·bid_revisions 에 넣지 않는다. 넣으면 공고 목록·분석·알림에 섞인다.
-- - 낙찰업체명·사업자번호·담당자는 저장하지 않는다(화면에 쓰지 않고 경쟁사 분석으로 읽힐 수 있다, ADR-007).
-- - 쓰기는 운영자 CLI(web/worker/award-backfill.ts, service role)만 한다. 회원은 읽기만 한다.
-- - 운영에는 db:push 대신 이 SQL 을 직접 실행할 수 있다(ADR-075 선례). 다시 돌려도 해가 없게 if not exists·drop if exists 꼴로 쓴다.

create table if not exists public.procurement_award_history (
  id uuid primary key default gen_random_uuid(),
  bid_notice_no text not null,
  bid_notice_ord text not null,
  title text not null,
  procurement_class_no text not null,
  procurement_class_name text not null,
  procurement_mid_class_name text,
  award_method_name text not null,
  award_method_group text not null
    check (award_method_group in ('NEGOTIATION', 'LOWER_LIMIT')),
  base_amount_krw bigint not null check (base_amount_krw > 0),
  base_amount_kind text not null
    check (base_amount_kind in ('ASSIGNED_BUDGET', 'ESTIMATED_PLUS_VAT')),
  award_amount_krw bigint not null check (award_amount_krw > 0),
  award_ratio numeric(6, 4) not null check (award_ratio between 0.3 and 1.2),
  participant_count integer check (participant_count is null or participant_count >= 0),
  opened_at timestamptz not null,
  demand_agency text,
  fetched_at timestamptz not null default now(),
  constraint procurement_award_history_notice_key unique (bid_notice_no, bid_notice_ord)
);

comment on table public.procurement_award_history is
  '나라장터 지난 낙찰 이력(참고 낙찰가 범위용). 운영자 CLI 만 쓴다. 낙찰업체 정보는 저장하지 않는다.';

create index if not exists procurement_award_history_class_idx
  on public.procurement_award_history (procurement_class_no, award_method_group, opened_at);
create index if not exists procurement_award_history_mid_class_idx
  on public.procurement_award_history (procurement_mid_class_name, award_method_group, opened_at);

alter table public.procurement_award_history enable row level security;

revoke all on table public.procurement_award_history from anon, authenticated;
grant select on table public.procurement_award_history to authenticated;

drop policy if exists "활동 중 회원은 낙찰 이력 읽기" on public.procurement_award_history;
create policy "활동 중 회원은 낙찰 이력 읽기"
  on public.procurement_award_history for select
  to authenticated
  using ((select public.is_active_user()));
