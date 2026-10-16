-- 20261013000002_function_search_path — security definer 함수의 search_path 를 빈 값으로 고정한다.
--
-- 기준선(20261013000001_init)은 네 함수를 `set search_path = public` 으로 만들었다. 고정은 돼 있지만,
-- public 에 객체를 만들 수 있는 역할이 생기면 스키마를 적지 않은 이름이 그 객체로 풀려 함수 주인 권한으로 불린다.
-- 빈 값이면 스키마를 적지 않은 이름은 pg_catalog 것만 찾는다. 새 security definer 함수도 이 모양으로 만든다
-- (`database` 스킬의 "뷰·함수" 절, `pnpm db:verify` 의 안내와 같은 규칙).
--
-- 네 함수의 본문은 이미 public.profiles·public.is_admin()·auth.uid()·auth.jwt() 처럼 스키마까지 적혀 있어
-- 본문은 그대로 두고 설정만 바꾼다. alter function ... set 은 다시 적용해도 결과가 같다.

alter function public.is_admin() set search_path = '';
alter function public.handle_new_user() set search_path = '';
alter function public.handle_user_email_change() set search_path = '';
alter function public.protect_is_admin() set search_path = '';
