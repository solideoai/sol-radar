-- 참고 낙찰가 범위(ADR-077) 보강. 20261102000100 다음에 적용한다.
--
-- 1. 카드 기준일(가장 늦은 수집)과 기간(가장 이른 개찰)을 읽는 order by ... limit 1 이 표 전체를 훑지 않게 인덱스를 둔다.
--    공고 상세를 열 때마다 두 조회가 돈다.
-- 2. 운영자 CLI(service role)의 쓰기 권한을 선례(20261023000100)처럼 명시한다. 회원 권한은 그대로(읽기만)다.
-- 운영에는 db:push 대신 이 SQL 을 직접 실행할 수 있다(ADR-075 선례). 다시 돌려도 해가 없다.

create index if not exists procurement_award_history_fetched_at_idx
  on public.procurement_award_history (fetched_at);
create index if not exists procurement_award_history_opened_at_idx
  on public.procurement_award_history (opened_at);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on table public.procurement_award_history to service_role;
  end if;
end;
$$;
