-- 운영 적용 전 public.handle_new_user 정의(2026-10-27, 20261027000600 적용 직전, md5 9108156e0ff13ab6a2ef7dcc1b264098)
-- 되돌릴 때 이 정의로 create or replace 한다.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
