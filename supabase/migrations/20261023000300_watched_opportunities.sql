-- N3: current public procurement table keeps opportunity identity separate from raw bid identity.
-- Authenticated invoker + bid_watches RLS expose only the caller's watches in the selected organization.
create view public.watched_opportunity_list_items with (security_invoker = true) as
select i.*
from public.opportunity_list_items i
where exists (
  select 1 from public.bid_watches w
  where w.org_id = i.org_id and w.bid_id = i.bid_id and w.user_id = (select auth.uid())
);
revoke all on table public.watched_opportunity_list_items from public, anon, authenticated;
grant select on table public.watched_opportunity_list_items to authenticated;
