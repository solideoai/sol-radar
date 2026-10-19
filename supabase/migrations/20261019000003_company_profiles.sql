-- 20261019000003_company_profiles — 회사 프로필(조직별, revision 으로 쌓는다).
--
-- 근거: docs/04-DATABASE.md §3.2·§7 순서 3, docs/09-SECURITY.md RBAC(프로필 개정은 ADMIN), ADR-019·020.
-- ADR-020 의 열(is_demo·industry_codes·technologies_complete, licenses[].status 는 JSONB 안)을 처음부터 넣는다.
--
-- 행은 불변이다. 고치려면 새 revision 을 넣는다(update·delete 권한 없음). revision 은 서버가 최신 + 1 로 넣고,
-- 동시 요청이 겹치면 UNIQUE(org_id, revision) 가 거절한다. is_demo 는 화면 역할의 insert 열 권한에서 빼서 기본값
-- true 만 들어간다(회사 프로필은 모든 실행 모드에서 가상 솔리데오 프로필이다). JSONB 안쪽은 zod 가 검증한다(04 §1).
--
-- 이 파일에 든 것:
--   1. company_profiles — 표·제약·인덱스.
--   2. 권한·정책 — 조직 전원 읽기, 역할 ADMIN 의 insert 만(created_by 는 DB 가 로그인한 사람으로 채운다).
--
-- 감사 기록(PROFILE_CREATE_REVISION)은 audit_logs 가 생긴 뒤 20261019000007 의 트리거가 남긴다.
-- 되돌리기(새 마이그레이션으로): score_runs 등 이 표를 가리키는 표를 먼저 지운 뒤 drop table public.company_profiles.

-- ────────────────────────────────────────────────────────────────
-- 1. company_profiles
-- ────────────────────────────────────────────────────────────────
create table if not exists public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  revision integer not null,
  name text not null,
  -- {name, level?, ...}[] — 회사가 쓰는 기술. technologies_complete 가 true 면 전체 목록(없는 기술은 명시적 부정 근거).
  technologies jsonb not null default '[]'::jsonb,
  technologies_complete boolean not null default false,
  -- {code, name, status: HELD|NOT_HELD, validUntil?}[] — 목록에 없는 면허는 "모름".
  licenses jsonb not null default '[]'::jsonb,
  -- {code, name, status: HELD|NOT_HELD}[] — 나라장터 업종 코드.
  industry_codes jsonb not null default '[]'::jsonb,
  past_projects jsonb not null default '[]'::jsonb,
  -- {fiscalYear, annualRevenueKrw?, capitalKrw?, employeeCount?, creditRating?, maxContractKrw?} — 규모 적합성 요소.
  financials jsonb,
  -- {agencies[], agencyTypes[], domains[], excludedDomains[], excludedKeywords[]} — 전략적 선호 요소.
  preferences jsonb,
  is_demo boolean not null default true,
  effective_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint company_profiles_org_id_revision_key unique (org_id, revision),
  -- score_runs 가 (company_profile_id, org_id) 복합 FK 로 가리킨다(테넌트 혼입 방지).
  constraint company_profiles_id_org_id_key unique (id, org_id),
  constraint company_profiles_revision_check check (revision >= 1),
  constraint company_profiles_name_check check (name = btrim(name) and char_length(name) between 1 and 120)
);

alter table public.company_profiles enable row level security;

-- 최신 revision 찾기는 UNIQUE(org_id, revision) 인덱스가 맡는다. 계정이 지워질 때 외래 키가 만든 사람을 찾아 비우는 일.
create index if not exists company_profiles_created_by_idx on public.company_profiles (created_by);

-- ────────────────────────────────────────────────────────────────
-- 2. 권한과 정책
-- ────────────────────────────────────────────────────────────────
revoke all on table public.company_profiles from anon, authenticated, public;
grant select on table public.company_profiles to authenticated;
-- is_demo·created_by·created_at 은 열 권한이 없어 기본값만 들어간다.
grant insert (
  org_id, revision, name, technologies, technologies_complete, licenses, industry_codes,
  past_projects, financials, preferences, effective_at, note
) on table public.company_profiles to authenticated;

drop policy if exists "조직 회사 프로필 읽기" on public.company_profiles;
create policy "조직 회사 프로필 읽기"
  on public.company_profiles for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

-- created_by 는 열 권한이 없어 기본값(auth.uid())이 들어간다. 이 검사는 그 위의 두 번째 잠금이다.
drop policy if exists "ADMIN 은 회사 프로필 개정" on public.company_profiles;
create policy "ADMIN 은 회사 프로필 개정"
  on public.company_profiles for insert
  to authenticated
  with check (
    org_id in (select public.my_sol_org_ids(array['ADMIN']))
    and created_by = (select auth.uid())
  );
