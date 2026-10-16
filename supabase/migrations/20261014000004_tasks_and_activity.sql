-- 20261014000004_tasks_and_activity — 메모 견본을 작업(tasks)·활동 기록(activities) 견본으로 바꾼다.
--
-- 메모는 상태·숫자·관계가 없어 대시보드가 날짜별 작성 수밖에 보여 주지 못했다. 작업은 상태·마감일·담당자를 갖고,
-- 활동 기록은 조직 안에서 누가 언제 무엇을 했는지 남긴다. 둘 다 조직에 속하고 org_id 로 거른다.
-- 스펙: polaris/specs/done/tasks-and-activity.md (4장 인터페이스 계약, 5장 엣지 케이스)
--       polaris/specs/done/tasks-and-activity.design.md (3.4 활동 문장, 5 권한, 7 열린 질문의 기본값)
--
-- 이 파일에 든 것:
--   1. memos 를 지운다 — 표·정책과, memos.org_id 의 기본값으로만 쓰이던 personal_org_id().
--   2. tasks — 작업. 담당자는 같은 조직의 멤버만 되고, 멤버가 빠지면 담당자만 비운다.
--   3. tasks 의 시각 — completed_at·updated_at 은 DB 가 채운다.
--   4. activities — 활동 기록. 트리거만 쓰고, 표시할 값은 기록 시점에 사본으로 남긴다.
--   5. 활동을 남기는 트리거 — 작업·멤버십·초대.
--   6. 권한과 정책 — tasks·activities.
--   7. 대시보드 집계 함수 — task_dashboard_stats(조직, 기준 시각).
--
-- 이미 적용된 마이그레이션은 고치지 않는다(append-only). 앞의 파일이 만든 memos 는 여기서 지운다.
-- 모든 문장은 다시 적용해도 결과가 같다: 앞 파일들을 다시 돌리면 memos 가 다시 생기고, 이 파일이 다시 지운다.
-- 상태·종류 값은 enum 이 아니라 check 제약으로 묶는다(create type 은 다시 적용하면 실패한다).

-- ────────────────────────────────────────────────────────────────
-- 1. memos 를 지운다
--
-- 데이터는 옮기지 않는다(스펙 2장). 정책·인덱스·제약은 표와 함께 사라진다.
-- personal_org_id() 는 memos.org_id 의 기본값으로만 쓰였다. 기본값이 표와 함께 사라진 뒤에 지운다.
-- ────────────────────────────────────────────────────────────────
drop table if exists public.memos;
drop function if exists public.personal_org_id();

-- ────────────────────────────────────────────────────────────────
-- 2. tasks
--
-- 담당자(assignee_id)는 profiles 가 아니라 (org_id, assignee_id) 로 memberships 를 가리킨다. 그래서
--   - 다른 조직의 사람을 담당자로 넣으면 외래 키가 거절한다(23503, tasks_assignee_fkey).
--   - 멤버가 나가거나 내보내지거나 계정이 지워져 멤버십이 지워지면 assignee_id 만 비운다.
--     "on delete set null (assignee_id)" 처럼 열을 적어야 한다. 그냥 set null 은 org_id 까지 비우려다 not null 에 걸린다.
-- 외래 키 검사는 표 주인 권한으로 돌아 정책을 거치지 않는다. 그 전에 넣기·고치기 정책이 내 조직인지를 먼저 본다.
--
-- 만든 사람(created_by)은 기본값 auth.uid() 로 들어가고 화면 역할에는 그 열의 쓰기 권한이 없다(초대의 invited_by 와 같다).
-- 계정이 지워져도 작업은 남는다(on delete set null). 조직이 지워지면 작업도 지워진다.
-- ────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  title text not null,
  description text,
  status text not null default 'todo',
  -- 날짜만(시각 없음). 화면이 서울 날짜로 고른 값이다.
  due_date date,
  assignee_id uuid,
  created_by uuid default auth.uid(),
  -- 완료로 바뀐 시각. 아래 tasks_set_timestamps 트리거가 채우고 비운다.
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_org_id_fkey foreign key (org_id)
    references public.organizations (id) on delete cascade,
  constraint tasks_assignee_fkey foreign key (org_id, assignee_id)
    references public.memberships (org_id, user_id) on delete set null (assignee_id),
  constraint tasks_created_by_fkey foreign key (created_by)
    references public.profiles (id) on delete set null,
  constraint tasks_title_check check (title = btrim(title) and char_length(title) between 1 and 120),
  constraint tasks_description_check check (char_length(description) between 1 and 2000),
  constraint tasks_status_check check (status in ('todo', 'in_progress', 'done')),
  -- 트리거가 지키는 규칙의 두 번째 잠금: 완료일 때만 완료 시각이 있다.
  constraint tasks_completed_at_check check ((status = 'done') = (completed_at is not null))
);

alter table public.tasks enable row level security;

-- 목록은 조직 안에서 최근 만든 순·마감일 순으로 읽는다. 정책이 거르는 org_id 가 앞에 온다.
create index if not exists tasks_org_id_created_at_idx on public.tasks (org_id, created_at desc);
create index if not exists tasks_org_id_due_date_idx on public.tasks (org_id, due_date);
-- 담당자로 거르기와, 멤버십이 지워질 때 외래 키가 담당자를 찾아 비우는 일.
create index if not exists tasks_org_id_assignee_id_idx on public.tasks (org_id, assignee_id);
-- 계정이 지워질 때 외래 키가 만든 사람을 찾아 비우는 일.
create index if not exists tasks_created_by_idx on public.tasks (created_by);

-- ────────────────────────────────────────────────────────────────
-- 3. tasks 의 시각 — DB 가 채운다
--
-- 화면 역할에는 completed_at·updated_at·created_at 의 쓰기 권한이 없다. 앱처럼 서버를 거치지 않는 요청도 같은 값을 얻는다.
-- 관리 작업(JWT 없음)이 완료된 작업을 완료 시각과 함께 넣으면 그 시각을 쓴다(지난 자료 채우기·시험).
-- ────────────────────────────────────────────────────────────────
create or replace function public.set_task_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'done' then
    new.completed_at := null;
  elsif tg_op = 'INSERT' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif old.status <> 'done' then
    new.completed_at := now();
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_set_timestamps on public.tasks;
create trigger tasks_set_timestamps
  before insert or update on public.tasks
  for each row execute function public.set_task_timestamps();

-- ────────────────────────────────────────────────────────────────
-- 4. activities — 활동 기록
--
-- 화면 역할은 읽기만 한다. 행은 아래 5절의 트리거만 넣는다(security definer).
-- 대상이 지워지거나 떠나도 기록이 읽히도록 표시할 값을 기록 시점에 사본으로 남긴다:
--   task_title  — 작업 기록의 제목(그 뒤 제목을 고쳐도, 작업을 지워도 그대로다)
--   target_name — 멤버 기록의 대상, 담당자 바꿈의 새 담당자 이름(표시 이름, 없으면 이메일 @ 앞)
--   old_role·new_role — 역할 바뀜의 전후 역할, 초대 보냄의 역할(new_role)
-- 이메일은 남기지 않는다. 초대 목록은 owner 만 읽는데, 활동은 멤버 모두가 읽는다.
-- 행위자 이름은 사본으로 남기지 않는다. 화면이 actor_id 로 지금 멤버의 이름을 읽고, 떠났으면 "떠난 멤버"로 쓴다.
-- 대상의 계정이 지워지면 target_user_id 가 비고, 그 사람의 이름 사본도 함께 지운다(아래 트리거).
-- ────────────────────────────────────────────────────────────────
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor_id uuid,
  kind text not null,
  task_title text,
  target_user_id uuid,
  target_name text,
  old_role text,
  new_role text,
  created_at timestamptz not null default now(),
  constraint activities_org_id_fkey foreign key (org_id)
    references public.organizations (id) on delete cascade,
  constraint activities_actor_id_fkey foreign key (actor_id)
    references public.profiles (id) on delete set null,
  constraint activities_target_user_id_fkey foreign key (target_user_id)
    references public.profiles (id) on delete set null,
  constraint activities_kind_check check (kind in (
    'task_created', 'task_completed', 'task_reopened', 'task_assigned', 'task_unassigned', 'task_deleted',
    'member_joined', 'member_role_changed', 'member_left', 'member_removed',
    'invitation_sent'
  )),
  -- 작업 기록에는 제목이 늘 있다.
  constraint activities_task_title_check check ((kind like 'task\_%') = (task_title is not null)),
  constraint activities_old_role_check check (old_role in ('owner', 'member')),
  constraint activities_new_role_check check (new_role in ('owner', 'member'))
);

alter table public.activities enable row level security;

-- 피드는 조직의 최근 기록을 읽는다.
create index if not exists activities_org_id_created_at_idx on public.activities (org_id, created_at desc);
-- 계정이 지워질 때 외래 키가 행위자·대상을 찾아 비우는 일.
create index if not exists activities_actor_id_idx on public.activities (actor_id);
create index if not exists activities_target_user_id_idx on public.activities (target_user_id);

-- 대상의 계정이 지워져 target_user_id 가 비면(외래 키의 set null) 이름 사본도 지운다. 화면은 "떠난 멤버"로 쓴다.
create or replace function public.forget_activity_target_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.target_user_id is null and old.target_user_id is not null then
    new.target_name := null;
  end if;
  return new;
end;
$$;

drop trigger if exists activities_forget_target_name on public.activities;
create trigger activities_forget_target_name
  before update of target_user_id on public.activities
  for each row execute function public.forget_activity_target_name();

-- ────────────────────────────────────────────────────────────────
-- 5. 활동을 남기는 트리거
--
-- 화면 역할에는 activities 의 쓰기 권한이 없다. 트리거 함수가 security definer 라서 함수 주인 권한으로 넣는다.
-- 행위자는 요청한 사람(auth.uid())이다. JWT 가 없는 관리 작업이면 비어 있고, 화면은 "떠난 멤버"로 쓴다.
--
-- 남기지 않는 일(스펙 4.3·5장, 디자인 스펙 7절 Q3·Q5 와 미결정 사항의 기본안):
--   - 할 일 ↔ 진행 중 전이(Q5). 완료함·다시 엶만 남긴다.
--   - 만들 때 정한 담당자(Q3). "만듦" 하나만 남긴다.
--   - 멤버가 빠지며 외래 키가 비운 담당자. 나감·내보냄 기록 하나로 충분하다.
--   - 가입·팀 만들기가 넣는 첫 owner 멤버십. 초대 수락만 "들어옴"이다.
--   - 조직·계정 삭제로 연쇄로 지워지는 행. 지워지는 조직을 가리키는 기록을 넣으면 그 삭제가 외래 키 위반으로 실패한다.
--     그래서 조직이 이미 없으면(지워지는 중이면) 건너뛴다. 연쇄 삭제는 지운 행이 보이는 상태에서 이어진다.
-- ────────────────────────────────────────────────────────────────

-- 사람의 이름 사본. 표시 이름, 없으면 이메일 @ 앞(web/server/shared 의 nameOf 와 같은 규칙).
-- 트리거만 부른다. 화면 역할이 부르면 아무 사람의 이름이나 읽을 수 있으므로 실행 권한을 모두 거둔다.
create or replace function public.activity_name_of(person uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(p.display_name, split_part(p.email, '@', 1)) from public.profiles p where p.id = person;
$$;

revoke execute on function public.activity_name_of(uuid) from public, anon, authenticated;

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activities (org_id, actor_id, kind, task_title)
    values (new.org_id, auth.uid(), 'task_created', new.title);
    return null;
  end if;

  -- 조직이 지워지며 함께 지워지거나 바뀌는 작업(계정 삭제로 개인 조직이 지워질 때 포함)은 남기지 않는다.
  if not exists (
    select 1 from public.organizations where id = (case when tg_op = 'DELETE' then old.org_id else new.org_id end)
  ) then
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.activities (org_id, actor_id, kind, task_title)
    values (old.org_id, auth.uid(), 'task_deleted', old.title);
    return null;
  end if;

  -- UPDATE: 완료함·다시 엶. 할 일 ↔ 진행 중은 남기지 않는다.
  if old.status <> 'done' and new.status = 'done' then
    insert into public.activities (org_id, actor_id, kind, task_title)
    values (new.org_id, auth.uid(), 'task_completed', new.title);
  elsif old.status = 'done' and new.status <> 'done' then
    insert into public.activities (org_id, actor_id, kind, task_title)
    values (new.org_id, auth.uid(), 'task_reopened', new.title);
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if new.assignee_id is not null then
      insert into public.activities (org_id, actor_id, kind, task_title, target_user_id, target_name)
      values (new.org_id, auth.uid(), 'task_assigned', new.title, new.assignee_id,
              public.activity_name_of(new.assignee_id));
    -- 담당자의 멤버십이 이미 없으면 외래 키가 비운 것이다(멤버가 나감·내보내짐·계정 삭제). 남기지 않는다.
    elsif exists (
      select 1 from public.memberships where org_id = old.org_id and user_id = old.assignee_id
    ) then
      insert into public.activities (org_id, actor_id, kind, task_title)
      values (new.org_id, auth.uid(), 'task_unassigned', new.title);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_log_activity on public.tasks;
create trigger tasks_log_activity
  after insert or update or delete on public.tasks
  for each row execute function public.log_task_activity();

create or replace function public.log_membership_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- 조직의 첫 멤버(가입이 만든 개인 조직·팀 만들기의 owner)는 남기지 않는다. 그 밖에 들어오는 길은 초대 수락뿐이다.
    if not exists (
      select 1 from public.memberships where org_id = new.org_id and user_id <> new.user_id
    ) then
      return null;
    end if;
    insert into public.activities (org_id, actor_id, kind, target_user_id, target_name)
    values (new.org_id, auth.uid(), 'member_joined', new.user_id, public.activity_name_of(new.user_id));
    return null;
  end if;

  if tg_op = 'UPDATE' then
    if new.org_role is distinct from old.org_role then
      insert into public.activities (org_id, actor_id, kind, target_user_id, target_name, old_role, new_role)
      values (new.org_id, auth.uid(), 'member_role_changed', new.user_id,
              public.activity_name_of(new.user_id), old.org_role, new.org_role);
    end if;
    return null;
  end if;

  -- DELETE: 조직이 지워지는 중이거나(조직 삭제) 그 사람의 프로필이 이미 없으면(계정 삭제) 연쇄 삭제다. 남기지 않는다.
  if not exists (select 1 from public.organizations where id = old.org_id)
     or not exists (select 1 from public.profiles where id = old.user_id) then
    return null;
  end if;
  insert into public.activities (org_id, actor_id, kind, target_user_id, target_name)
  values (
    old.org_id,
    auth.uid(),
    case when old.user_id = auth.uid() then 'member_left' else 'member_removed' end,
    old.user_id,
    public.activity_name_of(old.user_id)
  );
  return null;
end;
$$;

drop trigger if exists memberships_log_activity on public.memberships;
create trigger memberships_log_activity
  after insert or update or delete on public.memberships
  for each row execute function public.log_membership_activity();

-- 초대 보냄. 역할만 남기고 이메일은 남기지 않는다. 같은 이메일을 다시 초대하는 일(역할을 다시 적는 update)은 남기지 않는다.
create or replace function public.log_invitation_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activities (org_id, actor_id, kind, new_role)
  values (new.org_id, new.invited_by, 'invitation_sent', new.org_role);
  return null;
end;
$$;

drop trigger if exists invitations_log_activity on public.invitations;
create trigger invitations_log_activity
  after insert on public.invitations
  for each row execute function public.log_invitation_activity();

-- ────────────────────────────────────────────────────────────────
-- 6. 권한과 정책
--
-- 표마다 기본 권한을 전부 거두고 필요한 것만 다시 준다. 쓰기는 열 단위로 연다. 로그아웃한 사람(anon)은 아무것도 못 한다.
-- 운영자(is_admin) 정책은 만들지 않는다. 운영자도 남의 조직의 작업·활동은 읽지 못한다.
-- ────────────────────────────────────────────────────────────────

-- tasks: 멤버 모두가 읽고 추가하고 고친다(제목·설명·상태·마감일·담당자). 지우기는 만든 사람(아직 멤버일 때)이나 owner.
revoke all on table public.tasks from anon, authenticated, public;
grant select, delete on table public.tasks to authenticated;
grant insert (org_id, title, description, status, due_date, assignee_id) on table public.tasks to authenticated;
grant update (title, description, status, due_date, assignee_id) on table public.tasks to authenticated;

drop policy if exists "조직 작업 읽기" on public.tasks;
create policy "조직 작업 읽기"
  on public.tasks for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

-- created_by 는 열 권한이 없어 기본값(auth.uid())이 들어간다. 이 검사는 그 위의 두 번째 잠금이다.
drop policy if exists "조직 작업 추가" on public.tasks;
create policy "조직 작업 추가"
  on public.tasks for insert
  to authenticated
  with check (org_id in (select public.my_org_ids()) and created_by = (select auth.uid()));

-- org_id 는 열 권한이 없어 바꿀 수 없다(작업을 다른 조직으로 옮기지 못한다).
drop policy if exists "조직 작업 수정" on public.tasks;
create policy "조직 작업 수정"
  on public.tasks for update
  to authenticated
  using (org_id in (select public.my_org_ids()))
  with check (org_id in (select public.my_org_ids()));

drop policy if exists "만든 사람이나 owner 는 작업 삭제" on public.tasks;
create policy "만든 사람이나 owner 는 작업 삭제"
  on public.tasks for delete
  to authenticated
  using (
    (created_by = (select auth.uid()) and org_id in (select public.my_org_ids()))
    or org_id in (select public.my_owner_org_ids())
  );

-- activities: 같은 조직 멤버가 읽기만 한다. 넣기는 5절의 트리거만 한다.
revoke all on table public.activities from anon, authenticated, public;
grant select on table public.activities to authenticated;

drop policy if exists "조직 활동 읽기" on public.activities;
create policy "조직 활동 읽기"
  on public.activities for select
  to authenticated
  using (org_id in (select public.my_org_ids()));

-- ────────────────────────────────────────────────────────────────
-- 7. 대시보드 집계 함수
--
-- 대시보드의 수치는 목록을 읽어 앱에서 세지 않고 이 함수 하나가 낸다(스펙 4.4). 호출한 사람의 권한으로 돌아
-- (security invoker) tasks 의 정책이 그대로 걸린다 — 내 조직이 아니면 아무 행도 보이지 않아 모두 0 이다.
-- 날짜는 서울 시간으로 가른다. 숫자는 지금 남은 작업의 created_at·completed_at 으로 센다(Q2): 지운 작업은 빠지고,
-- 다시 연 작업은 완료에서 빠진다.
--
-- 돌려주는 한 줄:
--   today·week_start      기준 시각의 서울 날짜와 그 주 월요일
--   open_count            완료가 아닌 작업
--   overdue_count         열린 작업 중 마감일이 오늘보다 이른 것
--   completed_this_week   이번 주 월요일 0시(서울)부터 오늘까지 완료한 작업
--   my_open_count         나에게 맡겨진 열린 작업
--   daily_dates·daily_added·daily_completed  오늘을 포함한 최근 14일(오래된 날부터), 날짜별 추가·완료 수
-- as_of 는 기준 시각이다. 화면은 넘기지 않고(지금), 시험이 날짜 경계를 고정할 때 넘긴다.
-- ────────────────────────────────────────────────────────────────
create or replace function public.task_dashboard_stats(target_org uuid, as_of timestamptz default now())
returns table (
  today date,
  week_start date,
  open_count integer,
  overdue_count integer,
  completed_this_week integer,
  my_open_count integer,
  daily_dates date[],
  daily_added integer[],
  daily_completed integer[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select (as_of at time zone 'Asia/Seoul')::date as day
  ), scoped as materialized (
    select t.status, t.due_date, t.assignee_id,
      (t.created_at at time zone 'Asia/Seoul')::date as created_day,
      (t.completed_at at time zone 'Asia/Seoul')::date as completed_day
    from public.tasks t
    where t.org_id = target_org
  ), days as (
    select b.day - offs as day from bounds b, generate_series(0, 13) as offs
  )
  select
    b.day,
    b.day - (extract(isodow from b.day)::integer - 1),
    (select count(*)::integer from scoped s where s.status <> 'done'),
    (select count(*)::integer from scoped s where s.status <> 'done' and s.due_date < b.day),
    (select count(*)::integer from scoped s
      where s.completed_day between b.day - (extract(isodow from b.day)::integer - 1) and b.day),
    (select count(*)::integer from scoped s where s.status <> 'done' and s.assignee_id = (select auth.uid())),
    array(select d.day from days d order by d.day),
    array(select (select count(*)::integer from scoped s where s.created_day = d.day) from days d order by d.day),
    array(select (select count(*)::integer from scoped s where s.completed_day = d.day) from days d order by d.day)
  from bounds b;
$$;

revoke execute on function public.task_dashboard_stats(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.task_dashboard_stats(uuid, timestamptz) to authenticated;
