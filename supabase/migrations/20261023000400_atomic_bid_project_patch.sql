-- Mixed status/owner/deadline PATCH is one transaction. Existing status RPC owns
-- transition checks, event and audit writes; a later failure rolls all of them back.
create or replace function public.patch_bid_project(
  p_project_id uuid,
  p_status text default null,
  p_note text default null,
  p_owner_changed boolean default false,
  p_owner_id uuid default null,
  p_due_changed boolean default false,
  p_due_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.bid_projects%rowtype;
begin
  select p.* into v_project from public.bid_projects p
  where p.id = p_project_id and p.org_id in (select public.my_org_ids())
  for update;
  if not found or auth.uid() is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_project.org_id not in (select public.my_sol_org_ids(array['ADMIN', 'SALES'])) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_owner_changed and p_owner_id is not null and not exists (
    select 1 from public.memberships m
    where m.org_id = v_project.org_id and m.user_id = p_owner_id
  ) then
    raise exception 'OWNER_NOT_MEMBER' using errcode = 'P0001';
  end if;
  if p_status is not null then
    perform public.change_bid_project_status(p_project_id, p_status, p_note);
  end if;
  update public.bid_projects set
    owner_id = case when p_owner_changed then p_owner_id else owner_id end,
    submission_due_override = case when p_due_changed then p_due_at else submission_due_override end
  where id = p_project_id;
exception when foreign_key_violation then
  -- Membership can disappear after the precheck. The exception subtransaction
  -- also rolls back status/events/audit before returning the expected failure.
  raise exception 'OWNER_NOT_MEMBER' using errcode = 'P0001';
end;
$$;
revoke execute on function public.patch_bid_project(uuid,text,text,boolean,uuid,boolean,timestamptz)
  from public, anon, authenticated;
grant execute on function public.patch_bid_project(uuid,text,text,boolean,uuid,boolean,timestamptz)
  to authenticated;
