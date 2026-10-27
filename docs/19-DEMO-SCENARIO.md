---
title: "19. 데모 시나리오: 데모 기업·fixture 스토리·클릭 경로"
doc: "19"
status: draft
tags:
  - sol-radar
  - hackathon
  - demo
updated: 2026-10-27
---

# 19. 데모 시나리오

> [!note] 발표 형식과 촬영 경로 ([[16-DECISIONS|ADR-054]])
> 본편은 "덱 20분 + 녹화 클립"이다. 클립의 길이·자막·캡션은 [[slides-spec|덱 제작 명세]] 부록 A가 정본이고, 이 문서는 클립을 찍는 클릭 경로와 장면별 촬영 경로를 정한다. D1 운영 사이트(`https://www.solideos-radar.com`, 시작 URL에 `?origin=demo`)는 S0~S4·S-LIVE·S7의 촬영 경로이자 질의응답 때의 라이브다. S5(변경 감지)·S6(AI 장애 대체)는 로컬 Compose에서 녹화한 클립으로 보인다. S5는 30초 클립 6으로 S4 뒤·S-LIVE 앞에 넣는다([[18-HACKATHON|18]] §6). 운영 회사 gateway를 멈추는 장면은 만들지 않는다. 운영에 `pnpm demo:reset`은 돌리지 않는다. 남은 날의 일정은 [[12-ROADMAP|12 로드맵]] "남은 일정 제안" 표다.

이 문서는 조작자가 따라가는 **클릭 경로**, 데모에 쓰는 **가상 기업과 fixture**, 각 장면에서 **화면에 보여야 하는 것**을 정의한다. fixture 20건의 전체 명세는 [[07-DATA-PIPELINE|07 수집]] §6.2의 fixture 표(`FX-01`~`FX-20`)가 단일 원천이고, 데모 기업 프로필과 점수 계산 예시는 [[08-SCORING|08 SOL Score]]가 단일 원천이다. 이 문서와 충돌하면 07·08을 따르고 이 문서를 고친다.

> [!warning] 가상 데이터
> 회사명 "솔리데오"와 부서·직급 명칭은 사용자 회사 기준이다(ADR-019). 가상 직원 200명·사용자·사진·공고·실적·자격·재무·가용성은 데모 설정이며 실제 회사 현황/공고를 뜻하지 않는다. 모든 데모 fixture는 `isDemo=true`이며, 공고 fixture의 `sourceUrl`은 `https://demo.sol-radar.invalid/notices/FX-xx`다. 화면에 `DEMO` 배지가 붙는다. 발주기관 이름은 실제 기관명을 쓰지만 공고 내용은 지어낸 것이다. `live` 모드의 공고는 실제 나라장터 공고(`isDemo=false`)이지만, 회사 프로필은 모든 모드에서 가상 솔리데오이고 분석 화면에 "가상 회사 프로필로 분석" 배지가 붙는다([[16-DECISIONS|ADR-020]]).

## 1. 데모 테넌트와 계정 (seed)

| 테넌트 | ID | 내용 |
|---|---|---|
| 솔리데오 (고정 회사명의 가상 데모 프로필) | `org-01` | 프로필 revision 2. 상세는 [[08-SCORING\|08]]이 단일 원천. 데모에 영향을 주는 값: 소프트웨어사업자·직접생산확인·**중소기업확인서(중기업)** 보유(FX-01 중소기업 제한경쟁 충족), ISO 27001·CMMI L3 보유, **정보통신공사업 등록 없음, 방산업체 지정 없음**, ISMS-P·CSAP 미보유, 단일 사업 수행 상한 50억, 기술 스택 Java/Spring·Next.js·NestJS·PostgreSQL·Kubernetes(FX-07 정정 후 BID 전환에 필요), 선호 분야 데이터 플랫폼·AX·민원·**교육**(FX-02 72 성립에 필요), 전체 가상 명부 200명(남녀 100/100), 200명 전원 계산 대상, 2026-12~2027-06 가용 95.5 FTE, 실적 3건 완료일 2024-11 / 2024-03 / 2025-09(모두 증빙 있음) |
| 비교조직 | `org-02` | 사용자 1명(VIEWER), 프로필 revision 1, 리뷰 0건. 격리 시연(S7) 전용 |

| 역할 | 계정 | 데모에서 하는 일 |
|---|---|---|
| ADMIN | `admin` 또는 admin@admin.com (`org-01`) | 이광희 · 정보기술연구소 · 관리자. 수동 수집 실행(live 배치) |
| SALES | sales@soltech.invalid (`org-01`) | 공고 탐색, 최종 결정 기록. **주 발표 계정** |
| ANALYST | analyst@soltech.invalid (`org-01`) | 분석 요청 (S4에서 SALES 계정이 대신해도 됨) |
| VIEWER | viewer@soltech.invalid (`org-01`) | 읽기 전용 확인(데모 미사용, RBAC 테스트용) |
| VIEWER | viewer@other.invalid (`org-02`) | 격리 시연 |

위 5계정은 가상 직원 명부 200명과 별개이며 명부에서 Auth 계정을 자동 생성하지 않는다. `.invalid`의 `soltech`는 기존 데모 계정 별칭으로 실제 회사 이메일이 아니다. 사용 회사 선택 UI는 솔리데오 하나만 표시하고 비교 조직은 격리 시험에서만 쓴다.

계정은 Supabase Auth 사용자이고, 역할 열은 조직 구성원 표의 업무 역할 `memberships.sol_role` 값이다. admin@admin.com는 조직 관리 권한도 가진다(`org_role=owner` + `sol_role=ADMIN`). 계정·조직·구성원은 `pnpm demo:reset`이 service role 키로 Supabase 프로젝트에 만든다([[16-DECISIONS|16 ADR]] ADR-017). 운영(D1)에 어느 계정이 있는지는 §3.1에서 확인한다.

관리자 한 계정만 준비할 때는 `node scripts/ops/demo-admin.mjs --env-file .env.local`로 대상을 먼저 확인하고 `--apply`를 붙인다. 비밀번호는 실행 환경의 `DEMO_ADMIN_PASSWORD` 또는 해당 파일의 `DEMO_ADMIN_PASSWORD`·`DEMO_SEED_PASSWORD`로 전달하며 명부·공고·분석은 초기화하지 않는다. 이 작업의 부서·직급 카탈로그는 가상 직원 200명의 생성 원본과 분리한다. `관리자` 직급 표시는 권한을 부여하지 않으며 실제 권한은 `memberships`에 별도로 적용한다.

관리자를 제외한 4계정의 이메일 도메인은 예약 TLD `.invalid`(RFC 2606)라 실제로 전달되지 않는다. seed 합계: 조직 2, 사용자 5, 프로필 revision 2, 공고 19건 적재 + 1건 격리(FX-12), 사전 리뷰 2건(FX-01 BID, FX-03 NO-BID). seed 로그 마지막 줄 `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true` ([[10-DEPLOYMENT|10]]).

비밀번호는 `.env.example`의 `DEMO_SEED_PASSWORD` placeholder로 두고 실제 값은 seed 시 입력한다. 문서와 저장소에 실제 값을 쓰지 않는다.

## 2. 장면별 fixture와 기대 결과

seed 배치는 `pnpm demo:reset` 때 revision 1로 적재되고, live 배치(FX-06 r2, FX-07 r2, FX-08 r2, FX-09 재전송, FX-10 02차)는 S5에서 수동 수집으로 투입한다. FX-20의 429 시퀀스(재시도 2회)는 seed 배치 안에서 일어난다([[07-DATA-PIPELINE|07]] §6.2·§6.4, [[11-TESTING|11]] §5 17번). 날짜는 seed 시 KST 18:00 기준 절대값으로 변환된다([[07-DATA-PIPELINE|07]]). 운영 DEMO 공고의 마감은 +15일 옮겼다(§3.1 4번).

| 장면 | fixture | 단계 | 특수 케이스 | 기대 자격 | 기대 점수 | 기대 권고 | mock 결정 모델 (BID/WATCH/NO_BID) |
|---|---|---|---|---|---|---|---|
| S2 대시보드 | FX-14 광주광역시 AI 행정 비서 시범사업 | NOTICE | 마감 +2일 | — | — | WATCH | 규칙 선택지 0.60 |
| S2 대시보드 | FX-12 (제목 없음) 경상북도 | NOTICE | 필수 필드 누락 → 격리 | — | — | 목록 미노출, 관리자 오류 1건 | — |
| S3 자격·근거 | **FX-01 세종특별자치시 차세대 행정정보시스템 고도화** (12억, +21일) | NOTICE | 정상, RFP 파싱 성공 | 3건 `SATISFIED`, 근거 인용 있음 | 94 | BID | 0.71 / 0.24 / 0.05 (일치) |
| S3 규칙 우선 | **FX-03 부산광역시 지능형 CCTV 통합관제센터 구축** (45억, +15일) | NOTICE | 정보통신공사업 등록 필수 | `NOT_SATISFIED` 1건 | 68 (참고 표시) | NO-BID | 0.55 / 0.30 / 0.15 → `MODEL_RULE_DISAGREEMENT`, mandatoryRisk 0.85 |
| S3 가정 재계산(데모 강화 컷, [[16-DECISIONS\|ADR-037]]) | **FX-03** 같은 공고, "정보통신공사업 등록" 보유 가정 스위치 1회 | NOTICE | 저장 없는 재계산, 원래·가정 모두 결정 모델 의견 제외 | 가정 띠에서 `NOT_SATISFIED` → `SATISFIED`(행 배지는 원래 그대로) | 68 → 68 (변화 없음) | 가정 띠 NO-BID → WATCH. 결정 패널은 NO-BID 그대로 | 가정에 포함하지 않음 |
| S4 재분석·결정 | **FX-02 경기도교육청 통합 LMS 구축** (28억, +10일) | NOTICE | 요구기술 6개 중 3개 보유(Vue.js·SCORM·WebRTC 없음), 마감 촉박 | `SATISFIED` | 72 (15.0+18.3+14.0+15.0+10.0, `mock` 골든). D1 재분석 예상은 §4 S4 | WATCH | 0.36 / 0.52 / 0.12 (일치), needsHumanReview 0.74 → `KEV_NEEDS_REVIEW` |
| **S-LIVE 실제 공고** | 실제 나라장터 정보화사업 공고 1건(`is_demo=false`). 공고번호·`score_runs` id는 촬영 때 `docs/evidence/`에 적는다 | NOTICE | 회사 반영 뒤 운영 `live` run(공고 본문·API 필드·첨부 텍스트). 실모델 결과라 값을 미리 정하지 않는다 | 규칙 판정 3값 + 사유 코드 | 실값 | 실값 | Bosun v3.1 0.6B 실추론 `kev-qs/v0.2`, `UNCALIBRATED`. 엔드포인트 미접속이면 `PARTIAL`·`RULES_ONLY` 그대로 |
| S5 변경 감지 | FX-07 한국도로공사 교통정보 데이터플랫폼 고도화 (18억 → r2 21.6억) | NOTICE 정정 | 예산 증액 + Kubernetes 추가 | 변동 없음 | 68 → 77 (엔진 77.3) | WATCH → BID, 재분석 1회(사람이 상세 [재분석]). `BID_CHANGED` outbox 1건(벨 알림 없음) | — |
| S5 변경 감지 | FX-06 대전광역시 스마트시티 통합플랫폼 유지보수 (마감 +14일 → +28일) | NOTICE 정정 | 기한 변경 | 변동 없음 | 78 유지 | BID 유지, `BID_CHANGED` outbox 1건(벨 알림 없음) | — |
| S5 멱등 | FX-09 서울특별시 공공데이터 개방 플랫폼 운영 | NOTICE | 동일 payload 재전송 | — | — | revision 1 유지, 이벤트 0건 추가 | — |
| S6 장애 대체 | FX-01 재분석 + ai-gateway 중지 | NOTICE | AI 추출 불가 | 규칙 기반 판정만 | 규칙 점수 | `PARTIAL` | 비활성 |
| S7 격리 | FX-01 자격 판정을 `org-02` access token으로 조회 | — | — | — | — | `404 NOT_FOUND`(RLS가 `org-01` 행을 숨김). 공고 자체 조회는 공용이라 `200` | — |
| Q&A 예비 | FX-04 NIA 데이터 거버넌스 컨설팅 (첨부 없음) | NOTICE | 자격 요건 본문에 없음 | `NEEDS_REVIEW`, 인용 0건 | — | WATCH | 0.60 WATCH |
| Q&A 예비 | FX-05 건보공단 대국민 포털 재구축 (HWP 손상) | NOTICE | 첨부 파싱 실패 | `NEEDS_REVIEW`, 추출 `PENDING_REVIEW` | — | WATCH, "첨부 원문 확인" 배지 | 0.60 WATCH |
| Q&A 예비 | FX-15 행정안전부 차세대 지방행정 공통기반 (80억) | NOTICE | 수행 상한 50억 초과 | `SATISFIED` | 68(운영 저장값은 58일 수 있다, [10-24 운영 smoke](evidence/deployment/20261024-prod-smoke/results.json), 증거 파일의 결함 D4) | WATCH, `SCALE_LIMIT_EXCEEDED` | 0.60 WATCH |
| Q&A 예비 | FX-17 → FX-18 과기정통부 AI 행정서비스 (발주계획 → 사전규격) | PLAN → PRE_SPEC | 식별자 `DEMO-PLAN-0042`로 연결 | PLAN은 `NEEDS_REVIEW`(사유 `STAGE_NOT_APPLICABLE`, 화면 `확인 필요` · 사유 `해당 없음`) | 82 (PRE_SPEC) | WATCH → BID, StageTimeline 2단계 | — |
| Q&A 예비 | FX-19 세종 행정정보 연계 플랫폼 사전규격 | PRE_SPEC | 식별자 없음, FX-01과 제목만 유사 | — | — | "연결 후보"만 표시, 자동 병합 없음 | — |

§3.2 4번 사전 분석 18건의 기대 플래그: `MODEL_RULE_DISAGREEMENT`는 FX-03에만 붙는다. `KEV_NEEDS_REVIEW`는 FX-04·05·11·13·17·19·20에 붙는다(mock 결정 모델 needsHumanReview 0.70 ≥ 임계 0.7). 위 표의 Q&A 예비 FX-04·FX-05 행도 이 플래그 대상이다. FX-07 점수와 FX-17 자격 표기는 규칙 엔진 출력이다([[16-DECISIONS|ADR-031]] C9·C10·C11).

> [!tip] 심사 포인트
> 세 결과(BID / WATCH / NO-BID)가 모두 한 번씩 나온다. 핵심은 **FX-03**: mock 결정 모델이 BID 0.55를 내도 정보통신공사업 미충족이 규칙에서 `NOT_SATISFIED`라 NO-BID로 고정되고 `MODEL_RULE_DISAGREEMENT`가 기록된다. 이 한 장면이 [[18-HACKATHON|18]] §3.2 차별점 D3·D5를 함께 보여 준다. 사람 결정 기록(D4)은 FX-02에서 보여 준다.

### 2.1 실행 모드 표시와 장애 대체 순서

실행 모드는 `SOL_RUN_MODE` 하나로 고른다([[16-DECISIONS|ADR-020]]).

| 모드 | 공고 | AI | 이 데모에서 쓰는 곳 |
|---|---|---|---|
| `mock` | fixture 20건 | 고정 응답(`AI_PROVIDER=mock`) | 로컬 Compose 녹화(S5·S6)와 대체 경로. 위 표의 기대 수치(94·72·68, 결정 모델 분포)는 mock 기준이며 골든과 같다 |
| `fixture` | fixture 20건 | 회사 vLLM API의 Qwen3.8-Flash-Next·회사 GPU 추론 엔드포인트의 Bosun v3.1 0.6B 실추론(HTTPS) | 로컬에서 공공 API가 안 될 때의 대체 |
| `live` | 실제 나라장터 공고 | 회사 vLLM API의 Qwen3.8-Flash-Next·회사 GPU 추론 엔드포인트의 Bosun v3.1 0.6B 실추론(HTTPS) | 운영 회사 런타임. D1의 FX-02 재분석(S4)과 S-LIVE run |

- 화면 표시: 상단바 `DEMO` 배지는 보는 출처가 demo일 때만 뜬다. 상단바에는 실행 모드·AI 표시가 없다. fixture 공고 행에 `DEMO` 배지, 상세의 분석 요약 띠에 "분석 실행 모드: mock|fixture|live"와 "AI: mock" 또는 "AI: local · Qwen3.8-Flash-Next-AWQ-INT4 · Hanno-Labs/bosun-v3.1-0.6b@5e78a37c"(받은 모델 식별자 그대로, [[16-DECISIONS|ADR-029]] A6 D12), 모든 모드에 "가상 회사 프로필로 분석" 배지가 보인다. 분석마다 그때의 모드가 기록되므로 모드를 바꿔도 지난 분석의 표시는 그대로다. 런타임의 지금 모드는 `GET /api/v1/admin/ai/status`(ADMIN)와 `/admin/ingestion`(수집 모드·정기 일정)으로 본다.
- `fixture`·`live` 모드의 실모델 결과는 mock과 다를 수 있다. S3 "규칙이 결정 모델을 이긴다"는 mock 결정 모델의 v0.1 `recommendation`(FX-03 BID 0.55)에 기대므로 `mock` run에서만 보장된다. D1에서는 운영에 저장된 FX-03 run을 그대로 보이고 재분석하지 않는다.
- 로컬 경로의 장애 대체 순서는 `live` → `fixture` → `mock`이다. 모드 전환은 env(`SOL_RUN_MODE`)를 바꾸고 worker·ai-gateway를 재시작해서 한다. 자동으로 바뀌지 않고(`AI_FALLBACK_TO_MOCK=true`는 세 모드 모두 기동 거부, [[16-DECISIONS|ADR-030]] B11), 바꿨으면 청중에게 말한다. D1 운영은 모드를 바꾸지 않는다.
- 회사 GPU 추론 엔드포인트([[16-DECISIONS|ADR-025]])에 닿지 않으면 `live`·`fixture` 분석은 `PARTIAL`·`RULES_ONLY`로 끝난다. 숨기지 않고 그 화면을 보여 준다(§4 S6 엔드포인트 미접속).
- S5의 "live 배치"는 fixture의 두 번째 배치(`batch:"live"`)이며 실행 모드 `live`와 다르다. 실행 모드 `live`에서 fixture 수집을 부르면 `409 RUN_MODE_MISMATCH`라 S5는 로컬 `mock`(또는 `fixture`)에서만 된다.
- S-LIVE는 운영 회사 런타임(`live`)이 만든 실공고 run을 `/bids?origin=live`로 연다. 모드 전환·reset은 없다. 분석마다 `run_mode`·`ai_provider`·모델 이름이 저장되므로 분석 요약 띠가 그 run의 모드와 모델을 보인다([[16-DECISIONS|ADR-023]]). 외부 의존성 컷 규칙([[12-ROADMAP|12 로드맵]]) 4갈래 중 어느 것으로 보이는지 발표에서 말한다. 녹화·fixture 결과를 live라고 말하지 않는다.
- 목록·대시보드의 기본 출처는 env `SOL_DEFAULT_ORIGIN`(`live`·`demo`·`all`)이 정한다. 없거나 틀린 값이면 실행 모드를 따른다: `fixture`·`mock` 모드면 `origin=demo`, `live` 모드면 `origin=live`(`web/server/bids/bid-query.ts` `defaultOrigin`). 운영 사이트는 기본으로 실공고를 보이므로 D1 촬영은 주소에 `?origin=demo`를 붙인다([[05-API-SPEC|05 API]] §3).

## 3. S0 사전 준비

### 3.1 D1 사전 준비 (촬영·질의응답 라이브)

운영에 `pnpm demo:reset`·`pnpm demo:preanalyze`를 돌리지 않는다. 모드 전환·회사 컨테이너 재시작도 하지 않는다. 운영 변경은 모두 따로 승인받는다.

1. 운영 `https://www.solideos-radar.com/health/ready`가 200이고 `checks`의 `db`·`redis`·`storage`가 ok인지 본다(`ai`는 `local`).
2. 발표 계정으로 로그인한다. 운영에 어느 데모 계정이 있는지는 리허설에서 확인한다(미확인).
3. `/dashboard?origin=demo`와 `/bids?origin=demo`를 연다. 상단바 `DEMO` 배지, 행 `DEMO` 배지, "(가상)" 제목, 운영 DEMO 공고(19건, 목록 기본 15건)와 기존 분석이 보이는지 본다. 주소에 `?origin=demo`가 없으면 운영 기본 출처인 실공고가 보인다.
4. DEMO 공고 16건의 마감을 +15일 옮긴 작업은 10-27 적용 완료다([실행 기록](evidence/demo-deadline/20261027/prod-run.md)). 로그인한 화면 확인은 남았다. 기대값은 목록 15 · 마감 임박 (7일) 1(FX-14, 11-03 전이면 0) · 마감 0 · BID 권고 2다(실행 기록 §5). 신규 발견은 0이다(`first_seen_at`은 옮기지 않았다, [실행서](evidence/demo-deadline/20261027/README.md) 남은 위험 5).
5. FX-02 상세를 연다. 운영에는 10-24 run 1건(66점 WATCH, `live`·`local`, `Qwen3.8-Flash-Next-AWQ-INT4` + `bosun-v3.1-0.6b`)과 결정 WATCH 1건이 이미 있다. 촬영 전까지 FX-02를 재분석하지 않는다(§4 S4 주의).
6. S-LIVE용 실공고 run이 있는지 본다. 지금 운영의 실공고 분석은 0건이다(본문이 비어 `409 ANALYSIS_SOURCE_MISSING`). 회사 반영([실행서](plans/2026-10-27-company-rollout-attachments.md)) 뒤에 만든다. 없으면 S-LIVE는 찍지 않고, 발표에서 그렇게 말한다.
7. S7용 `org-02` 계정(viewer@other.invalid)이 운영에 있는지 리허설에서 확인한다(미확인). 없으면 S7은 §3.2 로컬 경로에서 찍는다.
8. 덱과 클립 파일이 발표 PC에서 열리는지 본다.

### 3.2 대체 경로: 로컬 Compose

S5·S6 촬영, 운영에 `org-02` 계정이 없을 때의 S7 촬영, 회선·Supabase 장애(§5 대체 경로 ①)에 쓴다. 모드는 `mock`이고 골든 94·72·68이 나온다.

> [!warning] 운영 Supabase를 가리키지 않는다
> 로컬 경로는 격리 로컬 Supabase CLI(`pnpm db:start`)만 쓴다. `pnpm demo:reset`은 데모 조직 두 곳의 조직 소유 행(`score_runs` 포함)을 `org_id`로 지운다(`scripts/demo-reset.mjs` `ORG_SCOPED_TABLES`, [[04-DATABASE|04]] §6). 운영 프로젝트에 돌리면 운영 DEMO 분석이 지워진다.

D1 운영은 인터넷이 필요하다. 끊기면 로그인과 조회가 멈추고 `/health/ready`가 `503`을 낸다. 대체 경로는 §5 표의 ①~⑥이다. 자동 fallback은 없고 사람이 전환하며, 전환하면 발표에서 밝힌다([[16-DECISIONS|ADR-023]]).

1. `pnpm db:start`로 격리 로컬 Supabase를 켠다. env는 `SOL_RUN_MODE=mock`, `AI_FALLBACK_TO_MOCK=false`다. 마이그레이션은 `pnpm db:start`가 적용한다.
2. `docker compose -f infra/compose.yaml up -d --build`로 redis·qdrant·ai-gateway·worker를 띄운다. web은 호스트에서 `pnpm -C web start`로 띄운다. `curl -s http://localhost:3000/health/ready`가 `{status:"ok", checks:{db,redis,storage,ai:"mock"}}`인지 본다. 전체 기동 절차는 [[10-DEPLOYMENT|10 배포]] "데모 당일 기동 절차"다.
3. `pnpm demo:reset`으로 seed를 적용한다. 출력 마지막 줄(§1)과 `--write-summary <경로>` JSON의 `ingestRun.summary`가 `{created:19, changed:0, cancelled:0, skippedDuplicate:0, quarantined:1, retried:2}`인지 본다(격리 = FX-12 제목 누락, 재시도 2 = FX-20의 429 두 번).
4. `pnpm demo:preanalyze`로 FX-02를 뺀 적재 공고 18건을 미리 분석한다(`mock`·gateway 필수, 18건 모두 `COMPLETED`, [[10-DEPLOYMENT|10 배포]] 기동 절차, [[16-DECISIONS|ADR-031]] C12(f)). FX-02는 `미분석`으로 남는다. 로컬 S4는 [분석 실행]이고 결과는 골든 72다. reset을 다시 돌렸으면 사전 분석도 다시 한다.
5. `http://localhost:3000/auth/login`에서 sales@soltech.invalid로 로그인한다. S7을 로컬에서 찍으면 `org-02` 토큰을 받아 둔다(§4 S7 명령).
6. 분석 화면의 분석 요약 띠가 "분석 실행 모드: mock"·"AI: mock"인지 본다.

`live`·`fixture` 기동 확인이 필요하면 [[10-DEPLOYMENT|10 배포]] 기동 절차와 [[16-DECISIONS|ADR-034]] 16번 조건을 따른다.

## 4. 클릭 경로

장면 번호 규약: 데모 장면은 `S0`(준비)~`S7`, 테스트 골든 시나리오는 `G1`~`G10`([[11-TESTING|11]]). 둘을 섞어 쓰지 않는다. [[21-MODEL-TRAINING|21 모델 학습]]의 평가 비교 대상은 `E0`~`E4`로 부르고 데모 장면 번호와 섞지 않는다.

"보여야 하는 것"이 보이지 않으면 그 장면을 다시 찍거나 뺀다. 거짓으로 설명하지 않는다. D1 주소는 모두 `https://www.solideos-radar.com` 아래다.

| 장면 | 클립([[slides-spec\|덱 제작 명세]] 부록 A) | 촬영 경로 | 시작 URL |
|---|---|---|---|
| S1 문제 | 슬라이드 | — | — |
| S2 대시보드 | 1 | D1 운영 | `/dashboard?origin=demo` |
| S3 자격·규칙 우선·가정 재계산 | 1 · 2 | D1 운영 | `/bids?origin=demo` |
| S4 재분석·사람 결정 | 3 | D1 운영 | `/bids?origin=demo` → FX-02 |
| S-LIVE 실제 공고 | 5(선택) | D1 운영(회사 반영 뒤) | `/bids?origin=live` |
| S5 변경 감지 | 6(슬라이드 13, 클립 4 앞) | 로컬 Compose | `http://localhost:3000/admin/ingestion` |
| S6 장애 대체 | 4 앞부분 | 로컬 Compose | `http://localhost:3000/bids?origin=demo` → FX-01 |
| S7 격리 | 4 뒷부분 | D1 운영 API(`org-02` 계정이 없으면 로컬) | `/api/v1/bids/{FX-01 id}/qualification-checks` |
| 카카오 수신 | 카카오 10초 | 운영 앱 + 휴대폰 | 실공고 상세 |

> [!warning] 대본 주의: 출처(`?origin=demo`)가 빠지는 이동
> - 사이드바 "입찰 공고"는 `/bids`로 간다(`web/components/app-nav.ts:52`). 출처 값이 없어 누르면 서버 기본 출처(운영은 실공고)로 바뀐다. 촬영 중에는 사이드바를 누르지 않는다.
> - 상단바 `DEMO` 배지는 주소의 `?origin=`만 읽고, 없으면 서버 기본 출처를 쓴다(`web/components/topbar-demo-indicator.tsx:25`).
> - 목록에서 상세로 가면 주소는 `/bids/{id}?list=…`이고 출처는 `list` 안에 있다(`web/components/bids/bid-table.tsx:121`). 그래서 상세에서는 상단바 `DEMO` 배지가 빠질 수 있다(추정, 실행 확인 안 함). 상세 머리의 `DEMO` 배지는 남는다(`bid-detail-view.tsx:380`).
> - 촬영 중에는 출처가 붙은 URL로 주소창에서 이동한다. 대시보드 표의 링크는 출처를 붙인다(`dashboard-queries.ts:19`).

### S1 문제 — 슬라이드

조작 없음.

### S2 대시보드

1. `/dashboard?origin=demo`.
2. 보여야 하는 것: 상단바 `DEMO` 배지·수집 신선도·알림 벨, "공공조달 요약" 숫자 띠(신규 발견·마감 임박 (7일)·분석 대기·BID 권고·진행 중 입찰 프로젝트), 왼쪽 "우선 검토할 입찰"·"예정 사업 및 사전규격", 오른쪽 수집 지표·수집 소스 상태·기관별 공고 수·입찰 포트폴리오. D1 숫자는 §3.1 4번 기대값이다. 로컬 `mock`은 BID 권고 3(FX-01·FX-18·FX-06)이다. 두 값이 다른 원인은 미확인이다. 격리 1건(FX-12, 제목 누락)은 `/admin/ingestion` 실행 상세로 본다(ADMIN). 최근 변경 목록은 화면에 없다([[05-API-SPEC|05]] §4).
3. 말할 것: 지금 보는 공고는 `DEMO` 배지가 붙은 가상 공고이고 회사 프로필도 가상 솔리데오라는 것을 먼저 밝힌다. "깨진 데이터는 숨기지 않고 격리한다."
4. (선택, 15초) 사이드바 → 조직·인력: 200명 조직도와 "점수 계산 대상" 200명 배지. 말할 것: "사진과 사람은 모두 가상이고, 점수 계산에는 가상 200명 전원의 속성을 쓴다." 돌아올 때는 주소창에서 출처가 붙은 URL로 간다.

### S3 자격 판정과 규칙 우선

1. `/bids?origin=demo`(또는 대시보드 표의 링크). 필터 권고 `BID`, 정렬 "점수 높은 순"(`web/components/bids/bid-filters.tsx:65`). 상단에 FX-01(94, BID), FX-18(82), FX-06(78) 순으로 보인다. 단계 `입찰공고` 필터는 사전규격인 FX-18을 빼므로 쓰지 않는다([[16-DECISIONS|ADR-031]] C3).
2. **FX-01** 클릭 → `/bids/[id]`. 상단: 세종특별자치시, 12억, D-day, 단계 타임라인, 원문 링크, `revision 1`, 상태 `COMPLETED`. 분석 요약 띠(저장된 run의 모드·AI)와 "가상 회사 프로필로 분석" 배지.
3. 자격 체크리스트 3건 모두 `SATISFIED`. 한 건의 근거 열기 → `EvidenceDrawer`: fixture에 저장된 가상 인용 구절·페이지·문자 위치(실제 RFP 파싱 결과가 아님). 말할 것: "AI가 만든 인용이 아니라 원문과 대조된 인용. 대조에 실패하면 무효."
4. 뒤로 → 권고 필터를 풀고 결정 `NO-BID` 선택 → **FX-03** 클릭. 1번의 권고 `BID` 필터가 FX-03(권고 NO-BID)을 거르기 때문이다.
5. 자격 체크리스트: 정보통신공사업 등록 `NOT_SATISFIED`(사유: 프로필에 등록 없음). 권고 `NO-BID`. 결정 모델 패널: `모델 선택지 신뢰 분포 (충족·수주 확률 아님)` 문구, BID 0.55 / WATCH 0.30 / NO_BID 0.15, 배지 `MODEL_RULE_DISAGREEMENT`. FX-03은 재분석하지 않는다(§2.1).
6. 말할 것: "모델이 BID라고 해도 필수 자격 미충족은 규칙이 이긴다. 모델 분포는 수주확률이 아니다."
7. (데모 강화 컷, [[16-DECISIONS|ADR-037]]) 필수자격 "정보통신공사업 등록" 행 첫 줄 오른쪽의 "보유 가정" 스위치를 한 번 켠다. 1초 안에 분석 요약 띠 아래에 점선 "가정 시나리오" 띠가 나온다: 권고 NO-BID → WATCH, SOL Score 68 → 68 "변화 없음", 필수자격 미충족 → 충족, 요소별 점수 "바뀐 요소 없음", 고정 문구 "가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다."·"결정 모델 의견은 가정에 포함하지 않았습니다." 오른쪽 결정 패널은 NO-BID 68과 "마지막 결정: NO-BID" 그대로다. 행이 화면 밖이라 스크롤했으면 행의 "가정 시나리오 보기"로 띠에 간다.
8. 말할 것: "정보통신공사업 등록이 있다면? 저장하지 않고 같은 규칙으로 다시 계산하면 권고가 WATCH로 바뀌고 점수는 68 그대로다. 자격은 점수가 아니라 관문이다. 이 결과는 결정 기록에 쓰이지 않는다."
9. [가정 지우기] → 띠가 사라지고 스위치가 꺼진다. 스위치가 없거나(입력 기록 없음) 계산이 실패하면 7~9를 건너뛴다.

### S4 재분석과 사람 결정

> [!warning] 촬영 주의 ([실행서](evidence/demo-deadline/20261027/README.md) S4 절)
> 운영 FX-02에는 10-24 run(66 WATCH)과 결정 WATCH가 이미 있어 `미분석`이 아니다. [재분석]으로 만든 run이 최신 분석이 된다. 10-28~11-02에 재분석하면 78 BID가 최신이 되어 대시보드 BID 권고 수와 BID 권고 알림이 바뀐다. 리허설에서는 FX-02를 재분석하지 않는다. 11-03 이후 재분석하면 다시 72 WATCH가 된다.

1. `/bids?origin=demo`에서 **FX-02** 클릭. 분석 요약 띠에 이전 run(66 WATCH, `live`·`local`), 결정 패널에 "마지막 결정: WATCH"가 보인다.
2. [재분석] 클릭 → `QUEUED → RUNNING → COMPLETED`(화면 `대기 중 → 분석 중 → 완료`). 버튼 글자는 분석이 있으면 "재분석", 없으면 "분석 실행"이다(`web/app/(app)/(work)/bids/[id]/bid-detail-view.tsx:476-482`). 응답은 `202` + `pollUrl`. 실추론 소요 시간은 미측정이다.
3. 점수 게이지와 5개 요소 분해는 화면 값으로 설명한다. 예상(AI 추출이 mock과 같을 때, 추정)은 10-28~11-02 촬영이면 **78 BID**, 11-03 이후면 **72 WATCH**다. 이전 run의 66은 옛 마감 기준 일정 계수(마감까지 영업일 5 미만 → 0.4) 결과로 설명한다(추정). 골든 72(15.0+18.3+14.0+15.0+10.0, [[08-SCORING|08]] worked example B)는 `mock` 시험 기준이다.
4. 결정 모델 패널의 분포도 화면 값으로 읽는다(`mock`은 BID 0.36 / WATCH 0.52 / NO_BID 0.12). 말할 것: 72 WATCH면 "점수 50~75 구간은 사람 검토", 78 BID면 "권고가 BID여도 참여 결정은 사람이 사유와 함께 기록한다".
5. 결정 패널: 결정 `WATCH`, 사유 "요구기술 3개(Vue.js·SCORM·WebRTC) 미보유, 협력사 확보 후 재검토", 담당자에 발표자 자신 지정 → 저장. `REVIEW_ASSIGNED`는 담당자에게만 가므로 발표자를 담당자로 둔다.
6. 보여야 하는 것: 결정 이력 2건(10-24 WATCH + 새 결정), 알림 벨에 `REVIEW_ASSIGNED` 포함. 분석 요청자에게 가는 `ANALYSIS_COMPLETE`도 올 수 있어 벨은 1~2건이다([[16-DECISIONS|ADR-029]] A6 D5).

로컬 `mock` 경로에서는 FX-02가 `미분석`이라 [분석 실행]이고, 결과는 골든 72·결정 모델 분포 위 값·결정 이력 1건이다.

### S-LIVE 실제 공고 (ADR-023)

회사 반영 뒤 운영 `live` run이 있을 때만 찍는다(§3.1 6번). 그 전까지 이 장면의 결과는 촬영 뒤 채운다.

1. `/bids?origin=live`. 실제 공고 1건(`DEMO` 배지 없음, 출처 `g2b-bid-notice`)을 연다.
2. 보여야 하는 것: 상단 요약에 실제 발주기관·예산·마감·원문 링크(실제 나라장터 URL), "가상 회사 프로필로 분석" 배지. 분석 요약 띠에 "분석 실행 모드: live", "AI: local · Qwen3.8-Flash-Next-AWQ-INT4 · Hanno-Labs/bosun-v3.1-0.6b@5e78a37c", 분석 시각. 자격 체크리스트는 3값 + 사유 코드(`NEEDS_REVIEW`가 많아도 그대로), 점수 분해 5행, 결정 모델 참고 지표(고지 문구. 보정 상태 `UNCALIBRATED` 표시는 미구현, [[03-AI-PIPELINE|03]] §5.7), 근거 서랍에 공고 본문·API 필드·첨부 인용. 첨부 배지 "첨부 원문 확인"(`PARSE_UNSUPPORTED`)·"첨부 원문 확인(내려받기 실패)"(`DOCUMENT_DOWNLOAD_FAILED`)가 나올 수 있다(`web/components/bids/labels.ts:179-180`). 처리 범위 밖 첨부(공고당 기본 3건 초과, `.pdf`·`.hwp`·`.hwpx` 아닌 것)는 `PENDING`으로 남는다([[16-DECISIONS|ADR-055]]).
3. 말할 것: "지금까지는 가상 공고였다. 이 건은 실제 공고를 회사 Qwen API와 회사 GPU의 결정 모델로 분석한 결과다. 분석 요약 띠가 live 모드를 기록한다. 회사 프로필은 가상이다." 첨부 일부만 반영됐을 수 있다고 밝힌다([[16-DECISIONS|ADR-056]]). 규칙만 `PARTIAL`이면 그 말을 그대로 한다.
4. 보이지 않으면: 녹화가 없으면 장면을 빼고 Q&A에서 사유를 말한다. 실시간 추론으로 포장하지 않는다.

### S5 변경 감지와 멱등 (로컬 Compose 녹화, 클립 6)

1. 로컬에서 admin@admin.com로 전환(또는 미리 로그인한 탭) → `/admin/ingestion` → "수동 수집 실행", 배치 `live`. 이 배치는 fixture의 두 번째 배치이며 실행 모드 `live`가 아니다(§2.1).
2. 보여야 하는 것: 수집 결과 `{created:0, changed:3, cancelled:1, skippedDuplicate:1, quarantined:0, retried:0}` = 변경 3(FX-06, FX-07, FX-10), 취소 1(FX-08), 중복 skip 1(FX-09).
3. **FX-07** → `/bids/[id]/revisions`(상세는 revision이 2 이상일 때 이 화면 링크를 보인다): 예산 18억 → 21.6억, 요구기술에 Kubernetes 추가가 diff로 하이라이트. 수집은 분석을 자동으로 넣지 않으므로([[16-DECISIONS|ADR-030]] B18) 상세에서 [재분석]을 누른다. 결과 68 → 77, 권고 WATCH → BID([[16-DECISIONS|ADR-031]] C9·C15). 재분석과 점수 변화는 30초 클립 6에 넣지 않고 Q&A 예비로 둔다. 클립 6은 수집 결과 → FX-07 diff → FX-09 revision 1까지다.
4. `BID_CHANGED`는 outbox 이벤트로만 남고 벨 알림은 생기지 않는다(`web/server/notifications/outbox.model.ts:6`, [[07-DATA-PIPELINE|07]] §6.2). 말할 것: "같은 공고를 다시 받아도 revision이 늘지 않는다(FX-09)."

### S6 장애 대체 (로컬 Compose 녹화)

운영 회사 gateway는 멈추지 않는다.

1. 장애 주입: 터미널에서 `docker compose -f infra/compose.yaml stop ai-gateway`([[10-DEPLOYMENT|10]] 장애 주입 절).
2. **FX-01** → [재분석].
3. 보여야 하는 것: 새 `score_run` 상태 `PARTIAL`, "부분 완료 (규칙만)", 분석 요약 띠 "AI: mock · 응답 없음(규칙만)", `recommendationBasis=RULES_ONLY`, `reviewFlags`에 `AI_UNAVAILABLE`, 배너 "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)"([[09-SECURITY|09]] 고지 문구). 자격 체크리스트와 점수는 저장된 추출 결과로 그대로 계산되고, 결정 모델 패널은 "사용 불가", 설명은 템플릿 문장. 이전 `COMPLETED` run은 이력에 남는다.
4. 말할 것: "모델이 없어도 결과가 나오고, 없다는 사실을 숨기지 않는다. 결과를 덮어쓰지 않고 새 run을 만든다."
5. 복구: `docker compose -f infra/compose.yaml start ai-gateway` → `/health/ready`의 `checks.ai`가 `mock`으로 돌아왔는지 본다.

**엔드포인트 미접속 (`live`·`fixture`)**: 회사 GPU 추론 엔드포인트에 닿지 않으면 gateway는 살아 있고 모델 서버에만 닿지 않는다. 분석은 `QWEN_UNAVAILABLE`·`KEV_UNAVAILABLE`을 따로 기록하고(gateway가 꺼진 `AI_UNAVAILABLE`과 다르다), Qwen 불가면 캐시된 추출로(없으면 모든 필드 `UNKNOWN`) `PARTIAL`, 결정 모델 불가면 `RULES_ONLY`로 끝난다. mock 결과로 몰래 바꾸지 않는다. D1 질의응답 중에 일어나면 그 화면을 그대로 보이고 "모델 서버 연결이 끊겨도 규칙만으로 결과가 나오고 그 사실을 숨기지 않는다"고 말한다.

### S7 격리와 마무리

1. 터미널에서 `org-02`(viewer@other.invalid) access token을 받는다. 비밀번호는 환경 변수 `DEMO_SEED_PASSWORD`에서 읽고 명령에 직접 쓰지 않는다. Supabase URL·anon 키는 촬영 경로의 프로젝트 값이다.

   ```bash
   export ORG02_TOKEN=$(curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
     -d "{\"email\":\"viewer@other.invalid\",\"password\":\"$DEMO_SEED_PASSWORD\"}" | jq -r .access_token)
   ```

   access token에는 만료 시간이 있다(값은 Supabase Auth 설정, 미검증). 찍기 직전에 받는다.
2. 그 토큰으로 FX-01 자격 판정을 조회한다. `$BASE`는 D1이면 `https://www.solideos-radar.com`, 로컬이면 `http://localhost:3000`이다.

   ```bash
   curl -s -i -H "Authorization: Bearer $ORG02_TOKEN" \
     "$BASE/api/v1/bids/{FX-01 id}/qualification-checks"
   ```

3. 보여야 하는 것: `404 NOT_FOUND`, 본문 `{error:{code,message,details,requestId}}`. 서버가 토큰을 Supabase로 검증한 뒤 그 사용자 권한으로 조회하므로, RLS가 `org-01`의 자격 판정 행을 숨겨 404가 된다.
4. 대조: 같은 토큰으로 `GET $BASE/api/v1/bids/{FX-01 id}` → `200`. 공고는 공용 데이터이고, 회사 점수·판정·검토·인력은 조직 밖에서 보이지 않는다.
5. 마무리 슬라이드: 정직성 표([[18-HACKATHON|18]] §7)와 범위 외 항목.

### 녹화 전용: 카카오톡 추천 공고 수신 ([[16-DECISIONS|ADR-038]])

슬라이드 12의 카카오 10초다([[slides-spec|덱 제작 명세]] 부록 A). 실공고 추천은 실공고 분석이 있어야 나오므로 회사 반영 뒤 S-LIVE와 함께 찍는다([[16-DECISIONS|ADR-054]]). 지금 카카오 연결은 0건이다. 실수신은 녹화 뒤에만 "확인"으로 적는다.

1. 준비: 녹화할 계정이 운영 앱의 개인 설정 "카카오톡 알림"을 사용자 본인 카카오 계정과 연결하고 켠다([[06-UI-UX|06]] §5.10.1). 카카오 키는 사용자가 Vercel과 회사 Worker env에 넣고, 알림 Worker를 `NOTIFY_KAKAO_PROVIDER=memo`로 띄운다([[10-DEPLOYMENT|10 배포]] "카카오 앱 설정"). 값은 문서·로그에 적지 않는다. 회사 Worker는 수집·분석·첨부 전용(`infra/compose.*-only.company.yaml`)이고 알림·마감 등록은 `web/worker/main.ts`에만 있다. 운영에서 알림을 처리하는 Worker가 있는지는 미확인이라 녹화 전에 확인한다.
2. 실제 나라장터 공고 1건의 상세에서 [분석 실행]을 누른다. 추천 알림은 사람이 요청한 분석에서 BID·WATCH 권고가 처음 나온 공고에만 간다([[13-NOTIFICATIONS|13]]). NO-BID면 다른 실공고로 한다.
3. 휴대폰 카카오톡 "나와의 채팅"에 피드 한 통(제목 공고명, 설명 `<권고> 권고 · <사유 한 줄>`, 발주처·마감·추정금액·점수, 버튼 [분석 보기]·[공고 원문])이 오는 장면을 녹화한다. [분석 보기]는 운영 도메인을 가리킨다. 휴대폰에서 버튼이 열리는지는 녹화 때 확인하고, 안 열리면 수신까지만 보여 준다.
4. 말할 것: "실제 나라장터 공고를 우리 회사 기준으로 분석해 추천이 나오면, 알림을 켠 사람의 카카오톡으로 간다. 회사 프로필은 가상이다. 해커톤에서는 카카오 '나에게 보내기'로 보내고, 운영에서는 알림톡으로 바꾼다."
5. 같은 공고는 조직마다 처음 한 번만 보낸다. 실발송은 녹화에 필요한 만큼만 한다. 녹화가 끝나면 `NOTIFY_KAKAO_PROVIDER=mock`으로 되돌린다. 녹화 파일·발송 결과(받은 시각, 공고번호)는 `docs/evidence/`에 두고, 토큰·카카오 사용자 ID는 적지 않는다.

## 5. 장면별 실패 대응

촬영 중 실패는 다시 찍는다. 아래는 다시 찍어도 안 될 때와 질의응답 라이브 때의 대응이다.

| 장면 | 실패 양상 | 대응 |
|---|---|---|
| S3 가정 재계산 | 스위치가 없음(`NO_SNAPSHOT`·원래 값 불일치 안내) 또는 띠에 "가정 결과를 계산하지 못했습니다" | 7~9단계를 건너뛴다. 가정 결과를 말로 지어내지 않는다. 결정 패널·저장 결과는 가정과 무관하므로 그대로 진행한다 |
| S4 분석 | `RUNNING`(분석 중)에서 멈춤 | 미리 분석된 FX-01·FX-03으로 점수·자격 설명을 이어 간다. 멈춘 상태를 그대로 보인다 |
| S4 저장 | 결정 저장 실패 | 오류 코드와 `requestId`를 그대로 보여 주고 "오류를 숨기지 않는 설계"로 설명 |
| S5 수집 | 변경이 감지되지 않음 | 클립 6을 뺀다. Q&A에서 [[07-DATA-PIPELINE\|07]] 변경 감지 설계로 답 |
| S6 장애 | `PARTIAL`이 아니라 `FAILED` | `FAILED` 상태와 재시도 버튼을 보여 주고 "상태를 그대로 노출"로 설명 |
| S7 격리 | 자격 판정 조회에 `200`이 돌아옴 | **멈추고 사실대로 말한다.** 격리는 핵심 보안 주장이므로 리허설에서 반드시 확인 |
| S7 격리 | `401 UNAUTHENTICATED` | access token 만료. S7 1번 명령으로 토큰을 다시 받는다 |
| `live`·`fixture` 장면 | 회사 GPU 추론 엔드포인트 미접속 | §4 S6 엔드포인트 미접속 대응. D1은 모드를 바꾸지 않는다 |
| S-LIVE | live run이 없거나 `FAILED` | 녹화가 있으면 녹화로 대체하고 "녹화"라고 말한다. 없으면 장면을 빼고 Q&A에서 실패 사유를 말한다 |
| S-LIVE | run이 `PARTIAL`·`RULES_ONLY`(엔드포인트 미접속·추출 실패) | 그 화면을 그대로 보여 주고 "실제 공고에 규칙만 적용한 결과"라고 말한다 |
| 전 장면 (대체 경로 ①) | 인터넷 끊김으로 Supabase 접속 불가(로그인 실패, `/health/ready` `503`) | §3.2 로컬 경로로 전환한다: `pnpm db:start` → `pnpm demo:reset` → `pnpm demo:preanalyze` → web 재시작. 리허설에서 해 본 절차만 쓴다. 전환하면 "로컬 DB로 전환했다"고 말한다. 운영 live run은 로컬 DB에 없으므로 S-LIVE는 녹화로 |
| `live` 장면 (대체 경로 ②) | 공공 API 장애·일일 한도 초과(에러코드 22) | D1 S-LIVE는 저장된 run 조회라 영향 없다. 로컬 경로는 `fixture` 모드로 전환하고 관리자 수집 화면의 "공공 API 오류: {코드}"를 그대로 보여 준다 |
| S-LIVE (대체 경로 ③) | 회사 GPU 추론 엔드포인트 접속 실패 | 외부 의존성 컷 규칙의 "GPU 불가" 갈래(규칙만 `PARTIAL` 또는 녹화·증거만) |
| 전 장면 (대체 경로 ④) | Supabase 클라우드 장애(인터넷은 정상) | 대체 경로 ①과 같다 |
| S-LIVE (대체 경로 ⑤) | 첨부 다운로드·파싱 실패 | 배지 "첨부 원문 확인"·"첨부 원문 확인(내려받기 실패)"와 관련 자격 "확인 필요"를 그대로 보인다. 원문 링크를 열고, AI가 첨부 내용을 추측하지 않는다고 말한다 |
| S4·S6 (대체 경로 ⑥) | 추론 시간 초과(`AI_TIMEOUT_MS`·`KEV_TIMEOUT_MS`) | `PARTIAL`·`RULES_ONLY` 화면 그대로. 재시도는 한 번만 |

## 6. 리허설 체크리스트

D1 운영 경로:

- [ ] §3.1 D1 사전 준비 1~8을 한 번 끝까지 돈다. 운영에 `pnpm demo:reset`·`pnpm demo:preanalyze`를 돌리지 않는다
- [ ] 출처가 붙은 URL로 S2·S3·S4 화면을 1440·1280에서 확인한다. 사이드바로 이동하지 않는다(§4 대본 주의)
- [ ] DEMO 마감 이동 뒤 숫자(§3.1 4번)를 로그인 화면에서 확인한다
- [ ] FX-02를 재분석하지 않는다(§4 S4 주의). 실추론 소요 시간은 S-LIVE 실공고 분석 때 잰다
- [ ] S3 가정 재계산: `FX-03` 스위치 → 띠 NO-BID → WATCH·68 → 68이 1초 안에 보이고 가로 넘침이 없는지, 결정 패널이 NO-BID 68 그대로인지, 새로 고침 뒤 띠가 없는지, `bid_reviews` 건수가 그대로인지 본다. FX-03 run에 `input_snapshot`이 있어야 스위치가 보인다
- [ ] 1440px에서 상세 화면 상단 요약·자격·점수가 스크롤 없이 보이는지 본다
- [ ] 운영 데모 계정·`org-02` 계정이 있는지 확인한다. S7 `404`·`200` 응답을 `docs/evidence/`에 저장한다
- [ ] 클립 길이 합이 덱 시간표를 넘지 않는지 본다([[slides-spec|덱 제작 명세]] 부록 A.3)

로컬 Compose 경로:

- [ ] §3.2 1~6을 격리 로컬 Supabase로 끝까지 돈다. 운영 Supabase를 가리키지 않는지 먼저 본다
- [ ] S5 수집 결과·FX-07 diff·재분석 77, S6 `PARTIAL` 화면을 1440으로 찍고 `docs/evidence/`에 저장한다
- [ ] 08 worked example 값과 로컬 S4 화면 값(72, 요소 분해, 결정 모델 분포)이 같은지 본다
- [ ] 대체 경로 ①(로컬 전환) 소요 시간을 재고 [리허설 로그](evidence/demo-day/rehearsal-log.md)에 적는다

카카오(회사 반영 뒤):

- [ ] 카카오톡 실수신 녹화 1회(§4 "녹화 전용"). 끝나면 `NOTIFY_KAKAO_PROVIDER=mock`으로 되돌렸는지 확인

## 솔리데오 직원·사진 준비 체크 (ADR-019)

명부·카탈로그·사진·가입·200명/95.5 FTE 검사는 [[11-TESTING|11 테스트]] §8 PPL-01~07을 그대로 쓴다. `/people`에서 사진 200장이 누락 없이 보이는지는 `/people`이 확장 컷이라([[16-DECISIONS|ADR-021]]·ADR-023) 그 화면을 노출할 때의 리허설에서 본다.

원본 엑셀은 배포물·발표 화면에 넣지 않는다. 직원 명부·사진 저장 위치는 [[07-DATA-PIPELINE]]을 따른다.

## 관련 문서

- [[18-HACKATHON|18 해커톤 전략]]
- [[slides-spec|덱 제작 명세]] — 발표 시간표, 클립 정의(부록 A)
- [[07-DATA-PIPELINE|07 수집·fixture]]
- [[08-SCORING|08 SOL Score·계산 예시]]
- [[06-UI-UX|06 화면]]
- [[10-DEPLOYMENT|10 배포·프로필]]
- [[11-TESTING|11 테스트·수용 체크리스트]]
- [[09-SECURITY|09 보안·격리]]
- [[16-DECISIONS|16 ADR]] — ADR-020(실행 모드·실데이터), ADR-037(데모 강화 컷·S3 가정 재계산), ADR-038(카카오톡 추천 공고), ADR-054(제출·발표일, 발표 D1, 첨부 처리), ADR-055(범위 밖 첨부 `PENDING`), ADR-056(추출 캐시 키)
- [[13-NOTIFICATIONS|13 알림]] — 카카오톡 추천 공고(나에게 보내기)
- [[12-ROADMAP|12 로드맵]] — 남은 일정 제안, 외부 의존성 컷 규칙
- [[21-MODEL-TRAINING|21 모델 학습]] — 평가 비교 대상(E0~E4)
