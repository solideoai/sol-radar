---
title: "C9 후속 화면 고침 검증 — 미결정 30 (2026-10-21)"
doc: evidence
status: draft
tags:
  - sol-radar
  - test
  - ui
updated: 2026-10-21
---

# C9 후속 화면 고침 검증 — 미결정 30

브랜치 `fix/c9-followups-ui`(worktree `sol-radar-worktrees/c9-followups-ui`, base N9 `b0be7e3`). 근거는 C9 2차 리허설([리허설 증거](../../demo-day/20261021-1144/checklist.md))에서 나온 [[16-DECISIONS|16]] 미결정 30 의 화면 항목이다. API 응답과 DB 는 바꾸지 않았다(ADR-039 ①). 정본 문구(06·08·09·16·19)는 45 가 이 브랜치 병합 해시로 고친다.

## 무엇을 바꿨나

| 항목 | 바뀐 곳 | 내용 |
|---|---|---|
| 30-1 | `web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx` `aiText` | `reviewFlags` 에 `AI_UNAVAILABLE` 이 있으면 요약 띠 AI 칸에 " · 응답 없음(규칙만)" 을 붙인다. 출처 표기("AI: mock")는 그대로다. |
| 30-2(a) | `web/components/bids/kev-opinion.tsx` | 결정 모델 안내 끝줄을 화면 상수 "결정 모델 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다." 로 보인다. API literal `KEV_DISCLAIMER` 는 그대로 둔다. |
| 30-2(b) | `scripts/demo/plan.mjs:308` | 데모 계획 문구를 "결정 모델이 BID 를 제시해도" 로 바꿨다. |
| 30-3 | (코드 변경 없음) | 요약 띠는 이미 06 §2 배지("대기 중"/"분석 중")를 그린다(`web/components/bids/labels.ts`). 리허설에서 "분석 중" 이 안 보인 까닭은 mock 분석이 2초 폴링 한 번 안에 끝났기 때문이다. QUEUED·RUNNING 띠 배지 시험만 더했다. |
| 30-6 | `web/app/(app)/(work)/dashboard/dashboard-card-slots.ts` | 카드 제목 "분석 현황 (완료)". |
| 30-7 | 같은 파일 `NO_ANALYSIS_HINT` | 분석 0건 힌트 "분석 기록 없음". |
| 30-8 | `web/server/bids/` 대시보드 서비스, `web/components/bids/bid-table.tsx` | 재분석이 진행 중인 공고도 BID 권고 표에서 직전 완료 점수·권고를 보여 주고 "재분석 중" 을 붙인다. 아래 갈래 참고. |

### 30-8 갈래

대시보드 서비스 안에서 고쳤다(12 보충의 앞쪽 갈래). `DashboardRepo.listFinishedScores(bidIds)` 가 뷰 `bid_list_items` 의 `scored_score`·`scored_recommendation` 을 `.in("id")` 로 읽고(zod 검사, 빈 목록이면 읽지 않음), `finishedAnalysesOf` 가 공고별 `{solScore, recommendation, rerunning}` 을 만든다. `rerunning` 은 최신 run 이 QUEUED·RUNNING 일 때 참이다. 대시보드 화면만 이 값을 넘기고, 공고 목록 화면과 `/api/v1` 응답은 그대로다.

## 시험

| 시험 | 결과 |
|---|---|
| `pnpm -C web exec vitest run server/bids/dashboard.service.test.ts "app/(app)/(work)/dashboard/dashboard-card-slots.test.ts"` | 36 passed(30-8 서비스 5건 더함) |
| `pnpm -C web exec vitest run server/bids/dashboard.supabase.test.ts` | 11 passed(`listFinishedScores` 3건 더함) |
| 브라우저 시험 3파일(`dashboard-view`·`bid-detail-view`·`analysis-display`, 검증 슬롯) | 91 passed. 30-1 PARTIAL·COMPLETED·live, 30-3 QUEUED·RUNNING, 30-2(a) 새 문구 표시·literal 미표시·"Kev" 미표시, 30-8 고치기 전 "—" 확인 포함 |
| 변형 확인: ① `rerunning` 을 늘 거짓 ② 직전 완료값을 읽을 공고를 거르지 않고 모든 공고 id 로 읽기 | 각각 2 · 1건 실패로 잡힘(원복 뒤 통과) |
| `pnpm type-check`(typegen + tsc, 검증 슬롯) | 오류 없음 |

전체 `pnpm verify` 결과는 [[PROGRESS|진행 상황]] 작업 로그 행에 적는다.

## 실제 앱 확인

격리 Supabase(scratchpad 사본 `sol-radar-fuui`, API 59881, 마이그레이션 `20261019000019` 까지) + `pnpm demo:reset`(seed: orgs=2 users=5 people=200 bids=19 quarantined=1 reviews=2) + worktree `next dev -p 3216`. 분석은 실제 mock 파이프라인으로 만들었다. C9 리허설 때 만든 worker·ai-gateway 이미지(main `4e62170`, 이 브랜치가 바꾸지 않은 코드)로 redis·ai-gateway·worker 만 띄웠다(빌드 없음, `AI_PROVIDER=mock`, `KEV_ENABLED=true`, hosted 미승인). worker 가 격리 DB 를 가리키는 것을 `docker inspect` 로 먼저 확인했다. 공용 54321·클라우드는 쓰지 않았다. 키는 `supabase status` 에서 읽어 자식 프로세스 환경으로만 넘겼고 파일에 쓰지 않았다. 확인 뒤 dev 서버·컨테이너·볼륨을 내렸다.

로그인 계정은 admin(ADMIN, org-01)이다. 촬영 직전마다 Next 개발 표시(`nextjs-portal`)를 숨겼다. 모든 장면에서 가로 넘침이 없었다(`scrollWidth > innerWidth` 거짓).

| 장면 | 만든 방법 | 화면에서 읽은 글자 | 스크린샷 |
|---|---|---|---|
| ① 분석 0건 | seed 직후 | 카드 "분석 현황 (완료) \| 0 \| 분석 기록 없음", 1280 에서도 제목·힌트 모두 한 줄(N9 때 두 줄로 꺾이던 힌트가 풀림) | `01-dashboard-no-analysis-1440.png` · `-1280.png` |
| ② 사전 분석 | worker 안 `worker/demo-preanalyze.ts` | `targets=18 completed=18 partial=0 failed=0`. 카드 "18 \| 부분 0 · 실패 0", FX-01 행 "94 BID" | `02-dashboard-preanalyzed-1440.png` · `-1280.png` |
| ③ 결정 모델 안내(30-2a) | FX-18 상세 | 새 안내 문구 보임, 본문에 "Kev" 없음 | `03-detail-decision-disclaimer-1440.png` · `-1280.png` |
| ④ 재분석 대기(30-3) | worker 정지 → FX-01 상세 "재분석" 클릭 | 띠 "대기 중", run QUEUED, 버튼 "분석 중…" | `04-detail-rerun-queued-1440.png` |
| ⑤ 재분석 중 대시보드(30-8) | ④ 상태 그대로 | FX-01 행 "94 BID 재분석 중" | `05-dashboard-rerunning-1440.png` · `-1280.png` |
| ⑥ 응답 없음(30-1) | ai-gateway 정지 → worker 시작(대기 job 처리) | run `PARTIAL AI_UNAVAILABLE`. 띠 "부분 완료 (규칙만) · 분석 실행 모드: mock · AI: mock · 응답 없음(규칙만)" | `06-detail-partial-ai-unavailable-1440.png` · `-1280.png` |
| ⑦ PARTIAL 뒤 대시보드 | ⑥ 상태 그대로 | FX-01 행 "94 BID", "재분석 중" 사라짐 | `07-dashboard-after-partial-1440.png` · `-1280.png` |

> [!note] 콘솔 오류 28건은 모두 `/health/ready` 503 이다
> 이번에는 MinIO·Qdrant 를 띄우지 않아 준비 상태 점검이 503 을 돌려준다. 상단바 "AI: 확인 중" 도 같은 까닭이다. 이번 변경과 무관하다.

## 관련 문서

- [[16-DECISIONS|결정 기록]] 미결정 30
- [[06-UI-UX|화면 설계]]
- [[PROGRESS|진행 상황]]
