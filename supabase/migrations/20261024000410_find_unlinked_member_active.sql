-- N4b 후속: 가입 신청의 명부 찾기는 재직(ACTIVE) 직원만 돌려준다.
-- 20261024000300 의 find_unlinked_member 본문 그대로에 재직 조건 한 줄만 더한다(서명·반환형·권한 그대로).
-- 퇴사 직원의 계정 연결은 20261024000400 의 team_members_reject_left_link 트리거가 따로 막는다.
create or replace function public.find_unlinked_member(p_department text, p_name text)
returns table (id uuid, person_code text, name text, job_title_label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'not_active' using errcode = 'P0001', hint = 'not_active';
  end if;
  return query
    select m.id, m.person_code, m.name, j.label
    from public.team_members m
    join public.departments d on d.id = m.department_id and d.org_id = m.org_id
    join public.job_titles j on j.id = m.job_title_id and j.org_id = m.org_id
    where m.org_id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
      and m.is_demo
      and m.user_id is null
      and m.employment_status = 'ACTIVE'
      and d.code = p_department
      and m.name = btrim(p_name)
    order by m.person_code
    limit 1;
end;
$$;
revoke execute on function public.find_unlinked_member(text, text) from public, anon, authenticated;
grant execute on function public.find_unlinked_member(text, text) to authenticated;
