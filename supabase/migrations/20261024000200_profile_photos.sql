-- 2026-10-24 프로필 사진·명부 연결 1단계(설계 polaris/specs/in-progress/2026-10-24-profile-photo-member-link.md).
-- 사진은 private 버킷 profile-photos 에 둔다. 버킷은 SQL 이 아니라 scripts/ops/ensure-storage-buckets.mjs 가 만든다.
-- 브라우저가 사용자 JWT 로 직접 올리고(덮어쓰기 없음), 경로 포인터는 아래 security definer 함수로만 저장한다.
--   본인:   users/<auth uid>/<uuid>.(jpg|png|webp)
--   관리자: members/<team_member id>/<uuid>.(jpg|png|webp)
-- 명부 연결은 team_members.user_id 다. 연결은 다음 migration 의 가입 신청 승인으로만 만든다.

-- ── 1. 사진 포인터 열 ────────────────────────────────────────

alter table public.profiles add column if not exists photo_path text;
alter table public.profiles drop constraint if exists profiles_photo_path_format;
alter table public.profiles
  add constraint profiles_photo_path_format check (
    photo_path is null or photo_path ~ ('^users/' || id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
  );

alter table public.team_members add column if not exists user_id uuid;
alter table public.team_members add column if not exists photo_path text;
alter table public.team_members
  drop constraint if exists team_members_user_id_key,
  drop constraint if exists team_members_user_id_fkey,
  drop constraint if exists team_members_photo_path_format;
alter table public.team_members
  add constraint team_members_user_id_key unique (user_id),
  add constraint team_members_user_id_fkey foreign key (user_id)
    references public.profiles(id) on delete set null,
  add constraint team_members_photo_path_format check (
    photo_path is null
    or photo_path ~ '^(users|members)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  );
comment on column public.team_members.user_id is
  'Auth profile linked by an approved join request; demo people stay unlinked until then.';

-- ── 2. 비데모 직원(신규 입사자) 허용 ─────────────────────────
-- 데모 200명 규칙(한글 3자·이름 중복 금지·성별·정장 사진)은 is_demo 행에만 건다(설계 C13).
-- seed upsert 는 on_conflict=id 라 이름 unique 를 부분 인덱스로 바꿔도 영향이 없다.

alter table public.team_members
  drop constraint if exists team_members_name_check,
  drop constraint if exists team_members_org_id_name_key,
  drop constraint if exists team_members_demo_name_format,
  drop constraint if exists team_members_name_length,
  drop constraint if exists team_members_demo_required;
alter table public.team_members alter column gender drop not null;
alter table public.team_members alter column portrait_path drop not null;
alter table public.team_members
  add constraint team_members_demo_name_format check (not is_demo or name ~ '^[가-힣]{3}$'),
  add constraint team_members_name_length check (
    is_demo or char_length(btrim(name)) between 1 and 40
  ),
  add constraint team_members_demo_required check (
    not is_demo or (gender is not null and portrait_path is not null)
  );
create unique index if not exists team_members_demo_name_key
  on public.team_members(org_id, name) where is_demo;

-- ── 3. 신규 입사자 직원 번호 ─────────────────────────────────
-- 번호 규칙은 여기 한 곳에만 둔다. 가입 신청 승인과 N4b 직원 추가가 같은 함수를 부른다.
-- 화면 역할은 실행하지 못한다. security definer 함수 안에서만 부른다.

create or replace function public.next_new_hire_person_code(p_org uuid)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  last_number integer;
begin
  perform pg_advisory_xact_lock(hashtext('sol_new_hire_code'));
  select coalesce(max(substring(m.person_code from 6)::integer), 0) into last_number
  from public.team_members m
  where m.org_id = p_org and m.person_code ~ '^SOL-N[0-9]{4}$';
  if last_number >= 9999 then
    raise exception 'new_hire_code_exhausted' using errcode = 'P0001', hint = 'new_hire_code_exhausted';
  end if;
  return 'SOL-N' || lpad((last_number + 1)::text, 4, '0');
end;
$$;
revoke execute on function public.next_new_hire_person_code(uuid) from public, anon, authenticated;

-- ── 4. 사진 포인터 저장 함수 ─────────────────────────────────

-- 본인 사진. 명부에 연결돼 있으면 조직도 사진(team_members)을, 아니면 계정 사진(profiles)을 바꾼다(설계 C9).
-- null 은 사진 지우기다.
create or replace function public.set_my_photo(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_active_user() then
    raise exception 'not_active' using errcode = 'P0001', hint = 'not_active';
  end if;
  if p_path is not null
    and p_path !~ ('^users/' || uid::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'invalid_photo_path' using errcode = 'P0001', hint = 'invalid_photo_path';
  end if;
  update public.team_members set photo_path = p_path where user_id = uid;
  if not found then
    update public.profiles set photo_path = p_path where id = uid;
  end if;
end;
$$;
revoke execute on function public.set_my_photo(text) from public, anon, authenticated;
grant execute on function public.set_my_photo(text) to authenticated;

-- 관리자의 직원 사진 변경. 그 직원 조직의 ADMIN 만 한다. 없는 직원도 forbidden 으로 답해 존재를 드러내지 않는다.
create or replace function public.set_member_photo(p_member uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'not_active' using errcode = 'P0001', hint = 'not_active';
  end if;
  select m.org_id into target_org from public.team_members m where m.id = p_member;
  if target_org is null
    or target_org not in (select public.my_sol_org_ids(array['ADMIN'])) then
    raise exception 'forbidden' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_path is not null
    and p_path !~ ('^members/' || p_member::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'invalid_photo_path' using errcode = 'P0001', hint = 'invalid_photo_path';
  end if;
  update public.team_members set photo_path = p_path where id = p_member;
end;
$$;
revoke execute on function public.set_member_photo(uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_photo(uuid, text) to authenticated;

-- ── 5. Storage 정책 ──────────────────────────────────────────
-- PGlite 시험 환경에 storage.foldername() 이 없어 split_part·정규식으로 경로를 본다.

drop policy if exists "profile_photos_insert" on storage.objects;
create policy "profile_photos_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (select public.is_active_user())
  and (
    name ~ ('^users/' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
    or (
      name ~ '^members/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
      and exists (
        select 1 from public.team_members m
        -- team_members 에도 name 열이 있어 객체 이름은 반드시 표 이름을 붙여 쓴다.
        where m.id::text = split_part(storage.objects.name, '/', 2)
          and m.org_id in (select public.my_sol_org_ids(array['ADMIN']))
      )
    )
  )
);

-- 본인 경로, 그리고 내 조직 명부가 가리키는 사진만 읽는다(signed URL 생성도 이 정책을 탄다).
drop policy if exists "profile_photos_read" on storage.objects;
create policy "profile_photos_read" on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (select public.is_active_user())
  and (
    (split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text)
    or exists (
      select 1 from public.team_members m
      where m.photo_path = storage.objects.name
        and m.org_id in (select public.my_org_ids())
    )
  )
);
