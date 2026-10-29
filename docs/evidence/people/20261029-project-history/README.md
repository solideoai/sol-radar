---
title: "인물 서랍 수행 이력·자격증 (2026-10-29)"
tags: [sol-radar, evidence, people]
updated: 2026-10-29
---

# 인물 서랍 수행 이력·자격증 (2026-10-29)

2026-10-29 사용자 요청 "사람을 누르면 수행한 프로젝트가 보인다"(기능 백로그 3번)의 구현 기록이다. 브랜치 `feat/person-history`(기준 main `9276215c`).

## 바뀐 것

- 화면: 인물 서랍(`web/components/people/person-drawer.tsx`)의 기본 정보 아래에 "수행 이력"(최근 순, 발주기관·분야·기간·역할·스킬)과 "자격증"(취득·만료 연월) 구역을 더했다. 직무 코드는 한글 이름으로 보인다(`DEVELOPER` → 개발자). 조직·인력 목록과 조직도가 같은 서랍을 쓴다.
- 서버 모델: 수행 이력 항목에 `client`(발주기관, 선택)를 더했다. v1 행에는 없어서 선택값이다.
- 데이터: 생성기 `scripts/people/capabilities.mjs`를 `synthetic-people/v2`로 올렸다. 1인당 3~5건(초급 3~4·중급 3~5·고급 4~5·특급 4~5, 3건 41명·4건 66명·5건 93명), 발주기관 14곳은 모두 가상 이름이다. 기간은 겹치지 않고 모두 2026-09-01 이전에 끝난다. 고급·특급은 최근 프로젝트에서 PL·PM을 맡는다.
- 마이그레이션 `20261029001000_enrich_demo_project_history.sql`: 고정 데모 조직(`org-01`)의 기존 데모 직원(`is_demo`, `capability_source = 'SYNTHETIC'`)의 `past_projects`·`capability_version` 두 열만 바꾼다. 행을 만들지 않고, 다시 돌려도 결과가 같다.
- 점수 영향 없음: 분석은 `team_member_scoring`에서 `member_id, role, grade, skills, availability`만 읽는다(`web/server/analysis/analysis.repo.ts` `TEAM_SCORING_COLUMNS`). v2 생성기의 이 값과 자격은 200명 모두 v1(`20261021000600`)과 같다는 시험을 더했다.

## 검증

| 검사 | 결과 |
|---|---|
| `node --test scripts/people/*.test.mjs` | 9/9 통과. 새 마이그레이션 PGlite 시험: 비데모·비SYNTHETIC 으로 바꿔 둔 2명을 뺀 198행만 바뀜(다른 조직의 같은 사번·입사자·그 2명 그대로), 바뀐 행도 두 열 외 그대로, 다시 적용해도 같음. 변형 5건(조건 3개 제거·`skills` 덮어쓰기·초급 PL) 모두 실패로 잡음 |
| `pnpm people:check:fixtures` | `{"ok":true}` |
| `pnpm verify:changed` | exit 0(format·루트 시험·`check:db-types`·web `verify:quick` 117파일 996시험·AI 264·결정 57) |
| 격리 Supabase(`sol-radar-bd`, 59621) | 전체 마이그레이션 → `demo:reset`(v1) → `supabase migration up`으로 `001000` 적용 → `synthetic-people/v2` 200행, 1인당 3~5건, `client` 200행 |
| 브라우저(로컬 `next dev`, `/people` 첫 직원) | 1440·1280px 서랍 폭 480px, 가로 넘침 0(닫기 버튼 `sr-only` 라벨만 잡힘), 콘솔 오류는 `503 /health/ready`(격리 환경에 Redis·AI 없음)뿐 |

스크린샷: [1440](people-drawer-v2-1440.png) · [1280](people-drawer-v2-1280.png) · [1440 아래쪽](people-drawer-v2-1440-bottom.png)

## 하지 않은 것

- `test:e2e:auth`는 돌리지 않았다. `web/e2e-auth/support/people-read-cases.ts`의 계약(`client` 추가, `synthetic-people/v2`)만 고쳤다.

## 운영 반영 (2026-10-29, 사용자 승인)

- 적용 전 운영 읽기: `org-01` 데모 직원 200행 모두 `SYNTHETIC`·`synthetic-people/v1`, 1인당 1~3건.
- `NODE_EXTRA_CA_CERTS=… bash scripts/db-push.sh --check`: 미적용 1개(`20261029001000`)만 확인한 뒤 적용 → `✓ 20261029001000_enrich_demo_project_history.sql`.
- `bash scripts/db-verify.sh`: `DB 연결·마이그레이션 69개·RLS 활성화·화면 역할 권한·뷰·함수 확인`.
- 적용 뒤 운영 읽기: 200행 모두 `synthetic-people/v2`, 1인당 3~5건, 첫 항목에 `client` 있음 200행.
- main push 의 pre-push 게이트에서 `e2e/landing-showcase.spec.ts:142`(업무 데모 행 누름 360ms 단계를 12초 안에 기다림)가 기계 부하(load 22~47) 때 세 번 실패했다. 같은 커밋에서 그 spec 만 돌리면 10 passed 였다. 랜딩 코드는 이 작업에서 바꾸지 않았다. 게이트는 우회하지 않았다.
- 사용자 결정으로 그 시험을 보강했다(`e7cd5915`): 페이지 안 MutationObserver 가 단계가 바뀌는 순간 목표·커서 상자를 재고, 한 바퀴를 보는 제한 시간을 45→90초로 늘렸다. 단언은 그대로다. `--repeat-each=8 --workers=8`(load 33)에서 수정 전 8 failed, 수정 뒤 8 passed, spec 전체 10 passed.
- main push 는 같은 main 에 org-search 를 병합한 sol-radar-c0 이 했다(`a9d3a107..e7cd5915`, pre-push 통과). Vercel 은 그 뒤 커밋 `c8b4a504` 를 운영에 배포했다(GitHub 상태 `Vercel success`, 2026-10-30 00:24 KST). `/health/ready` 200.
- 운영의 로그인 뒤 서랍 화면은 보지 못했다. Playwright MCP 를 다른 세션이 쓰고 있었고, 운영 계정 비밀번호는 `.env` 에만 있어 읽지 않았다. 배포 커밋에 서랍 코드(`6622f487`)가 들어 있고 운영 DB 가 v2 인 것까지 확인했다.
