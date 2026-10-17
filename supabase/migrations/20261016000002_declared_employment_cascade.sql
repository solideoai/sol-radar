-- 조직 삭제 시 두 카탈로그가 먼저 지워지고 신고 FK의 SET NULL이 차례로 실행된다.
-- 아직 정리 중인 다른 FK를 재검증하지 않고 이번에 새로 신고한 값만 검증한다.
create or replace function public.check_declared_employment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.declared_department_id is not null
    and (tg_op = 'INSERT' or new.declared_department_id is distinct from old.declared_department_id)
    and not exists (
      select 1 from public.departments d where d.id = new.declared_department_id
        and d.org_id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
    ) then
    raise exception 'invalid_employment' using errcode = '22023';
  end if;
  if new.declared_job_title_id is not null
    and (tg_op = 'INSERT' or new.declared_job_title_id is distinct from old.declared_job_title_id)
    and not exists (
      select 1 from public.job_titles j where j.id = new.declared_job_title_id
        and j.org_id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
    ) then
    raise exception 'invalid_employment' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_declared_employment() from public, anon, authenticated;
