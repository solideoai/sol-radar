-- 과기정통부 사업공고(msit)를 부처 공고 출처에 더한다(스펙 polaris/specs/in-progress/2026-11-01-msit-rnd-notices.md §5).
-- 표·RLS·읽기 정책은 그대로다. 두 표의 source check 제약만 바꾼다(20261023000800_program_notices.sql 은 고치지 않는다).
alter table public.program_notices drop constraint program_notices_source_check;
alter table public.program_notices
  add constraint program_notices_source_check check (source in ('bizinfo', 'mss', 'msit'));

alter table public.program_notice_runs drop constraint program_notice_runs_source_check;
alter table public.program_notice_runs
  add constraint program_notice_runs_source_check check (source in ('bizinfo', 'mss', 'msit'));
