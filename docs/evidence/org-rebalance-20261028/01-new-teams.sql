-- 2026-10-28 조직도 0명 노드 해소(운영 org-01). 한 문장(DO)이라 전부 적용되거나 전부 취소된다.
do $$
declare
  v_org constant uuid := 'db4c863c-cb6a-593d-93ff-709a17e0157a';
  v_req constant text := 'ops-20261028-org-rebalance';
  v_move record;
  v_member public.team_members%rowtype;
  v_to uuid;
begin
  -- 1) 사전 조건: 새 코드 없음, 전략컨설팅팀 상위 없음
  if exists (select 1 from public.departments where org_id = v_org
      and code in ('SOL-D050','SOL-D051','SOL-D052','SOL-D053')) then
    raise exception 'precondition: new department codes already exist';
  end if;
  if (select parent_id from public.departments where org_id = v_org and code = 'SOL-D006') is not null then
    raise exception 'precondition: SOL-D006 already has a parent';
  end if;

  -- 2) 빈 그룹 밑 새 팀. id 는 people/seed.mjs catalogUuid(sol-radar:org-01:<code>) 와 같은 UUIDv5
  insert into public.departments (id, org_id, code, name, kind, parent_id, source_count, target_count, is_demo)
  select v.id::uuid, v_org, v.code, v.name, 'TEAM', g.id, 0, 4, true
  from (values
    ('0c99fbb6-a278-59d4-a274-9584ee1449dc', 'SOL-D050', '공공영업팀', 'SOL-D039'),
    ('687ed242-9e5a-50b2-95a0-1f0155ee8efb', 'SOL-D051', '사업혁신팀', 'SOL-D040'),
    ('11c5f131-9873-53dd-91b7-67d5b8310f03', 'SOL-D052', '품질&정보보호팀', 'SOL-D041'),
    ('888ccd95-f3b8-55c9-8f71-8da8f550b949', 'SOL-D053', '크리에이티브팀', 'SOL-D043')
  ) as v(id, code, name, group_code)
  join public.departments g on g.org_id = v_org and g.code = v.group_code and g.kind = 'GROUP';
  if not found then raise exception 'insert: group lookup failed'; end if;

  -- 3) P&AX컨설팅본부 전략컨설팅팀을 이름대로 P&AX컨설팅본부 밑에 연결(사람 이동 없음)
  update public.departments set parent_id = (
    select id from public.departments where org_id = v_org and code = 'SOL-D048' and kind = 'DIVISION')
  where org_id = v_org and code = 'SOL-D006';

  -- 4) 16개 팀에서 20명 이동. 팀장·본부장 제외, 현재 소속이 다르면 중단
  for v_move in
    select * from (values
      ('SOL-P0003','SOL-D001','SOL-D049'), ('SOL-P0183','SOL-D034','SOL-D049'),
      ('SOL-P0174','SOL-D033','SOL-D049'), ('SOL-P0150','SOL-D028','SOL-D049'),
      ('SOL-P0059','SOL-D012','SOL-D052'), ('SOL-P0099','SOL-D019','SOL-D052'),
      ('SOL-P0178','SOL-D034','SOL-D052'), ('SOL-P0138','SOL-D027','SOL-D052'),
      ('SOL-P0082','SOL-D017','SOL-D053'), ('SOL-P0132','SOL-D026','SOL-D053'),
      ('SOL-P0112','SOL-D022','SOL-D053'), ('SOL-P0002','SOL-D001','SOL-D053'),
      ('SOL-P0144','SOL-D028','SOL-D050'), ('SOL-P0049','SOL-D009','SOL-D050'),
      ('SOL-P0195','SOL-D038','SOL-D050'), ('SOL-P0094','SOL-D019','SOL-D050'),
      ('SOL-P0065','SOL-D013','SOL-D051'), ('SOL-P0117','SOL-D023','SOL-D051'),
      ('SOL-P0037','SOL-D007','SOL-D051'), ('SOL-P0055','SOL-D011','SOL-D051')
    ) as t(person_code, from_code, to_code)
  loop
    select m.* into v_member from public.team_members m
      join public.departments d on d.id = m.department_id
      join public.job_titles j on j.id = m.job_title_id
      where m.org_id = v_org and m.person_code = v_move.person_code and d.code = v_move.from_code
        and m.employment_status = 'ACTIVE' and m.user_id is null and j.label not in ('팀장','본부장')
      for update of m;
    if not found then raise exception 'move: % not in % as movable member', v_move.person_code, v_move.from_code; end if;
    select id into strict v_to from public.departments where org_id = v_org and code = v_move.to_code and kind = 'TEAM';
    update public.team_members set department_id = v_to where id = v_member.id;
    insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, before_after, request_id)
    values (v_org, null, 'TEAM_MEMBER_UPDATE', 'team_member', v_member.id,
      jsonb_build_object(
        'before', jsonb_build_object('departmentId', v_member.department_id, 'jobTitleId', v_member.job_title_id,
          'employmentStatus', v_member.employment_status),
        'after', jsonb_build_object('departmentId', v_to, 'jobTitleId', v_member.job_title_id,
          'employmentStatus', v_member.employment_status)),
      v_req);
  end loop;

  -- 5) 화면의 "목표 N명"을 새 인원과 맞춘다
  update public.departments d set target_count = c.n
  from (select d2.id, count(m.id) filter (where m.employment_status = 'ACTIVE') n
        from public.departments d2 left join public.team_members m on m.department_id = d2.id
        where d2.org_id = v_org and d2.kind = 'TEAM' group by d2.id) c
  where d.id = c.id and d.target_count is distinct from c.n;

  -- 6) 사후 조건: 0명 팀 없음, 총원 200, 모든 그룹·본부에 하위 팀
  if exists (select 1 from public.departments d where d.org_id = v_org and d.kind = 'TEAM'
      and not exists (select 1 from public.team_members m where m.department_id = d.id and m.employment_status = 'ACTIVE')) then
    raise exception 'postcondition: empty team remains';
  end if;
  if (select count(*) from public.team_members where org_id = v_org and employment_status = 'ACTIVE') <> 200 then
    raise exception 'postcondition: active count changed';
  end if;
  if exists (select 1 from public.departments p where p.org_id = v_org and p.kind in ('GROUP','DIVISION')
      and not exists (select 1 from public.departments c where c.parent_id = p.id and c.kind = 'TEAM')) then
    raise exception 'postcondition: group or division without team';
  end if;
  if exists (select 1 from public.departments where org_id = v_org and target_count < 4 and code in (
      'SOL-D001','SOL-D007','SOL-D009','SOL-D011','SOL-D012','SOL-D013','SOL-D017','SOL-D019',
      'SOL-D022','SOL-D023','SOL-D026','SOL-D027','SOL-D028','SOL-D033','SOL-D034','SOL-D038',
      'SOL-D049','SOL-D050','SOL-D051','SOL-D052','SOL-D053')) then
    raise exception 'postcondition: changed team below 4';
  end if;
  -- DRY_RUN_MARKER
end;
$$;
