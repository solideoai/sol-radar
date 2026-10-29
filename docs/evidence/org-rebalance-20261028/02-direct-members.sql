-- 2026-10-28 ADR-063: 그룹·본부 직속 배치(운영 org-01). 20261028000100 적용 뒤에만. 한 문장(DO)이라 전부 적용되거나 전부 취소된다.
do $$
declare
  v_org constant uuid := 'db4c863c-cb6a-593d-93ff-709a17e0157a';
  v_req constant text := 'ops-20261028-org-rebalance';
  v_move record;
  v_member public.team_members%rowtype;
  v_to uuid;
  v_title uuid;
begin
  if exists (select 1 from pg_trigger where tgname = 'team_members_check_department'
      and tgrelid = 'public.team_members'::regclass) then
    raise exception 'precondition: migration 20261028000100 not applied';
  end if;

  for v_move in
    select * from (values
      ('SOL-P0144','SOL-D050','SOL-D039',null), ('SOL-P0049','SOL-D050','SOL-D039',null),
      ('SOL-P0195','SOL-D050','SOL-D039',null), ('SOL-P0094','SOL-D050','SOL-D019',null),
      ('SOL-P0065','SOL-D051','SOL-D040','SOL-J006'), ('SOL-P0117','SOL-D051','SOL-D023',null),
      ('SOL-P0037','SOL-D051','SOL-D007',null), ('SOL-P0055','SOL-D051','SOL-D011',null),
      ('SOL-P0099','SOL-D052','SOL-D041',null), ('SOL-P0178','SOL-D052','SOL-D041',null),
      ('SOL-P0138','SOL-D052','SOL-D041',null), ('SOL-P0059','SOL-D052','SOL-D012',null),
      ('SOL-P0082','SOL-D053','SOL-D043',null), ('SOL-P0112','SOL-D053','SOL-D043',null),
      ('SOL-P0002','SOL-D053','SOL-D043',null), ('SOL-P0132','SOL-D053','SOL-D026',null),
      ('SOL-P0029','SOL-D006','SOL-D048',null), ('SOL-P0030','SOL-D006','SOL-D048',null)
    ) as t(person_code, from_code, to_code, title_code)
  loop
    select m.* into v_member from public.team_members m
      join public.departments d on d.id = m.department_id
      where m.org_id = v_org and m.person_code = v_move.person_code and d.code = v_move.from_code
        and m.employment_status = 'ACTIVE' and m.user_id is null
      for update of m;
    if not found then raise exception 'move: % not in %', v_move.person_code, v_move.from_code; end if;
    select id into strict v_to from public.departments where org_id = v_org and code = v_move.to_code;
    v_title := v_member.job_title_id;
    if v_move.title_code is not null then
      select id into strict v_title from public.job_titles where org_id = v_org and code = v_move.title_code;
    end if;
    update public.team_members set department_id = v_to, job_title_id = v_title where id = v_member.id;
    insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
    values (v_org, null, 'TEAM_MEMBER_UPDATE', 'team_member', v_member.id,
      jsonb_build_object(
        'before', jsonb_build_object('departmentId', v_member.department_id, 'jobTitleId', v_member.job_title_id,
          'employmentStatus', v_member.employment_status),
        'after', jsonb_build_object('departmentId', v_to, 'jobTitleId', v_title,
          'employmentStatus', v_member.employment_status)),
      v_req);
  end loop;

  -- 같은 날 만든 그룹 아래 새 팀 4개는 비었으니 지운다(ADR-063).
  delete from public.departments where org_id = v_org and code in ('SOL-D050','SOL-D051','SOL-D052','SOL-D053');
  if (select count(*) from public.departments where org_id = v_org and code like 'SOL-D05%') <> 0 then
    raise exception 'delete: new teams remain';
  end if;

  update public.departments d set target_count = c.n
  from (select d2.id, count(m.id) filter (where m.employment_status = 'ACTIVE') n
        from public.departments d2 left join public.team_members m on m.department_id = d2.id
        where d2.org_id = v_org and d2.kind = 'TEAM' group by d2.id) c
  where d.id = c.id and d.target_count is distinct from c.n;

  -- 사후 조건: 총원 200, 0명 부서(하위 포함) 없음, 직속 인원 3·1·3·3·2
  if (select count(*) from public.team_members where org_id = v_org and employment_status = 'ACTIVE') <> 200 then
    raise exception 'postcondition: active count changed';
  end if;
  if exists (
    with recursive tree as (
      select d.id, d.id root_id from public.departments d where d.org_id = v_org
      union all select c.id, t.root_id from public.departments c join tree t on c.parent_id = t.id
    )
    select 1 from public.departments d where d.org_id = v_org and not exists (
      select 1 from tree t join public.team_members m on m.department_id = t.id and m.employment_status = 'ACTIVE'
      where t.root_id = d.id)
  ) then
    raise exception 'postcondition: empty department remains';
  end if;
  if (select string_agg(d.code || '=' || (select count(*) from public.team_members m
        where m.department_id = d.id and m.employment_status = 'ACTIVE'), ',' order by d.code)
      from public.departments d where d.org_id = v_org and d.code in ('SOL-D039','SOL-D040','SOL-D041','SOL-D043','SOL-D048'))
      <> 'SOL-D039=3,SOL-D040=1,SOL-D041=3,SOL-D043=3,SOL-D048=2' then
    raise exception 'postcondition: direct counts differ';
  end if;
  -- DRY_RUN_MARKER
end;
$$;
