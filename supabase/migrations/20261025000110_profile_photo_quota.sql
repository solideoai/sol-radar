-- 보안 검토 L2(2026-10-25) 수정: 본인 폴더 사진 개수 상한과 본인 사진 삭제.
-- 20261024000200 의 insert 정책은 활동 회원이 users/<내 id>/ 에 사진(2MB 이하)을 개수 제한 없이 올리게 두었고 delete 정책이 없었다.
-- 공개 가입 → 이메일 확인 → 활동 회원이면 누구나 Storage 용량을 쌓을 수 있었다(데이터 노출은 없음).
--
-- 상한: 본인 폴더(users/<id>/)마다 객체 3개.
--   화면은 사람마다 사진 1장만 보여 준다(photo-picker). 바꾸기는 새 객체를 올린 뒤 포인터를 옮기므로 잠깐 2개가 되고,
--   올렸지만 포인터 저장에 실패한 객체 1개의 여유를 더해 3개다. 웹은 저장·지우기 뒤 쓰지 않는 객체를 지워 보통 1개로 둔다.
-- 강제 위치: Storage insert 정책(RLS). 브라우저가 사용자 JWT 로 Storage API 에 직접 올리므로 서버 API 를 거치지 않는다.
-- 동시 업로드: 폴더마다 profile_photo_folders 행 하나를 갱신해 같은 폴더의 insert 를 줄 세운다.
--   READ COMMITTED 는 앞 트랜잭션이 끝날 때까지 기다린 뒤 새 스냅숏으로 다시 세고, REPEATABLE READ 이상은 직렬화 오류로 실패한다.
--   검증: scripts/verify-photo-quota-concurrency.mjs(일회용 PostgreSQL, opt-in).
-- 파일당 2MB·형식 제한은 버킷 설정(scripts/ops/ensure-storage-buckets.mjs) 그대로다. 기존 객체는 지우지 않는다.
-- members/ 경로(그 조직 ADMIN 전용)는 바꾸지 않는다(해커톤 뒤 과제).
-- 되돌리기: 이 파일을 지우지 않는다(append-only). 새 migration 에서 20261024000200 의 insert 정책을 다시 만들고
--   profile_photos_delete_own 정책·두 함수·profile_photo_folders 표를 지운다.

-- ── 1. 폴더 잠금 행 ──────────────────────────────────────────
create table if not exists public.profile_photo_folders (
  folder text primary key check (folder ~ '^users/[0-9a-f-]{36}/$'),
  touched_at timestamptz not null default now()
);
comment on table public.profile_photo_folders is
  'One row per own photo folder; updated by claim_own_photo_slot to serialize concurrent uploads.';
alter table public.profile_photo_folders enable row level security;
revoke all on table public.profile_photo_folders from public, anon, authenticated;

-- ── 2. 업로드 자리 확인 ──────────────────────────────────────
-- insert 정책이 부른다. 내 폴더가 아니면 아무것도 쓰지 않고 false.
-- postgres(BYPASSRLS) 소유 security definer 라 storage.objects 를 RLS 없이 센다.
create or replace function public.claim_own_photo_slot(p_bucket text, p_name text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  own_folder text;
  used integer;
begin
  if uid is null or p_bucket is distinct from 'profile-photos' or p_name is null then
    return false;
  end if;
  own_folder := 'users/' || uid::text || '/';
  if left(p_name, length(own_folder)) <> own_folder then
    return false;
  end if;
  insert into public.profile_photo_folders as f (folder) values (own_folder)
  on conflict (folder) do update set touched_at = clock_timestamp();
  select count(*) into used
  from storage.objects o
  where o.bucket_id = 'profile-photos' and left(o.name, length(own_folder)) = own_folder;
  return used < 3;
end;
$$;
revoke execute on function public.claim_own_photo_slot(text, text) from public, anon, authenticated;
grant execute on function public.claim_own_photo_slot(text, text) to authenticated;

-- ── 3. 지워도 되는 내 사진 ───────────────────────────────────
-- 내 폴더에 있고 계정 사진·조직도 사진·대기 신청 사진 어디에서도 쓰지 않는 객체만 true.
-- 남의 행을 RLS 없이 봐야 해서 security definer 다. 내 폴더가 아닌 경로는 묻지도 않고 false.
create or replace function public.own_photo_deletable(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or p_bucket is distinct from 'profile-photos' or p_name is null
    or left(p_name, length('users/' || uid::text || '/')) <> 'users/' || uid::text || '/' then
    return false;
  end if;
  return not exists (select 1 from public.profiles p where p.photo_path = p_name)
    and not exists (select 1 from public.team_members m where m.photo_path = p_name)
    and not exists (
      select 1 from public.member_join_requests r
      where r.applicant_photo_path = p_name and r.status = 'PENDING'
    );
end;
$$;
revoke execute on function public.own_photo_deletable(text, text) from public, anon, authenticated;
grant execute on function public.own_photo_deletable(text, text) to authenticated;

-- ── 4. Storage 정책 ──────────────────────────────────────────
-- insert: 20261024000200 의 정책 그대로에 본인 경로만 자리 확인을 더한다.
drop policy if exists "profile_photos_insert" on storage.objects;
create policy "profile_photos_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (select public.is_active_user())
  and (
    (
      name ~ ('^users/' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
      and public.claim_own_photo_slot(bucket_id, name)
    )
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

-- delete: 본인이 쓰지 않는 자기 사진만. Storage API 의 삭제는 읽기 정책(본인 경로 읽기)도 함께 탄다.
drop policy if exists "profile_photos_delete_own" on storage.objects;
create policy "profile_photos_delete_own" on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and (select public.is_active_user())
  and public.own_photo_deletable(bucket_id, name)
);
