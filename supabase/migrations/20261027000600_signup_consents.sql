-- 가입 약관 동의 기록(2026-10-27 전체 점검 중간 등급).
-- 이메일 가입 화면은 이용약관·개인정보 수집·이용·만 14세 이상(필수)과 마케팅 정보 수신(선택) 동의를 받기만 하고 저장하지 않았다.
--
-- 1. user_consents — 사람 하나에 한 행. 필수 셋은 동의 시각(not null), 마케팅은 동의했을 때만 시각이다(null = 동의 안 함).
--    시각은 가입 트리거가 auth.users 행을 넣는 순간(now())이고, 화면이 보낸 시각을 믿지 않는다.
--    화면 역할(authenticated)은 본인 행을 읽기만 한다. 넣기는 가입 트리거(security definer)만 하고,
--    고치기·지우기 권한은 화면 역할에도 service_role 에도 주지 않는다. 탈퇴(auth.users 삭제)하면 profiles 와 함께 지워진다
--    (가입 화면의 개인정보 안내 "탈퇴하면 바로 지웁니다").
-- 2. handle_new_user — 이메일 가입(가입 정보에 department_code·job_title_code 키가 있음)은 consents 의 terms·privacy·age_over_14 가
--    모두 JSON true 일 때만 계정을 만든다. 아니면 consent_required(22023)로 거절해 auth.users 삽입이 통째로 되돌아간다.
--    화면 검증(sign-up-schema.ts)은 편의이고 이것이 막는다. consents.marketing 은 JSON true 일 때만 동의로 적는다.
--    가입 정보(user_metadata)의 consents 는 운반용이다. 사용자가 나중에 user_metadata 를 고쳐도 이 표는 바뀌지 않는다.
--    운영자 스크립트(admin API)로 만든 계정도 같은 키를 쓰면 같은 규칙을 지난다 — DB 는 두 경로를 구별할 수 없다.
--    간편 가입(OAuth, 두 키가 없음)은 지금처럼 동의 없이 미완료 프로필만 만든다(동의 화면은 후속 과제).
--    부서·직급 확인과 프로필 삽입은 20261016000004 본문 그대로다.
--
-- 되돌리기: handle_new_user 를 20261016000004 의 본문으로 다시 만들고 public.user_consents 를 drop 한다.

create table if not exists public.user_consents (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  terms_agreed_at timestamptz not null,
  privacy_agreed_at timestamptz not null,
  age_confirmed_at timestamptz not null,
  marketing_agreed_at timestamptz
);

alter table public.user_consents enable row level security;

revoke all on table public.user_consents from public, anon, authenticated;
grant select on table public.user_consents to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then
  revoke all on table public.user_consents from service_role;
  grant select on table public.user_consents to service_role;
end if; end $$;

drop policy if exists "본인 동의 기록만 읽기" on public.user_consents;
create policy "본인 동의 기록만 읽기"
  on public.user_consents for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  department uuid;
  job_title uuid;
  consents jsonb := new.raw_user_meta_data -> 'consents';
  is_email_signup boolean :=
    coalesce(new.raw_user_meta_data ? 'department_code' or new.raw_user_meta_data ? 'job_title_code', false);
begin
  if is_email_signup then
    -- 키가 없거나 true 가 아닌 값("true" 문자열·1 포함)은 동의가 아니다.
    if consents -> 'terms' is distinct from 'true'::jsonb
      or consents -> 'privacy' is distinct from 'true'::jsonb
      or consents -> 'age_over_14' is distinct from 'true'::jsonb then
      raise exception 'consent_required' using errcode = '22023';
    end if;
    -- 키가 둘 다 없는 OAuth만 미완료로 생성한다. null·빈 값·일부 키는 잘못된 신고다.
    select d.id, j.id into department, job_title
    from public.departments d join public.job_titles j on j.org_id = d.org_id
    where d.org_id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
      and coalesce(d.kind, 'TEAM') = 'TEAM'
      and d.code = new.raw_user_meta_data ->> 'department_code'
      and j.code = new.raw_user_meta_data ->> 'job_title_code';
    if not found then
      raise exception 'invalid_employment' using errcode = '22023';
    end if;
  end if;
  insert into public.profiles (id, email, display_name, avatar_url, declared_department_id, declared_job_title_id)
  values (new.id, new.email, public.display_name_from_metadata(new.raw_user_meta_data),
    public.avatar_url_from_metadata(new.raw_user_meta_data), department, job_title)
  on conflict (id) do nothing;
  if is_email_signup then
    insert into public.user_consents (user_id, terms_agreed_at, privacy_agreed_at, age_confirmed_at, marketing_agreed_at)
    values (new.id, now(), now(), now(),
      case when consents -> 'marketing' = 'true'::jsonb then now() end)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
