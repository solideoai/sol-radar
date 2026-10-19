-- 20261019000008_team_creation_operator_only — 팀(조직) 만들기를 서비스 운영자(profiles.is_admin)만 하게 좁힌다.
--
-- 근거: docs/16-DECISIONS.md ADR-026 (사용자 결정 2026-10-19), docs/04-DATABASE.md §3.1·§3.6, docs/09-SECURITY.md RBAC.
-- 20261019000001 이 팀을 만든 사람에게 owner + ADMIN 을 주고, 04 §3.6 의 운영 표(ingest_runs·ingest_errors·eval_runs)
-- 읽기 정책이 "어느 조직에서든 ADMIN" 이라, 템플릿의 "팀 만들기"(authenticated 누구나, 20261014000001)가 열려 있으면
-- 가입만 한 사람이 팀을 만들어 ADMIN 이 되고 운영 표를 읽을 수 있다. 데모 조직 2개는 pnpm demo:reset 이 service role 로
-- 만들므로 영향이 없고, 업무 조직 합류는 초대로만 한다(ADR-018·021).
--
-- 이 파일에 든 것: organizations 의 "팀 만들기" 정책을 is_admin() 으로 좁힌다. 함수는 `(select …)` 로 감싸 행마다
-- 다시 부르지 않게 한다(scripts/database.test.mjs 의 정책 성능 검사 slowPolicies 기준). 정지된 운영자는 is_admin() 이 false 다
-- (20261015000001). 열 권한(slug, name)·add_team_owner 트리거·개인 조직 금지 검사(personal_owner_id is null)는 그대로다.
-- 되돌리기(새 마이그레이션으로): 정책을 20261014000001 의 본문 `with check (personal_owner_id is null)` 로 다시 만든다.
-- 이 파일은 고치지 않는다(append-only).

drop policy if exists "팀 만들기" on public.organizations;
create policy "팀 만들기"
  on public.organizations for insert
  to authenticated
  with check (personal_owner_id is null and (select public.is_admin()));
