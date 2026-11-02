---
title: "과기정통부 사업공고 운영 반영 (2026-11-02)"
status: done
tags:
  - sol-radar
  - evidence
  - program-notices
updated: 2026-11-02
---

# 과기정통부 사업공고 운영 반영 (2026-11-02)

[[16-DECISIONS|ADR-075]]의 운영 반영 기록이다. 세 단계를 사용자가 하나씩 승인했다. 마스터 세션이 실행하고 운영 DB SELECT로 확인했다.

## O1 운영 DB 제약 (사용자 "그래 O1 실행해")

- `pnpm db:push` 대신 `supabase/migrations/20261101000050_program_notices_msit_source.sql`과 같은 SQL을 Supabase MCP로 운영(`brtysdocxemrqhdezzqg`)에 직접 실행했다. `schema_migrations`에는 기록하지 않았다.
- 이유: `db:push`는 밀린 마이그레이션을 모두 적용한다. 발표 뒤로 미룬 구글 캘린더 표 `20261030002000`이 같이 들어가면, 구글 env가 없는 채로 설정 화면에 동작하지 않는 [연결] 칸이 보인다([[2026-11-02-google-calendar-prod-rollout|구글 캘린더 운영 반영 계획]]).
- 나중에 `db:push`가 `20261101000050`을 다시 돌려도 같은 제약을 지우고 다시 만들 뿐이다.
- 확인(SELECT, O3 직전에 다시 읽음):
  - `program_notices_source_check`·`program_notice_runs_source_check` 모두 `CHECK ((source = ANY (ARRAY['bizinfo'::text, 'mss'::text, 'msit'::text])))`
  - `schema_migrations` 마지막 `20261030001100`(그대로)

## O2 회사 부처 공고 Worker (사용자 "O2 진행해", "1번으로 해")

- 브랜치 `feat/msit-rnd-notices`(`478531c7`)를 pre-push 게이트를 거쳐 push했다.
- 회사 `sol-radar-app`: 되돌리기 태그 `rollback-program-notices-20261102`(= `cbb3831e`)를 만든 뒤 `478531c783eb2184736faadb9b8bfafc7be55785`로 detach했다. 로컬 `main` 참조와 `infra/compose.company.yaml` 로컬 수정은 그대로다. 마운트되는 경로(`infra/sources`·`fixtures`)의 차이는 `program-notices.yaml`과 fixture(직원 JSON·과기정통부 녹음)뿐이고 `registry.yaml`은 같다.
- 이미지 `sol-radar-program-notices-worker:478531c783eb`를 빌드했다. `--check`에서 과기정통부 키 SET을 확인했다.
- 15:00 정기 회차는 옛 Worker가 끝냈다(기업마당 `SUCCEEDED`). 실행서의 재생성 시간 창 안인 15:16에 `--once`를 돌린 뒤 Worker를 재생성했다(healthy, 일정 1개, 다음 회차 18:00 KST).
- `--once` 결과(운영 DB `program_notice_runs`):

| 출처 | 상태 | 받음 | 저장 | 비고 |
|---|---|---|---|---|
| 기업마당 | `SUCCEEDED` | 100 | 100 | 15:16:20 |
| 과기정통부 | `SUCCEEDED` | 10 | 4 | 15:16:21. 결과 발표 6건은 저장하지 않음(Worker 출력 `excluded` 6) |

- 운영 `program_notices`: 기업마당 125행, 과기정통부 4행. 과기정통부 공고 제목:
  - 2026년도 국제공동연구 신속지원사업 신규과제 공모(수정)
  - 연구보안 전담기관 지정계획 공고
  - 2026년 과학벨트 어워드 모집 공고
  - 「2027년도 전문기술인 활용 재난재해 대응기술 현장화 지원 사업」 신규 과제 공모
- 되돌리기: 회사 실행서 §10.7과 옛 이미지 `db442be15481`.
- 확인하지 않은 것: 실행서의 ingest `--status` 일정 수 확인(다른 큐라 건너뜀).

## O3 화면 배포 (사용자 "03 진행해")

- 최신 main(`48db0aba`)을 브랜치에 병합하고 `origin/main`에 push했다. main push가 곧 Vercel 배포다.
- O1·O2 동안 운영 웹은 모르는 출처 행을 목록에서 걸러 오류가 없었다(옛 main `web/server/program-notices/list.service.ts`).
- 배포 확인과 운영 화면(`/bids/programs` 과기정통부·랜딩 로고)은 push 뒤 확인한다.
