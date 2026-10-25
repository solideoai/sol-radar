-- 보안 검토(2026-10-25 통합 2차) 수정: 사진 상한을 Storage 의 실제 insert 경로에서 지킨다.
--
-- 낮음 1(격리 스택 실측으로 확인): 20261025000110 은 상한을 insert 정책(claim_own_photo_slot)에서만 셌다.
--   Storage API(v1.79.36 확인)는 업로드 권한을 사용자 역할 insert 로 시험한 뒤 일부러 롤백하고(canUpload → testPermission),
--   파일을 쓴 다음 실제 행은 superuser 트랜잭션(completeUpload → upsertObject)으로 넣는다. RLS 는 실제 insert 에 걸리지 않는다.
--   정책 안의 폴더 행 잠금도 시험과 함께 롤백돼, 동시 업로드가 모두 count=2 를 보고 통과했다
--   (단순 업로드 2개 동시 → 4장, 8개 동시 → 10장, TUS 완료 4개 동시 → 6장. 차례로 보내면 3장에서 막힘).
-- 수정: storage.objects 에 BEFORE INSERT 트리거를 둔다. 사용자 역할(authenticated)이 아닌 insert(Storage 의 superuser 포함)마다
--   본인 폴더(users/<id>/) 잠금 행을 갱신해 같은 폴더 insert 를 커밋까지 줄 세우고, 이미 3개면 photo_quota_exceeded 로 거부한다.
--   READ COMMITTED 의 뒤 트랜잭션은 잠금을 기다린 뒤 새 스냅숏으로 다시 세어 앞 트랜잭션의 객체를 본다.
--   사용자 역할 insert 는 RLS 를 반드시 타고, users/ 경로 insert 정책은 하나뿐이며 claim_own_photo_slot(같은 잠금 행)을 부른다.
--   그래서 트리거는 그 경우 정책에 맡긴다. 차례로 올리는 4번째는 파일을 쓰기 전에 403 으로 막히고(권한 시험),
--   동시에 시험을 통과한 업로드만 실제 insert 에서 트리거에 막혀 500 이 된다. 거부된 단순 업로드의 파일은 Storage 가 지운다
--   (uploader completeUpload 실패 → ObjectAdminDelete, 격리 스택 6차 실측 고아 0).
-- 낮음 3: claim_own_photo_slot 을 정지 계정이 /rpc 로 직접 불러도 폴더 행을 만들지 못하게 is_active_user() 를 더한다.
-- 바꾸지 않는 것: members/ 경로(ADMIN 전용)·다른 버킷·기존 객체(지우지 않는다)·파일당 2MB·형식 제한(버킷 설정).
-- 운영 적용 전 확인: postgres 가 storage.objects 에 트리거를 만들 수 있어야 한다(실행서 §3 의 읽기 SQL).
-- 되돌리기: 이 파일을 지우지 않는다(append-only). 새 migration 에서
--   drop trigger enforce_own_photo_quota on storage.objects; drop function public.enforce_own_photo_quota();
--   claim_own_photo_slot 은 20261025000110 의 본문으로 다시 정의한다.

-- ── 1. 실제 insert 의 상한 ───────────────────────────────────
-- 트리거 함수라 직접 부를 수 없다. postgres(BYPASSRLS) 소유 security definer 라 storage.objects 를 RLS 없이 센다.
create or replace function public.enforce_own_photo_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  own_folder text;
  used integer;
begin
  if new.bucket_id is distinct from 'profile-photos' then
    return new;
  end if;
  -- 사용자 역할 insert 는 insert 정책(claim_own_photo_slot)이 같은 잠금 행으로 세고, 실제 insert 면 잠금이 커밋까지 간다.
  -- 여기서 또 던지면 BEFORE ROW 트리거가 RLS 보다 먼저 돌아 Storage 권한 시험의 403 이 500 이 된다(격리 스택 6차 실측).
  -- security definer 안에서도 current_setting('role') 은 호출한 쪽의 SET ROLE 값이다.
  if current_setting('role', true) = 'authenticated' then
    return new;
  end if;
  own_folder := substring(new.name from '^users/[0-9a-f-]{36}/');
  if own_folder is null then
    return new;
  end if;
  insert into public.profile_photo_folders as f (folder) values (own_folder)
  on conflict (folder) do update set touched_at = clock_timestamp();
  select count(*) into used
  from storage.objects o
  where o.bucket_id = 'profile-photos'
    and left(o.name, length(own_folder)) = own_folder
    and o.name <> new.name;
  if used >= 3 then
    raise exception 'photo_quota_exceeded' using errcode = 'P0001', hint = 'photo_quota_exceeded';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_own_photo_quota() from public, anon, authenticated;

drop trigger if exists enforce_own_photo_quota on storage.objects;
create trigger enforce_own_photo_quota
  before insert on storage.objects
  for each row execute function public.enforce_own_photo_quota();

-- ── 2. 정책의 자리 확인: 정지 계정 제외 ──────────────────────
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
  if uid is null or not public.is_active_user()
    or p_bucket is distinct from 'profile-photos' or p_name is null then
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
