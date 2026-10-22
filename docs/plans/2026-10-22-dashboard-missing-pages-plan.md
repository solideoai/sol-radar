---
title: "대시보드 미구현 메뉴 조사·구현 계획"
doc: "plan-dashboard-missing-pages"
status: complete
tags:
  - sol-radar
  - ui
  - architecture
  - test
updated: 2026-10-22
---

# 대시보드 미구현 메뉴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. 별도 병렬 실행을 선택하면 `superpowers:subagent-driven-development`를 사용한다. 단계는 체크박스(`- [ ]`)로 기록한다. 검증·리뷰 빈도는 [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] ADR-046이 우선한다.

**Goal:** 대시보드 사이드바의 미구현 메뉴 4개를 실제 업무 화면으로 연결하기 위한 재사용·잔여 구현·검증 순서를 확정한다. 2026-10-22 사용자 지시로 이 계획의 구현을 시작한다.

**Architecture:** 기존 Next.js 업무 셸·사용자 세션·Supabase RLS를 유지한다. N3 관심 공고와 N6 입찰 프로젝트는 기존 브랜치 자산을 재사용하고, N5 분석 비교와 N7 인력 시뮬레이션은 저장된 분석·인력 데이터를 읽는 화면으로 추가한다. 네 기능은 각각 독립적으로 검증·출시할 수 있는 작업 묶음이다.

**Tech Stack:** Next.js 16.4.1 / React 19 / TypeScript / Supabase Postgres·Auth·RLS / 기존 worker / Vitest·Playwright. 새 프레임워크·모델·UI 라이브러리 도입 없음.

**Spec:** [[06-UI-UX|06 UI]] §4.1·§5.12, [[04-DATABASE|04 DB]] §3.8, [[05-API-SPEC|05 API]] P1 계약, [[09-SECURITY|09 보안]], [[12-ROADMAP|12 로드맵]] P1, [[16-DECISIONS|16 결정]] ADR-021·042·046. 세부 요구는 [[2026-10-16-sidebar-ia-design|승인된 사이드바 설계]] §2.2·§3.2·M12·M15·M20을 따르되, 오래된 숫자·출시 표시·검증 규칙은 최신 정본이 우선한다.

## 실행 기준 갱신 (2026-10-22)

사용자가 계획 실행과 서브에이전트 분배를 승인했다. 최신 `main@c9bc496`에서 격리 브랜치 `feat/dashboard-pages-20261022`를 만들었다. 이미 병합된 공공조달 UI(`4ca804d`)의 OpportunityTable/OpportunityFilters와 source·stage 필터를 보존한다. 관심·프로젝트의 식별자는 사업기회 ID가 아니라 원본 공고 `bidId`다. 대시보드는 최신 첫 4카드와 수집 상태 패널을 보존하고 다섯째 카드만 진행 중 프로젝트로 바꾼다.

독립 영역은 사용자 지시에 따라 병렬 구현하며 공유 파일은 한 명이 통합한다. 추가 화면 명세는 [[2026-10-22-dashboard-pages-ui-spec|현재 UI 설계]], N5/N7 범위 명세는 `polaris/specs/in-progress/`에 둔다. 아래 조사 기록은 작성 당시 상태다. 클라우드 DB·배포는 이번 로컬 구현과 구분한다.

**구현 진행 (2026-10-22):** Task 0~4의 기능·개발 검증과 독립 리뷰를 완료했다. 근거는 [통합 기록](../evidence/navigation/20261022-implementation.md), `.superpowers/sdd/2026-10-22-dashboard-missing-pages-plan/task-{1,2,3,4}-report.md`와 현재 구현이다. 통합 담당이 실행한 전체 `pnpm verify`도 루트 191·웹 441·AI 101·결정 모델 57개 시험과 웹 빌드를 통과했다. Task 0~4와 중복되던 실제 로그인 흐름·전체 셸의 1440/1280 확인은 Task 5에 모으며, 그 E2E·최종 판정 체크박스는 진행 중으로 남긴다. `app-nav.ts`의 12개 `released`는 현재 통합 코드 상태이며 운영 배포 완료를 뜻하지 않는다.

## 1. 조사 결과

조사일 2026-10-22. 시작 `main@31d6d11`, 작성 기준 `main@3fded99` + 기존 미커밋 변경. 조사 중 추가된 커밋은 `.vercelignore`만 변경했고 아래 메뉴·화면 판정에는 영향이 없다. 로컬 코드·브랜치·문서를 읽은 결과이며 실제 배포 사이트·HTTP 응답·런타임 정상 여부를 검증한 것은 아니다. `polaris/mission.md`는 없고 승인된 설계 문서가 있다.

`web/components/app-nav.ts`에 메뉴 12개(맨 아래 조직도 포함)가 있고 8개는 `released`, 아래 4개는 `planned`다. `web/components/app-shell.tsx`는 `planned`를 링크 없는 `span`으로 표시한다. 네 전용 페이지 파일은 현재 main에 없다. 따라서 버튼만 활성화해서 해결할 문제가 아니다.

| 순서 | 메뉴 / 경로 | 현재 main | 다른 로컬 브랜치의 자산 | 필요한 작업 |
|---|---|---|---|---|
| 1 / N3 | 관심 공고 `/watchlist` | 페이지·watch API·`bid_watches` 없음 | `feat/n3-watchlist@3ac48b3`: DB·API·화면·worker·스펙·화면 설계·증거 존재 | 최신 main에 맞춰 통합하고 빠진 검증 마무리 |
| 2 / N5 | 분석 결과 비교 `/analysis` | 페이지·조직 전체 `GET /analyses` 없음. 공고별 이력과 분석 단건 API는 있음 | 전체 로컬 Git 이력에서 해당 페이지·API 구현 커밋은 발견하지 못함 | 조직 이력 조회·필터·2~4건 비교 신규 구현 |
| 3 / N6 | 입찰 프로젝트 `/projects` | 페이지·API·프로젝트 표 없음 | `feat/n6-bid-projects@5b21e77`: DB·서버 도메인·체크리스트 서비스·스펙 존재. 프로젝트 페이지·API 없음 | 기존 서버 코드 검토·보완 후 API·보드·상세·대시보드 연결 |
| 4 / N7 | 인력 배치 시뮬레이션 `/workforce` | 페이지·simulation API 없음. 인력·배정·점수 계산 함수는 있음 | 전체 로컬 Git 이력에서 해당 페이지·API 구현 커밋은 발견하지 못함 | 스냅샷 기준 단일 공고 가용성·현재 배정 기준 기간 충돌 조회 |

### 이미 화면이 있는 메뉴의 잔여 기능

- `/dashboard`, `/bids`, `/notifications`, `/company`, `/people`, `/org-chart`, `/admin/ingestion`은 페이지가 있다. 이 사실은 모든 설계 요구가 구현됐다는 뜻은 아니다.
- `/settings`는 `redirectToPersonal("settings")`를 통해 기존 `/{slug}/settings`로 연결된다. 개인 설정 화면은 있으며 새 조직 탭·업무 역할 관리(N2)는 별도 잔여 작업이다.
- 회사 역량 편집·revision 저장, 조직·인력 ADMIN 편집(N4b), 대시보드 최근 변경 목록은 부분 미구현이다. 이번 네 개의 누락 페이지와 묶어 범위를 키우지 않는다.
- 조사 당시 별도 제안이던 공공조달 확장은 실행 기준 `c9bc496`에 병합되어 있다. 실행 기준 갱신의 현재 UI를 따른다.

### 기존 자산을 읽을 위치

현재 main에는 아래 파일이 없으므로 복구 단계에서 해당 커밋과 함께 가져온다. 다른 작업 폴더를 수정하지 않는다.

| 기능 | 로컬 자산 | 현재 확인한 한계 |
|---|---|---|
| N3 | [스펙](../../polaris/specs/in-progress/2026-10-21-n3-watchlist.md), [계획](2026-10-21-n3-watchlist-plan.md), [디자인](2026-10-21-n3-watchlist-design.md), 기존 브랜치의 `docs/evidence/phase-3/n3-watchlist/20261021-n3-watchlist-report.md` | 기록의 전체 `pnpm verify`·브라우저 시험 결과가 `(채움)`으로 남았다. 단위·DB·격리 실앱 기록은 있으나 현재 main 통합 성공 근거로 쓰지 않는다 |
| N6 | [스펙](../../polaris/specs/in-progress/2026-10-21-n6-bid-projects.md), [계획](2026-10-21-n6-bid-projects-plan.md), [디자인](2026-10-21-n6-bid-projects-ui-spec.md) | 디자인은 draft이고 API·화면·통합 검증이 남았다. 현재 `dashboard-card-slots.ts`는 없으므로 옛 계획의 파일 존재 가정을 그대로 쓰지 않는다 |

두 작업 폴더는 조사 당시 `git status --short` 출력이 없었다. 원격 최신 상태나 담당자의 현재 활동 여부까지 확인한 것은 아니다.

## Global Constraints

- 구현 순서는 M20대로 **N3 → N5 → N6 → N7**. 독립적인 설계·조사는 병행 가능하지만 공유 파일 편집은 한 작업자가 맡는다.
- 업무 페이지는 `web/app/(app)/(work)/`, API는 `web/app/api/v1/`, 도메인은 `web/server/<도메인>/`. `requireWork`·`businessRoute`와 도메인 배럴을 재사용한다.
- 현재 조직·사용자는 서버 세션이 결정한다. 요청에서 `orgId`·`userId`를 받아 권한을 선택하지 않는다. 권한 부족 403, 다른 조직 자원 404, 미출시 경로 404를 유지한다.
- 웹은 anon 키 + 사용자 세션 + RLS. 마감 알림 worker의 기존 service role 용도만 유지한다.
- **데스크톱 1280px 이상**, 화면 확인 **1440·1280**. 색·글꼴은 `design/tokens.json`과 기존 UI 부품을 따른다.
- 최신 정본과 현재 main의 점수 계산 대상은 **가상 인력 200명**이다. 10-16 설계 및 일부 ADR의 27명·고정 20 FTE를 되살리지 않는다. 실제 후보는 조회한 `scoringEligible` 인력으로 제한한다.
- 마감 알림의 **D7은 설계 결정 ID**다. 발송 시점은 [[13-NOTIFICATIONS|13 알림]] 및 N3 스펙의 **D-3·D-1 09:00 KST 이후 당일**이다. 대시보드의 마감 7일 필터와 구분한다.
- 새 모델 호출·자동 배정·자동 투찰·승률 예측·모바일·결제는 추가하지 않는다. `analyze()` 계산식·분석 job·골든 94/72/68·기존 분석 스냅샷은 유지한다.
- 마이그레이션은 append-only. 이미 커밋된 파일을 고치거나 지우지 않고 보정은 새 파일로 한다. `pnpm db:types` 생성물은 같은 변경 묶음에 포함한다. 클라우드 DB 적용은 별도 사용자 확인이 필요하다.
- 새 화면 설계는 구현 전에 `web-designer`의 디자인 스펙으로 구체화한다. N3는 기존 디자인을 재사용하고 N6는 기존 draft를 현재 DTO에 맞춘다. N5·N7 신규 스펙의 정본 위치는 `polaris/specs/in-progress/`다.
- Next 지침은 로컬 `web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{page,route}.md`를 구현 직전에 확인한다. `params`·`searchParams`를 비동기로 읽고 요청별 인증 데이터를 정적 공용 캐시에 넣지 않는다.
- 개발 중 `pnpm verify:changed`, 통합 전 전체 `pnpm verify` 1회. ADR-046에 따라 기존 브랜치의 삭제된 대규모 회귀 시험을 일괄 복원하지 않는다. 새 계산·권한·저장·실제 결함만 시험한다.
- 2026-10-24 22:00 freeze, 10-26 완료 목표를 유지한다. 준비가 덜 된 메뉴는 이름만 비링크로 남긴다. ‘준비 중’ 배지 복원 없음.

## Review Focus

1. 관심 등록 중복·사용자 간 목록/커서 재사용: 본인 목록만 보이고 PUT 반복은 한 행이다. → Task 1 DB·watch 계약 검증.
2. FAILED·PARTIAL 분석과 다른 조직 분석을 비교: 누락 점수를 0으로 바꾸지 않고 다른 조직 값은 노출하지 않는다. → Task 2 이력 계약·비교 흐름.
3. 프로젝트 생성 뒤 사람 결정이 WATCH로 바뀜: 자동 종료 없이 전진만 막고, 체크리스트 직접 DB 쓰기도 권한을 검사한다. → Task 3 DB 정책·업무 흐름.
4. 분석 이후 인력 배정이 바뀜: 단일 공고 FTE는 당시 스냅샷 그대로, 현재 충돌 결과에는 별도 기준 시각이 보인다. → Task 4 순수 계산 검증.
5. 옛 브랜치 통합으로 최신 인프라·시험 축소·메뉴 표시가 되돌아감: worker·API 가드·200명·최신 표시 규칙을 보존한다. → Task 0 차이 검토, Task 5 통합 검사.

## 2. 접근 방법과 작업 경계

**권장: 기존 구현을 재사용하고 각 화면의 남은 수직 흐름을 완성한다.** N3·N6의 데이터 계약과 디자인을 버리지 않고 현재 main에서 실제로 부족한 부분만 보완한다. 공유 파일 충돌·오래된 검증 정책은 통합 단계에서 해결한다.

다른 선택지는 네 화면을 모두 새로 만드는 방법(이미 검토한 DB·권한 구현을 중복 작성)과 화면만 먼저 링크로 여는 방법(메뉴 출시 조건 5개를 충족하지 못함)이다. 둘 다 이번 계획의 선택안이 아니다.

| 묶음 | 주 책임 파일 | 공유 편집 파일 |
|---|---|---|
| N3 | 기존 `server/watchlist/`, `(work)/watchlist/`, `worker/deadline-reminders.ts` | `bid-query.ts`, `bids.supabase.ts`, 공고 표·상세, `worker/main.ts`, `app-nav.ts` |
| N5 | 신규 `server/bids/analysis-history.*`, `(work)/analysis/`, API `/analyses/route.ts` | `server/bids/index.ts`, `app-nav.ts` |
| N6 | 기존 `server/projects/`, 신규 `(work)/projects/`, API `/projects/` | `server/task/`, 공고 상세, dashboard model·repo·service·view, `app-nav.ts` |
| N7 | 신규 `server/workforce/`, `(work)/workforce/`, API `/workforce/simulation/` | `app-nav.ts`. 점수 함수는 배럴로 재사용 |

### Task 0: 재사용 기준점·상세 설계 확정

**Files:** N3·N6의 기존 스펙·계획·디자인(위 표), 신규 `polaris/specs/in-progress/2026-10-22-n5-analysis-comparison.md`, `polaris/specs/in-progress/2026-10-22-n7-workforce-simulation.md`. 아래 API는 기존 정본이 P1 착수 때 정하도록 남겼던 부분을 구현한 계약이며 해당 스펙과 05 문서에 반영했다.

- [x] 실행 시작 시 main·N3·N6 해시와 작업 중 변경을 다시 확인한다. 기존 작업 폴더에 병합·리셋하지 않고 최신 main에서 통합 작업 공간을 준비한다.
- [x] N3 `52b50c2`·`6a59f3d`·`3ac48b3`, N6 `390d35f`·`5b21e77`의 파일별 차이를 검토한다. 기능 자산은 재사용하고 최신 main의 Gateway·Storage·worker·축소 시험 상태를 유지한다.
- [x] N6의 `audit_logs.action` 제약·DB 함수·체크리스트 정책이 현재 스키마에서 성립하는지 확인한다. 과거 N2 작업 전체를 불필요하게 선행시키지 않고 꼭 필요한 DB 의존성만 식별한다.
- [x] N3 커서 지문에 `watched`와 본인 식별 범위가 반영되는지, `watched_bid_list_items`가 현재 `bid_list_items` 열과 호환되는지 확인한다.
- [x] N3 기존 디자인, N6 draft, N5·N7의 목록·선택·빈 상태·부분 결과·오류·1280 배치를 확정한다. 이번 계획의 네 기능 범위를 넘는 새 제품 결정이 생기면 그 변경만 분리한다.

**완료 기준:** 재사용 커밋·충돌 파일·핵심 시험·화면별 계약이 정해져 있고 ‘다시 만들기’와 ‘그대로 병합하기’에 의존하지 않는 작업 목록이 있다.

### Task 1: 관심 공고 — 기존 구현 통합·완료

**Files:** 재사용 `supabase/migrations/20261022000100_bid_watches.sql`, `20261022000110_deadline_reminders.sql`, `web/server/watchlist/{watchlist.model,watchlist.repo,watchlist.service,index}.ts`, `web/app/(app)/(work)/watchlist/{page,loading,error}.tsx`, `web/app/api/v1/bids/[id]/watch/route.ts`, `web/worker/deadline-reminders.ts`. 수정은 기존 N3 계획의 공고 목록·상세·worker 연결 파일과 `scripts/database.test.mjs`, `scripts/db-verify.mjs`, `web/lib/database.types.ts` 중 실제 통합 차이에 한정한다.

**Interfaces:** `PUT/DELETE /api/v1/bids/:id/watch` → `{bidId, watched, watcherCount}`. `GET /api/v1/bids?watched=me`는 기존 `Page<BidListItem>` 유지. `WatchScope = {orgId, userId}`는 서버가 만든다. `send_deadline_reminders(p_now)`는 worker에서만 호출한다.

- [x] 위 커밋의 기능·스펙·디자인·증거를 통합한다. 기존 API·보안 체크를 지우거나 축소하지 않는다. 이미 삭제된 시험 파일은 통째로 되살리지 않고 N3 핵심 검증만 현재 시험에 옮긴다.
- [x] `scripts/database.test.mjs`에 본인/다른 사용자/다른 조직 격리, 조직별 관심 수, 멱등 등록, 담당자 겸 관심 등록자의 알림 1건을 검증한다. D-3·D-1 09:00 경계는 이 DB 경로에서 확인하고 동일 규칙의 중복 행렬은 만들지 않는다.
- [x] `web/app/api/v1/watch-contract.test.ts`와 필요한 N3 핵심 시험을 실행해 현재 main에서의 실패를 먼저 확인하고 충돌·실제 결함을 수정한다. `watched=me`에서 필터·페이지 이동·상세 뒤로 가기가 유지되고 타 사용자의 커서를 재사용하지 못해야 한다.
- [x] 기존 표·필터·★ 토글을 연결한다. `/watchlist`에서 해제 직후 행을 유지하는 기존 디자인, 실패 시 토글 복구, `aria-pressed`를 보존한다. 알림 목록 설명에는 마감 알림도 포함한다.
- [x] `pnpm db:types`와 `pnpm verify:changed`를 완료했다. 격리 mock Compose의 worker healthy와 실제 PostgreSQL의 마감 알림 최초 2건·재호출 0건을 확인했다. 이전 보고서의 `(채움)` 대신 [현재 통합 기록](../evidence/navigation/20261022-implementation.md)을 근거로 쓴다. 실제 로그인 등록 → 관심 목록 → 상세 → 해제는 Task 5 통합 E2E에서 확인한다.

**완료 기준:** 관심 목록·토글·D-3/D-1 알림이 저장과 연결되고 본인만 접근하며 검증 증거가 있다. `feat: 관심 공고 통합과 마감 알림 완료` 단위로 정리한다.

### Task 2: 분석 결과 비교 — 조직 이력·최대 4건 비교

**Files:** 신규 `web/server/bids/analysis-history.model.ts`, `analysis-history.repo.ts`, `analysis-history.service.ts`, `analysis-history.service.test.ts`; 신규 `web/app/api/v1/analyses/route.ts`, `web/app/api/v1/analysis-history-contract.test.ts`; 신규 `web/app/(app)/(work)/analysis/{page,loading,error}.tsx`, `analysis-history-view.tsx`, `analysis-comparison.tsx`, `analysis-query.ts`; 수정 `web/server/bids/index.ts`.

**Interfaces (구현 계약):**

- `AnalysisHistoryQuery`: `bidId: string | null`, `status: AnalysisStatus | null`, `recommendation: Recommendation | null`, `runMode: RunMode | null`, `cursor: string | null`, `limit: number`(기본 20, 1~100).
- `AnalysisHistoryItem`: 기존 `AnalysisView`의 `id`, `bidId`, `revision`, `profileRevision`, `status`, `runMode`, `solScore`, `recommendation`, `errorCode`, `reviewFlags`, `queuedAt`, `finishedAt`, `model.algorithmVersion`에 `bidTitle`, `isDemo`를 더한 요약. 이력 목록에 대형 입력 스냅샷을 내리지 않는다.
- `listAnalysisHistory(orgId, query, deps): Promise<ServiceResult<Page<AnalysisHistoryItem>>>`; `deps`는 해당 repo와 기존 HMAC 커서 비밀이다. DB 정렬은 `created_at desc, id desc`, 지문은 조직·필터에 묶는다.
- `GET /api/v1/analyses`는 위 목록. 비교는 기존 `GET /api/v1/analyses/:id`를 선택 건수만큼, **최대 4번** 호출한다. 별도 비교 API·분석 실행 버튼은 없다.

- [x] 계약 시험: 조직 전체 이력에 여러 공고가 포함되고 `status`·`runMode`로 필터된다. 다른 조직 분석 ID는 기존 단건 API에서 404이고 다른 조직/필터의 커서는 거부된다. 필수 테스트만 작성·실패 확인한다.
- [x] 조회 repo·서비스·GET을 구현한다. 기존 `score_runs`·점수 요소·자격 판정을 읽고 새 표·분석 job은 만들지 않는다.
- [x] 화면은 이력 표 + 2~4건 선택 + 비교 영역으로 만든다. `?compare=id1,id2`로 선택을 복원하며 중복 ID는 제거하고 5번째 선택은 막는다. 직접 URL의 4건 초과는 안내 후 선택을 다시 받는다.
- [x] 비교 항목은 SOL Score 5요소, 자격 3상태, revision·회사 프로필 revision·알고리즘 버전·실행 모드·분석 시각·실패 사유·`reviewFlags`. PARTIAL은 사유와 남은 결과, FAILED는 실패 사유와 빈 값을 표시한다. 진행 중 결과는 점수 대신 상태를 표시하고 누락을 0점으로 바꾸지 않는다.
- [x] 한 분석 조회 실패가 다른 선택 결과를 가리지 않게 열별 재시도를 둔다. 다른 revision·버전·실행 모드가 섞이면 비교 기준 차이를 표시한다. 점수·모델 고지는 기존 문구를 재사용한다.
- [x] 분석 이력 서비스·계약·DB 행 변환·선택 파서와 기존 조직 격리 시험 9건, Chromium의 4열 비교·FAILED/PARTIAL·최소 화면 본문 960px 배치 시험을 통과했다. 통합 `pnpm verify:changed`도 통과했다. 전체 셸의 실제 로그인 비교 흐름은 Task 5에서 확인한다.

**완료 기준:** 조직 이력 필터와 2~4건 비교가 실제 저장 결과로 동작하고 분석을 새로 실행하거나 수정하지 않는다. `feat: 분석 이력과 결과 비교 화면 추가` 단위로 정리한다.

### Task 3: 입찰 프로젝트 — 기존 DB·서비스 위에 API·화면 완성

**Files:** 재사용 `supabase/migrations/20261022000300_bid_projects.sql`, `web/server/projects/`, `web/server/bids/review-pending.ts`, `web/server/task/`의 프로젝트 체크리스트 확장. 신규 `web/app/_lib/project-deps.ts`, `web/app/api/v1/projects/route.ts`, `projects/[id]/route.ts`, `projects/[id]/result/route.ts`, `web/app/(app)/(work)/projects/{page,loading,error}.tsx`, `project-board.tsx`, `projects/[id]/{page,loading,error,not-found}.tsx`, `project-detail-view.tsx`, `checklist-actions.ts`, `web/components/projects/bid-project-entry.tsx`. 수정 공고 상세 page·view, `web/app/api/v1/_lib/work-route.ts`의 project 오류 자원, dashboard page·view·model·repo·service.

**Interfaces:** 기존 `@/server/projects`의 `getProjectBoard`, `getProject`, `getProjectEntry`, `openProject`, `updateProject`, `recordProjectResult`, `countActiveProjects`와 `ProjectDeps`를 재사용한다. HTTP 계약은 기존 N6 스펙 §2, 체크리스트는 `@/server/task`의 `listProjectChecklist`·`addProjectChecklistItem`을 사용한다.

- [x] DB·도메인 커밋을 통합하고 현재 `audit_logs` action 목록을 보존한다. 타입는 재생성한다. `scripts/database.test.mjs`에서 BID 없이 생성 거부, 동일 공고 중복 방지, 타 조직 격리, SALES·ADMIN만 체크리스트 쓰기를 검증한다.
- [x] API는 `businessRoute`·CSRF·16KB 본문 제한·기존 오류 봉투를 따른다. 상태/담당자/마감 변경이 하나의 PATCH에서 부분 적용되는지 검토한다. 섞인 변경은 원자적 RPC로 처리하도록 보완하며 보정은 새 마이그레이션에 둔다. 실패 응답 뒤 일부 저장되는 동작을 허용하지 않는다.
- [x] 보드 5열(검토 대기 → 제안 준비 → 제출 완료 → 결과 확인 → 종료), 상세(담당자·체크리스트·마감·이력·수동 결과), 공고 상세의 만들기/보기/다시 열기를 연결한다. 드래그 라이브러리는 추가하지 않는다.
- [x] 최신 사람이 내린 결정이 BID가 아니면 경고·상태 전진 차단, 수동 종료 허용, 자동 종료 없음. 종료 뒤 새 BID로 다시 열 때 이전 결과는 감사 기록에 남긴다. 공고 정정은 revision 경고와 최신 공고 링크로 표시한다.
- [x] 대시보드 슬롯 5를 ‘진행 중 입찰 프로젝트’로 연결한다. 현재 `dashboard-view.tsx`에서 카드를 직접 렌더링하므로 존재하지 않는 슬롯 파일을 전제로 하지 않는다. `DashboardSummary.projects.active`와 `status <> CLOSED` 집계를 추가하고 현재 `origin` 필터와 같은 범위로 센다. 기존 count 서비스도 필요하면 `origin` 인자를 추가한다. 나머지 4카드·기존 분석 요약 응답은 유지한다.
- [x] `web/app/api/v1/projects-contract.test.ts`와 DB 정책 시험에서 최신 결정 변경 시 409·타 조직 404·혼합 PATCH 실패의 무변경을 검증했다. `pnpm -C web exec vitest run server/projects app/api/v1/projects-contract.test.ts` 및 통합 `pnpm verify:changed`를 통과했다. 보드·상세의 실제 로그인 읽기 전용·SALES 저장 흐름은 Task 5에서 확인한다.

**완료 기준:** BID 결정 → 프로젝트 생성 → 체크리스트 → 상태/결과 기록 → 재조회가 저장되고 이력·RLS가 보장된다. 결과는 점수·모델·학습 입력에 연결하지 않는다. `feat: 입찰 프로젝트 API와 업무 화면 완료` 단위로 정리한다.

### Task 4: 인력 배치 시뮬레이션 — 스냅샷·기간 충돌 읽기

**Files:** 신규 `web/server/workforce/{workforce.model,workforce.repo,workforce.service,index}.ts`, `workforce.service.test.ts`; 신규 `web/app/api/v1/workforce/simulation/route.ts`, `web/app/api/v1/workforce-contract.test.ts`; 신규 `web/app/(app)/(work)/workforce/{page,loading,error}.tsx`, `workforce-view.tsx`, `workforce-query.ts`. 재사용 `@/server/scoring`의 `analysisInputSchema`, `staffAvailability`, `availableFte`, `defaultProjectPeriod` 및 기존 인력 표시 부품.

**Interfaces (구현 계약):** `GET /api/v1/workforce/simulation?bidIds=<UUID,...>`는 서로 다른 공고 1~3건. `simulateWorkforce(orgId, bidIds, deps, now): Promise<WorkforceResult>`; deps는 읽기 전용 repo, `now`는 서버가 요청당 한 번 만든 Date. `WorkforceResult`는 각 공고의 `analysisId`, `snapshotAsOf`, `period`, `requiredFte`, `availableFte`, `missingReason`, 후보와 `currentAssignmentsAsOf`, 충돌 구간을 구분한다. 오류 응답은 기존 400/401/404 봉투를 따른다.

- [x] 단일 공고 기준은 최신 COMPLETED/PARTIAL 분석의 **검증된 입력 스냅샷**이다. `team`·수행 기간·기준일을 그대로 써 `staffAvailability` 결과와 일치시킨다. 최신 시도만 RUNNING/FAILED이면 최근 완료 분석을 보고 있음을 날짜와 함께 표시한다. 유효한 완료 스냅샷이 없으면 ‘분석 필요’와 공고 상세 링크, FTE는 빈 값이다.
- [x] 필요 인력이 UNKNOWN일 때 현재 계산기의 예산 구간 추정·missing 정책을 그대로 따른다. 추정이면 출처를 밝히고, 정보 부족을 미충족이나 0명으로 바꾸지 않는다. 역할·기술 후보는 분석 스냅샷의 점수 대상 인력에 한정하며 설명에 27명을 하드코딩하지 않는다.
- [x] 여러 공고의 충돌은 현재 `assignments`를 한 기준 시각으로 읽어 직원·겹치는 기간별 기존 배정 과부하와 공고 간 공유 후보를 보여 준다. 공유 후보라는 사실을 확정 배정이나 부족 확정으로 표현하지 않는다. 날짜 경계는 기존 엔진의 반열린 구간 규칙을 따른다. 요구조건이 없으면 후보 판정을 ‘확인 필요’로 둔다.
- [x] 후보 카드에는 업무상 필요한 이름·부서·직무·기술·가용성·DEMO만 표시한다. 연락처·성별은 표시하지 않는다. 자동 배정·선택 저장·`assignments` 쓰기·새 점수 저장은 없다.
- [x] `workforce.service.test.ts`는 스냅샷 FTE 일치, 현재 배정 변경 뒤에도 과거 FTE 불변, 실제 겹치는 배정 1건 탐지, 비대상 후보 제외, 저장 호출 없음만 검증한다. `workforce-contract.test.ts`는 1~3 UUID 계약·세션 조직 격리를 검증한다. 기존 골든은 재사용하고 새 전수 조합을 만들지 않는다.
- [x] 공고 선택 → 필요/가용 인력 → 후보·부족 근거 → 충돌 화면을 연결한다. `pnpm -C web exec vitest run server/workforce/workforce.service.test.ts app/api/v1/workforce-contract.test.ts server/scoring/worked-examples.golden.test.ts` → PASS, `pnpm verify:changed`.

**완료 기준:** 단일 공고는 저장된 분석과 같은 FTE이고 다중 공고는 현재 배정 시각·충돌 근거가 보인다. DB 쓰기·모델 호출이 없으며 200명 대상 체계를 유지한다. `feat: 인력 배치 시뮬레이션 화면 추가` 단위로 정리한다.

### Task 5: 통합 검증·메뉴 출시

**Files:** `web/components/app-nav.ts`, 신규 `web/e2e-auth/p1-navigation.write.spec.ts`, 기존 `web/e2e-auth/bid-isolation.spec.ts`(분석·시뮬레이션 읽기), `web/playwright.work.config.ts`의 기존 WRITE 탐색에 `p1-navigation` 추가, `docs/evidence/navigation/`, `docs/PROGRESS.md`. 구현된 계약에 맞춰 04·05·06·13의 해당 절만 갱신한다.

- [x] E2E는 기존 work 스택을 쓴다. 새 파일이 testMatch에 실제 포함되는지 `pnpm -C web exec playwright test -c playwright.work.config.ts --list`로 확인한다. 기존 읽기 선행 프로젝트를 끄지 않는다.
- [x] 하나의 쓰기 흐름으로 관심 등록/해제 → 4건 비교·부분/실패 표시 → BID 프로젝트 생성·상태·체크리스트·결과 → 인력 시뮬레이션을 확인한다. 1440에서 기능 검증, 1280에서는 변경 화면 배치·가로 넘침 확인만 수행한다. API·권한 검증을 폭마다 중복하지 않는다.
- [x] 네 기능 각각 페이지·핵심 기능, API 연결, 서버 가드/RLS, 관련 시험, 완료 기준의 5조건을 점검한다. 충족한 메뉴 줄만 `released`로 바꾼다. 미완성 API·페이지는 정본대로 서버에서 404로 막고 메뉴 숨김만으로 대체하지 않는다.
- [x] 전체 최종 코드에서 `pnpm verify` 1회, 이어 `pnpm -C web test:e2e:work`로 변경 흐름을 확인한다. 새 worker 등록 영향은 N3 통합 시 mock Compose 기동·마감 알림까지 확인한다. 통합 단위 독립 리뷰 1회로 모으고 단계별 다중 QA를 반복하지 않는다.
- [x] 실제 실행 커밋·명령·결과·1440/1280 증거를 저장하고 기존 문서의 ‘구현 중’·`(채움)`과 구분한다. 클라우드 마이그레이션·배포는 검증 결과를 준비한 뒤 별도 절차로 진행한다.

**출시 판정:** ‘메뉴가 눌린다’가 아니라 네 화면의 실제 데이터·권한·핵심 흐름이 검증됐는지를 기준으로 한다. 미완성 묶음은 나머지 묶음의 출시를 막지 않으며 완료로 보고하지 않는다.

2026-10-22 로컬 구현·통합 검증 완료. 최종 전체 verify, 로그인 E2E17건, axe14회, 독립 통합 리뷰와 1440/1280 확인을 통과했다. [실행 결과·증거](../evidence/navigation/20261022-implementation.md). 공유 파일·마이그레이션을 함께 검증한 하나의 통합 변경으로 정리하며 클라우드 적용과 main 병합은 별도다.

## 3. 우선순위·예상 작업량

| 단계 | 상대 작업량 | 이유 / 우선 처리 |
|---|---|---|
| N3 | 중 | 화면까지 있으므로 가장 먼저 재사용. 최신 worker·DB·시험 정책 통합과 검증 공백 보완 |
| N5 | 중 | 기존 분석 조회를 확장하는 읽기 화면. 별도 모델·DB 표 없음 |
| N6 | 큼 | API·보드·상세·체크리스트·상태 전이·감사·카드까지 연결. 일정상 가장 큰 위험 |
| N7 | 중~큼 | 계산 재사용은 가능하지만 스냅샷/현재 배정 구분과 후보·충돌의 의미를 정확히 구현해야 함 |

이는 시간 보장이 아닌 조사 기준 상대 규모다. 첫 실행에서는 N3 통합과 현재 검증 통과 여부를 확인한 뒤 나머지 일정을 갱신한다. 네 기능을 모두 새로 만드는 견적을 사용하지 않는다.

## 4. 최초 계획 조사 단계의 검증 범위

최초 조사 문서를 작성할 때 메뉴 정의·페이지 파일·API·마이그레이션·승인 설계·기존 브랜치 커밋을 대조했다. 그 조사 단계에서는 제품 코드·DB·브랜치 이력을 변경하지 않았고, 문서만 변경해 ADR-046에 따라 제품 `pnpm verify`·E2E를 실행하지 않았다. 문서 경로·참조 자산·사실관계·diff와 기존 미커밋 파일 보존을 확인했다. 정적 조사 증거는 `docs/evidence/navigation/20261022-menu-audit.json`이다. 이후 승인된 구현·검증 결과는 위 실행 기준 갱신과 [통합 기록](../evidence/navigation/20261022-implementation.md)에서 구분한다.

## 관련 문서

- [[06-UI-UX|06 UI]]
- [[04-DATABASE|04 DB]]
- [[05-API-SPEC|05 API]]
- [[09-SECURITY|09 보안]]
- [[12-ROADMAP|12 로드맵]]
- [[13-NOTIFICATIONS|13 알림]]
- [[16-DECISIONS|16 결정]]
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
- [[2026-10-16-sidebar-ia-design|사이드바 정보 구조 설계]]
- [[PROGRESS|진행 상황]]
