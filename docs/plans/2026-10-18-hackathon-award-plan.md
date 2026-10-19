---
title: "해커톤 수상 전략·최소 데모 컷·개발 순서 (보고, 승인 전)"
status: review
tags:
  - sol-radar
  - hackathon
  - plan
updated: 2026-10-18
---

# 해커톤 수상 전략·최소 데모 컷·개발 순서

사용자 지시(2026-10-18 밤, 2~10번 의사결정)에 대한 보고다. **2026-10-19 사용자 승인**(§8 전항목). 결정은 [[16-DECISIONS|ADR-023]]으로 정본에 옮겼고, Critical Path는 [[12-ROADMAP|12 로드맵]]이 정본이다. 이 문서는 승인 당시 보고로 보존한다. 마감 2026-10-27, 심사 기준은 [[18-HACKATHON|18 해커톤]] §4(실용성 30 · 창의성 25 · 완성도 25 · 확장성 20).

## 1. 최신 구현 상태 (main `1e7e081`, 2026-10-18 23:50 기준)

### 1.1 병합되지 않은 브랜치 (다른 세션 작업, 건드리지 않음)

| 브랜치 | 내용 | 상태 |
|---|---|---|
| `phase0/infra` (`e7053fe`, 76 파일) | `infra/compose.yaml`·`infra/env/{demo,ai-local}.env.example`·`infra/smoke.sh`, AI gateway 골격 `services/ai`(FastAPI `/health`, 실행 모드 모순 기동 거부, pytest 5), web `/health/live`·`/health/ready`, worker Dockerfile, mock 추출 19건·Kev 4건·골든 3건 fixture. `phase0/web-runtime`·`run-mode-ai`·`bid-fixtures`를 이미 품는다 | 구현됨. 통합 기동 증거(`compose-ps.txt`·`health-ready.json`) 없음. Phase 0 계획 Task 8·9 남음 |
| `feat/people-read` (`176471d`, Codex, 66 파일, 23:47 마지막 커밋) | `/people`·`/org-chart` 화면, `GET /api/v1/departments`·`/team-members`, `web/server/people`, **마이그레이션 `20261018000001_people_business_roles.sql`(`memberships.sol_role` 추가)**, 05 수정 | 진행 중. 이 마이그레이션은 [[04-DATABASE|04 DB]] §7 순서 1의 일부라 Phase 1이 그 위에 쌓아야 한다(중복 금지) |

### 1.2 완료·미완료 구분

| 영역 | 상태 | 근거 |
|---|---|---|
| 실행 모드 규칙 `infra/run-modes.json`·`pnpm check:env` | 구현 완료·테스트 통과 | main `15f5214`, `scripts/check-env.test.mjs` |
| worker 진입점·`system` 큐·`server-only` 실행 방식 | 구현 완료·테스트 통과 | main `fa92254`, `phase-0/worker-conditions.txt`. ingest·analysis job은 없음 |
| 공고 fixture 20건·검증기 | fixture만 준비 | main `caf0abd` |
| mock 추출 19·Kev 4·골든 3 | fixture만 준비, 미병합 | `phase0/infra` |
| AI gateway | 골격만(미병합). `/parse`·`/extract`·`/kev`·`/explain` 없음 | `phase0/infra` |
| Compose·smoke·health | 구현(미병합), 통합 기동 미검증 | `phase0/infra` |
| 인력 명부 200·사진 200·카탈로그·가입 폼·보완·마이그레이션 4개·`pnpm people:seed` | 구현 완료·테스트 통과. 클라우드 DB 미적용 | main `42a4ead`, [[PROGRESS]] |
| `/people`·`/org-chart`·인력 API·`sol_role` 열 | 구현(미병합, 검증 중) | `feat/people-read` |
| 점수 엔진 | 인력 가용 FTE 순수 함수만(`web/server/scoring/scoring.model.ts` 121줄). 5요소·자격 판정·결정 정책·Kev 플래그 병합 없음 | 코드 |
| 공고·프로필·분석·검토·알림·감사 표, RLS, `pnpm demo:reset` | 설계만 | `supabase/migrations/`에 없음 |
| 수집(`FixtureConnector`·`OfficialApiConnector`)·정규화·revision·격리 | 설계만 | `web/server/ingestion` 없음 |
| Qwen·Kev 어댑터, 인용 검증, 프롬프트 | 설계만 | `services/ai/src`에 health·run-mode만 |
| 화면 `/dashboard`·`/bids`·`/bids/[id]`·`/notifications`·`/admin/ingestion`·`/company` | 설계만(템플릿 대시보드만 있음) | `web/app/(app)/` |
| 인앱 알림 outbox | 설계만 | — |
| 외부 연동(실제 API 응답·첨부 다운로드·회사 GPU) | 구현되지 않음·미검증. `infra/.env`·루트 `.env.local` 없음 → 서비스키가 저장소 환경에 들어 있지 않다 | 파일 존재 확인만(값은 읽지 않음) |
| 평가 트랙(평가셋·E0~E3 하네스) | 설계만 | — |
| 제출물(슬라이드·영상·아키텍처·증거 색인) | 증거 색인만 있음(`docs/evidence/README.md`) | [[18-HACKATHON]] §10 |

요약: **"이 입찰에 들어가야 하는가"를 보여 주는 코드는 아직 없다.** 기반(모드·worker·fixture·gateway 골격·Compose)은 병합 직전이고, 인력 데이터는 끝났다.

## 2. 최소 수상 데모 (핵심 컷)

### 2.1 장면

| 장면 | 보여 주는 것 | 모드 | 심사 기준 |
|---|---|---|---|
| S2 대시보드 | 실행 모드·`DEMO` 배지·`AI:` 표시, BID 권고·검토 대기·마감 임박·수집·분석 현황 카드, BID 권고 표 | `mock` | 완성도 |
| S3 자격·근거·규칙 우선 | FX-01 자격 3건 충족 + 근거 서랍 + 94 분해, FX-03 미충족 → NO-BID + Kev 상충 배지 | `mock` | 창의성 D1·D3·D5 |
| S4 라이브 분석·사람 결정 | FX-02 분석 요청 → 72 WATCH → 결정 기록 → 알림 1건 | `mock` | 실용성·완성도 |
| **S-LIVE 실제 공고 1건** (신설, 15초 편집) | 실제 나라장터 공고(사전 수집·파싱) → Qwen 추출 → 규칙 자격 → SOL Score → Kev 참고 지표(`UNCALIBRATED`) → 근거·출처. 머리말 "실행 모드: live", 분석 패널 "AI: local · Qwen3.5-9B · Kev-9B v1.0", "가상 회사 프로필로 분석" 배지 | `live`(실추론은 사전 완료, 화면은 실시간 조회). 실패 시 같은 입력의 실행 로그 기반 녹화 영상이며 "녹화"라고 말한다 | 실용성 30·창의성 |
| S6 AI 장애 | `docker compose stop ai-gateway` → FX-01 재분석 `PARTIAL` 배너, 이전 run 보존 | `mock` | 완성도·정직성 |
| S7 격리 | `org-02` 토큰으로 자격 판정 404, 공고 200 | `mock` | 확장성 |
| S5 변경 감지 | FX-07 revision diff 68→76, FX-09 중복 0 | `mock` | **2순위**. 핵심 컷 완료 뒤 시간이 남으면 |

핵심 컷 = S2·S3·S4·S-LIVE·S6·S7. 모드 전환은 S4 → S-LIVE 사이에 한 번(env 교체 + worker·gateway 재시작, 리허설로 시간 실측). 전환이 30초를 넘으면 S-LIVE를 발표 맨 앞이나 맨 뒤로 옮겨 전환을 한 번만 한다.

### 2.2 핵심 컷에 들어가는 기능 (완료 기준)

1. 공고 표·revision·공용 RLS, fixture 19건 seed + FX-12 격리, `pnpm demo:reset`(기존 `people:seed` 흡수).
2. 회사 프로필 revision 2(08 §6.1 값, `is_demo=true`), 점수 계산 대상 27명·20 FTE를 `team_member_scoring`에서 읽어 `staffAvailability` 입력으로 쓴다. **조직도 화면 없이도 인력 데이터는 점수에 들어간다.**
3. 규칙 엔진: 자격 판정 3값+사유 코드, 5요소, missing 정책, 결정 정책, Kev 플래그 병합. 골든 94/72/68 byte-동일.
4. gateway `/extract`(mock fixture + 실제 인용 검증) · `/kev`(mock) · `/explain`(템플릿) → `local` 어댑터(vLLM OpenAI 호환, Kev `/v1/systemone`).
5. worker: ingest(fixture) → extract → analysis job, `PARTIAL`·`RULES_ONLY`, `score_runs`에 run_mode·모델·입력 스냅샷.
6. Route Handler: `/bids`, `/bids/:id`, `/bids/:id/analyses`, `/analyses/:id`, `/bids/:id/qualification-checks`, `/bids/:id/reviews`, `/dashboard/summary`, `/notifications`, `/health/*`.
7. 화면: `/dashboard`, `/bids`, `/bids/[id]`(자격·점수 분해·Kev 참고·근거 서랍·결정 패널·PARTIAL 배너), `/notifications` 최소. 앱 셸은 템플릿 사이드바에 메뉴 3개(대시보드·입찰 공고·알림)만.
8. 인앱 알림: `bid_reviews` insert 트리거 → outbox → `REVIEW_ASSIGNED`, `ANALYSIS_COMPLETE`.
9. live 1건: `OfficialApiConnector` 목록 1페이지 + 보조 조회 + 첨부 다운로드 + `/parse`(검증된 형식만) + 실추론.

## 3. 2~10번 지적사항별 해결 계획

| # | 지시 | 계획 | 증거 |
|---|---|---|---|
| 2 | 데모 필수 재조정 | 새 ADR-023 "해커톤 핵심 컷"으로 3단 재정의: **핵심 컷**(§2) → **확장 컷**(ADR-021 데모 필수 화면·S5·P0-8·평가 트랙 전체) → **P1**(ADR-021 P1, 변경 없음). ADR-020·021 본문 보존, 상태 열에 "ADR-023으로 범위 재배치"만 적는다. P1 착수 게이트 "데모 필수 전부 green"은 "핵심 컷 + 확장 컷 전부 green"으로 읽어 모순을 없앤다 | 16 ADR-023, 12 해커톤 컷 표 |
| 3 | P0-0 | §4 C1. 읽기 전용 GET 4종·첨부 다운로드 3건은 키만 있으면 안전. GPU 서버 작업(vLLM·kev.serve 기동)은 자원 점유라 사용자 권한·점유 범위 확인 뒤 실행. 결과는 `docs/evidence/phase-0/external-deps.md` 상태표(항목 · 날짜 · 명령 · 통과/막힘/대기 · 사유) | `phase-0/external-deps.md`, 마스킹한 응답 3건 `fixtures/recorded/` |
| 4 | 실제 AI 추론 시연 | S-LIVE 신설(§2.1). 사전 완료한 run을 화면으로 보이고, 실행 로그(`phase-5/live-e2e-<일시>.md`: 요청 ID·모델·`promptHash`·`stateHash`·지연)를 증거로 낸다. 실시간 추론 실패 시 같은 로그 기반 녹화, 발표에서 "녹화"라고 밝힌다 | `phase-5/live-e2e-*.md`, 영상 |
| 5 | Kev E3 필수 | [[21-MODEL-TRAINING]] §4.2 E3(Qwen 선택지 logprob 분류)를 필수로 올린다. 해커톤 규모: fixture 20건의 `recommendation`·`mandatoryRisk`·`needsHumanReview` + 실공고 5건(사람 라벨)에서 E0·E1·E3 비교, 지표는 Macro-F1·Brier·지연·순서 민감도(`permute`), Kev만 잡은 유효 위험 신호 수. E2(한국어 state)는 `fixture` 모드 평가용 gateway로 같은 입력 1회. 골든·가중치·Kev 미반영 구조 불변. 결과에 따라 3안(유지/축소/제외) 제안 | `eval/e0-e1-e3-<일시>.md` |
| 6 | 임팩트 수치 | 01 성공 측정을 "가설 / 예비 검증 결과" 두 열로 나눈다. 실험: 실공고 3건, 담당자 1~2명(확보 못 하면 "개발자 자체 검증"으로 표기), 수작업 vs SOL RADAR(사람 확인 포함) 시간·누락·수정 수·일치율·유용성 5점. n=3 예비 검증이며 일반화 불가 명시 | `docs/evidence/impact/<일시>.md` |
| 7 | 경쟁 비교 | 국내 서비스 3곳 공식 사이트에서 9개 항목(검색·필터·관심/알림·요약·기업 맞춤·자격 검증·인력 적합·의사결정 지원·근거 표시) 확인/미확인 표. URL·날짜·화면 캡처 파일명. 18 §3.2에 표와 핵심 메시지 "공고를 찾아주는 서비스를 넘어…" 추가 | 18 §3.2, `docs/evidence/competitors/` |
| 8 | 네트워크 장애 | 기본: 정상 네트워크·live 1건·mock 본편. 대체 경로 6종을 표로 고정: 인터넷 실패 → 로컬 Supabase CLI(`pnpm db:start`) + `demo:reset` 리허설; 공공 API → `fixture`; GPU → `mock` 또는 사전 run 조회; Supabase 클라우드 → 로컬 CLI; 첨부 실패 → `DOCUMENT_DOWNLOAD_FAILED` 화면 그대로; 추론 시간 초과 → `PARTIAL`. 자동 fallback 추가 없음, 화면에 모드·출처 표시, 발표에서 밝힘. 16 미결정 8번 종결 | 19 §5, `demo-day/rehearsal-log.md` |
| 9 | 제출물 | 슬라이드(11장: 문제·비효율·솔루션·흐름·SOL Score·기술 구조·실공고 사례·역량/인력 데이터·정량 검증·경쟁 비교·확장성), 3분 영상(문제→탐색→분석→점수·근거→결정→실추론 증거→효과), 기술 자료(Mermaid 아키텍처·데이터 흐름·E0/E1/E3 결과·실패 사례·API 출처·모드별 증거·한계 목록). 18 §10 체크리스트 각 항목에 파일 경로와 "심사 기준·제출 형식 충족 확인" 열 추가 | `docs/submission/` |
| 10 | 우선순위 | §4 Critical Path. `feat/people-read`는 핵심 컷 green 뒤 병합(단 `20261018000001` 마이그레이션은 Phase 1이 바로 위에 쌓는다). 조직도는 점수 입력 연결이 우선 | 12 로드맵 |

## 4. Critical Path·개발 순서

작업자 3~4명(에이전트) 병렬 전제. 날짜는 제안이고, C1 결과로 10-21에 한 번 재조정한다.

| ID | 작업 | 난이도 | 선행 | 실패 위험 | 증거 | 테스트 기준 | 일정 |
|---|---|---|---|---|---|---|---|
| C0 | Phase 0 마감: `phase0/infra` 통합 기동(`--profile demo`) → 증거 → main 병합 | 하 | 없음 | Docker Desktop·MinIO digest·포트 | `phase-0/compose-ps.txt`·`health-ready.json`·`run-mode-check.txt` | 5 서비스 healthy, `/health/ready` ok, V2-01 | 10-19 |
| C1 | P0-0: ① API 4종 실제 GET 각 3건(마스킹 저장) ② 첨부 3건 다운로드 ③ A40×2에 vLLM Qwen3.5-9B·`kev.serve` 9B 기동, 터널, `/v1/models`, VRAM·지연 실측 ④ 파서 후보 비교 시작 | 중(외부) | 사용자: `infra/.env`에 키 4개, GPU 접속 정보·권한 | 키 미설정·회사망 터널 차단·g2b 로그인 요구·vLLM Qwen3.5 미지원 | `phase-0/external-deps.md`, `fixtures/recorded/*.masked.json`, `phase-0/parser-benchmark.md` | 항목별 통과/막힘 기록. 막힘은 즉시 보고 | 10-19~20 |
| C2 | Phase 1 DB: 공고 5표·프로필·`score_runs` 4표·`bid_reviews`·`ingest_runs`·`outbox`·`notifications`·`audit_logs`, RLS·정책 시험, `my_sol_org_ids()`·`protect_sol_role`(`feat/people-read`의 `sol_role` 열 위에), `pnpm demo:reset`(계정 5·조직 2·프로필 rev 2·fixture 19+격리 1·리뷰 2·people seed 흡수) | 중상 | C0 | `pg_trgm` PGlite, `feat/people-read` 마이그레이션과 순번 충돌 | `phase-1/test-db.txt`·`seed-summary.json` | `pnpm test:db` G5, seed 2회 멱등 | 10-19~21 |
| C3 | Phase 2 수집: `FixtureConnector`·정규화·revision diff·격리·ingest job, documents job(`FixtureAttachmentFetcher`), `OfficialApiConnector`(C1 ① 응답 기반, `RecordedApiConnector` 시험), `G2bAttachmentFetcher` allowlist | 중 | C2, C1 ① | 실제 응답 필드가 명세와 다름 | `phase-2/test-ingestion.txt`, `ingest-run-live-*.json` | G1·G7·G10, V2-11·V2-12 | 10-21~22 |
| C4 | Phase 4 규칙 엔진(순수 함수): 자격 3값+사유, 5요소, missing, 결정 정책, Kev 플래그, 골든 94/72/68, `team_member_scoring` 27명 입력 | 중 | 없음(C2와 병렬) | 08 의사코드 해석 차이 | `phase-4/goldens-report.txt` | G3·G4, worked example 3건, 재현성, V2-05·V2-06 | 10-19~20 |
| C5 | Phase 5 gateway: `/extract`(mock + 인용 검증 §4.4) · `/kev`(mock v0.1) · `/explain`(템플릿) · `/parse`(검증 형식만) → worker extract·analysis job, `PARTIAL` 경로 → `local` 어댑터(vLLM guided JSON, Kev wire, 레지스트리 대조) | 중상 | C0·C4, local은 C1 ③ | Qwen 한국어 추출 품질, `KEV_TIMEOUT_MS` | `phase-5/test-ai.txt`·`ai-fallback.txt` | G6·G9, V2-03·04·07·08·13 | 10-20~22 |
| C6 | Phase 3 화면: 앱 셸 최소(메뉴 3개·Topbar 지표 4개·`DEMO`), `/dashboard`, `/bids`, `/bids/[id]`, `/notifications`, Route Handler 9개 | 중상(최대 덩어리) | C2 (API는 C4·C5 결과 형태) | 범위 팽창 | `phase-3/e2e/*.png` 1440·1280, axe | E2E 로그인→목록→상세→분석→결정, G8, V2-02 | 10-21~23 |
| C7 | Phase 6: `bid_reviews` 트리거·audit·outbox·인앱 알림 2종 | 하 | C2·C6 | — | `phase-6/test-notifications.txt` | G2(알림 1건) | 10-23 |
| C8 | S-LIVE: 실공고 1건 `live` E2E(수집→파싱→추출→규칙→점수→Kev→화면), 로그·녹화 | 중(외부) | C1·C3·C5·C6 | 터널·파싱 실패 → `PARTIAL`로 그대로 시연 | `phase-5/live-e2e-*.md`, 영상 | 분석 `COMPLETED`, 인용 검증 통과율 기록 | 10-23~24 |
| C9 | 리허설·대체 경로: 세 모드 전환 시간, 로컬 Supabase CLI 전환, 녹화 영상, 체크리스트 | 하 | C6·C7 | — | `demo-day/*` | 11 §5 전항목 | 10-24, 10-26 |
| X1 | E3 실험(§3 5번) | 중 | C5 local | 표본 작음(신뢰구간 명시) | `eval/` | 지표 표 + 3안 제안 | 10-24~25 |
| X2 | 임팩트 예비 실험 3건 | 하 | C8 | 담당자 미확보 → 자체 검증 표기 | `evidence/impact/` | 표 | 10-24~25 |
| X3 | 경쟁 비교 | 하 | 없음 | — | 18 §3.2 | 확인/미확인 표 | 10-19 (1시간) |
| X4 | 제출물: 슬라이드·3분 영상·기술 자료·18 §10 체크 | 중 | C8·X1·X2 | 시간 | `docs/submission/` | 심사 기준 4항목 각 1장 이상 | 10-25~26 |
| X5 | 확장 컷(시간 남을 때만, 순서대로): S5 변경 감지 → `feat/people-read` 병합·`/people`·`/org-chart` 노출 → `/admin/ingestion` → 설정 조직 탭 | — | 핵심 컷 green | — | — | — | 10-25 이후 |

**컷 규칙**: 10-21 저녁까지 C1 ③(GPU)이 막히면 S-LIVE는 "mock 모드 + 실공고 수집만"(Qwen·Kev 없이 규칙만, `PARTIAL`)으로 축소하고 정직성 표에 그렇게 적는다. C1 ①(API)까지 막히면 실공고 장면을 뺀다. 둘 다 사용자 보고 뒤 결정.

병렬: 10-19 C0‖C1‖C4‖X3 → 10-20 C2‖C4‖C5‖C1 → 10-21 C2‖C3‖C5‖C6 → 10-22 C3‖C5‖C6 → 10-23 C6‖C7‖C8 → 10-24 C8‖C9‖X1‖X2 → 10-25 X4‖X1 → 10-26 C9·freeze → 10-27 제출.

## 5. 정본 변경 계획 (승인 뒤 적용)

| 문서 | 유지 | 수정 | 이월 |
|---|---|---|---|
| 16 ADR | ADR-020·021 본문 전부, 골든·Kev 미반영·정직성 원칙 | ADR-023 신설(핵심 컷·확장 컷·P1 3단, 근거: 마감 10-27·배점 55점이 실용성+완성도, 이월 목록). ADR-020·021 상태 열에 "ADR-023으로 범위 재배치". 미결정 8번(네트워크 대체) 결정으로 종결 | — |
| 12 로드맵 | Phase 0~7 정의, P0 번호, D-2~D-day | 해커톤 컷 표를 핵심/확장/P1/이후 4단으로. P0-8·P0-9~P0-11을 확장 컷으로, E3를 핵심 컷 끝에. 간트를 10-27에서 역산(§4 일정). "데모 필수 전부 green 전 있으면 좋음 금지" 문장은 "핵심 컷 green 전 확장 컷 금지, 핵심+확장 green 전 P1 금지"로 | ADR-021 데모 필수 화면(N1 전체·N2·N4a·N8·N9) → 확장 컷 |
| 17 구현 규칙 | 절대 규칙 전부 | 해커톤 모드 우선순위 1~5를 ADR-023 순서로 | — |
| 18 해커톤 | §1·§2·§4·§7·§8·§9 | §3.2 경쟁 비교 표·핵심 메시지, §6 시간표에 S-LIVE 15초 삽입(S5는 생략 가능 표시), §10 체크리스트에 파일 경로·충족 확인 열 | — |
| 19 데모 시나리오 | S0~S7 | S-LIVE 장면·클릭 경로·실패 대응 추가, §2.1 모드 전환 1회 규칙, §5에 대체 경로 6종, §3 S0에 실공고 사전 run 준비 | S5를 "시간 남으면" |
| 11 테스트 | 골든 G1~G10, V2, PPL, NAV | §4 Phase별 수용 기준에 "핵심 컷" 표시, §5 체크리스트에 S-LIVE 행, §3.4에 E3 필수·해커톤 규모 | NAV-01~09 → 확장 컷 |
| 21 모델 학습 | 지표·오류 분석·파인튜닝 판단 | §4.2 E3 "선택" → "필수(해커톤 규모)", §3.5 규모에 "해커톤 축소판: fixture 20 + 실공고 5" 행 | test 20·dev 10 전체 평가셋 → 확장 컷 |
| 01 PRD | FR 표 | 성공 측정을 "가설 / 예비 검증(2026-10-2x, n=3)" 두 열로 | — |
| 10 배포 | 전부 | 기동 절차에 로컬 Supabase CLI 전환 절 | — |
| 06 UI | 전부 | 앱 셸 "해커톤 노출" 열을 핵심/확장으로 | — |
| PROGRESS | 로그 | Phase 체크리스트를 C0~C9·X1~X5로 재구성 | — |

정본 반영은 한 번에 한 세션이 하고, `feat/people-read`가 손댄 05는 그 세션 병합 뒤에 고친다(메모리 규칙).

## 6. 구현하지 않을 것 (해커톤 안)

- 200명 조직도 UI·`/people` 노출(브랜치에 있어도 핵심 컷 뒤), 조직·인력 고급 검색, 설정 조직 탭, 인력 배치 시뮬레이션, 직원 편집, `/ops` 분리, 추가 사이드바 메뉴.
- P0-8 사전규격·발주계획 단계 연결, 전체 평가셋(test 20·dev 10)·P0-11 학습셋 내보내기, Kev LoRA.
- 카카오 실발송, 경쟁사 통계, 결제·모바일·승률 예측(영구).
- 자동 fallback, 원본 위조, mock을 실모델처럼 보이는 표시.

## 7. 외부 의존성·위험

| 위험 | 영향 | 대응 |
|---|---|---|
| 서비스키가 `infra/.env`에 없다 | C1 ① 시작 불가 | 사용자가 Decoding 키 4개를 `infra/.env`에 넣는다. 에이전트는 값을 읽거나 출력하지 않는다 |
| 회사 GPU A40×2 접속·점유 권한 | S-LIVE·E3 | 사용자가 SSH 접속 정보·점유 허용 범위를 확인해 준다. 기동은 `127.0.0.1` 바인딩·`--gpu-memory-utilization` 제한·기존 프로세스 확인 뒤. 작업 전 보고 |
| g2b 첨부 로그인 요구 | 파싱·S-LIVE 품질 | 본문·API 필드만으로 진행, `DOCUMENT_DOWNLOAD_FAILED` 표시 |
| vLLM의 Qwen3.5-9B 지원·guided JSON | 추출 품질 | 첫 기동에서 확인, 안 되면 텍스트 파싱 + 검증 |
| `feat/people-read`와 Phase 1 마이그레이션 충돌 | C2 | 그 브랜치의 `20261018000001`을 기준으로 다음 순번부터 쌓고, 병합 전 PGlite로 둘을 함께 적용해 본다 |
| 10-21까지 C1 미해결 | 실데이터 주장 | §4 컷 규칙대로 축소, 정직성 표에 기록 |
| Supabase 클라우드 네트워크 | 전 장면 | 로컬 CLI 전환 리허설(C9) |

## 8. 승인 요청

1. ADR-023 핵심 컷(§2·§3 2번)과 이월 목록(§6).
2. §4 Critical Path와 일정, 10-21 컷 규칙.
3. 정본 변경 범위(§5) 착수.
4. C1 선행 조건: `infra/.env` 서비스키 4개 입력, GPU 서버 접속 정보와 점유 허용 범위.
5. 지금 바로 시작할 것(코드·정본 변경 없음): X3 경쟁 비교 조사(웹 열람만).

## 관련 문서

- [[18-HACKATHON|18 해커톤]] — 심사 기준·배점
- [[12-ROADMAP|12 로드맵]] — Phase·해커톤 컷
- [[16-DECISIONS|16 ADR]] — ADR-020·021, 미결정 8·16·17
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
- [[11-TESTING|11 테스트]]
- [[21-MODEL-TRAINING|21 모델 학습]] — E0~E4
- [[PROGRESS]]
- [Phase 0 계획](2026-10-18-phase-0-infra.md)
