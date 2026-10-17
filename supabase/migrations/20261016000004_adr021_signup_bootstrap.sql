-- ADR-021: 신고 소속은 TEAM(기존 null 포함)만 허용한다.
-- 신규 Auth 계정은 프로필만 만든다. 이전 개인 조직·멤버십과 역사적 생성 함수는 보존한다.
-- 배포는 Task 8의 무조직 계정 라우팅과 함께 진행한다.

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
        and coalesce(d.kind, 'TEAM') = 'TEAM'
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

-- org-01 UUID는 DNS UUIDv5('sol-radar:org-01')다. 임의 조직·인원·권한은 받거나 반환하지 않는다.
create or replace function public.resolve_solideo_employment(p_department text, p_job_title text)
returns table (department_id uuid, department_code text, department_name text,
  job_title_id uuid, job_title_code text, job_title_label text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  return query
    select d.id, d.code, d.name, j.id, j.code, j.label
    from public.departments d join public.job_titles j on j.org_id = d.org_id
    where d.org_id = 'db4c863c-cb6a-593d-93ff-709a17e0157a'::uuid
      and coalesce(d.kind, 'TEAM') = 'TEAM'
      and (d.code = p_department or d.id::text = p_department)
      and (j.code = p_job_title or j.id::text = p_job_title);
  if not found then
    raise exception 'invalid_employment' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.resolve_solideo_employment(text, text) from public, anon, authenticated;
grant execute on function public.resolve_solideo_employment(text, text) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  department uuid;
  job_title uuid;
begin
  -- 키가 둘 다 없는 OAuth만 미완료로 생성한다. null·빈 값·일부 키는 잘못된 신고다.
  if new.raw_user_meta_data ? 'department_code' or new.raw_user_meta_data ? 'job_title_code' then
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
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
