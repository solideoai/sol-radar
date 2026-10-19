---
title: "19. 데모 시나리오: 데모 기업·fixture 스토리·클릭 경로"
doc: "19"
status: draft
tags:
  - sol-radar
  - hackathon
  - demo
updated: 2026-10-19
---

# 19. 데모 시나리오

발표 시간표는 [[18-HACKATHON|18 해커톤 전략]] §6에 있다. 이 문서는 조작자가 따라가는 **클릭 경로**, 데모에 쓰는 **가상 기업과 fixture**, 각 장면에서 **화면에 보여야 하는 것**을 정의한다. fixture 20건의 전체 명세는 [[07-DATA-PIPELINE|07 수집]] §6.2의 fixture 표(`FX-01`~`FX-20`)가 단일 원천이고, 데모 기업 프로필과 점수 계산 예시는 [[08-SCORING|08 SOL Score]]가 단일 원천이다. 이 문서와 충돌하면 07·08을 따르고 이 문서를 고친다.

> [!warning] 가상 데이터
> 회사명 "솔리데오"와 부서·직급 명칭은 사용자 회사 기준이다(ADR-019). 가상 직원 200명·사용자·사진·공고·실적·자격·재무·가용성은 데모 설정이며 실제 회사 현황/공고를 뜻하지 않는다. 모든 데모 fixture는 `isDemo=true`이며, 공고 fixture의 `sourceUrl`은 `https://demo.sol-radar.invalid/notices/FX-xx`다. 화면에 `DEMO` 배지가 붙는다. 발주기관 이름은 실제 기관명을 쓰지만 공고 내용은 지어낸 것이다. `live` 모드의 공고는 실제 나라장터 공고(`isDemo=false`)이지만, 회사 프로필은 모든 모드에서 가상 솔리데오이고 분석 화면에 "가상 회사 프로필로 분석" 배지가 붙는다([[16-DECISIONS|ADR-020]]).

## 1. 데모 테넌트와 계정 (seed)

| 테넌트 | ID | 내용 |
|---|---|---|
| 솔리데오 (고정 회사명의 가상 데모 프로필) | `org-01` | 프로필 revision 2. 상세는 [[08-SCORING\|08]]이 단일 원천. 데모에 영향을 주는 값: 소프트웨어사업자·직접생산확인·**중소기업확인서(중기업)** 보유(FX-01 중소기업 제한경쟁 충족), ISO 27001·CMMI L3 보유, **정보통신공사업 등록 없음, 방산업체 지정 없음**, ISMS-P·CSAP 미보유, 단일 사업 수행 상한 50억, 기술 스택 Java/Spring·Next.js·NestJS·PostgreSQL·Kubernetes(FX-07 정정 후 BID 전환에 필요), 선호 분야 데이터 플랫폼·AX·민원·**교육**(FX-02 72 성립에 필요), 전체 가상 명부 200명(남녀 100/100), 그 안의 점수 계산 하위 27명 중 2026-12~2027-06 가용 20 FTE, 실적 3건 완료일 2024-11 / 2024-03 / 2025-09(모두 증빙 있음) |
| 비교조직 | `org-02` | 사용자 1명(VIEWER), 프로필 revision 1, 리뷰 0건. 격리 시연(S7) 전용 |

| 역할 | 계정 | 데모에서 하는 일 |
|---|---|---|
| ADMIN | admin@soltech.invalid (`org-01`) | 수동 수집 실행(live 배치) |
| SALES | sales@soltech.invalid (`org-01`) | 공고 탐색, 최종 결정 기록. **주 발표 계정** |
| ANALYST | analyst@soltech.invalid (`org-01`) | 분석 요청 (S4에서 SALES 계정이 대신해도 됨) |
| VIEWER | viewer@soltech.invalid (`org-01`) | 읽기 전용 확인(데모 미사용, RBAC 테스트용) |
| VIEWER | viewer@other.invalid (`org-02`) | 격리 시연 |

위 5계정은 가상 직원 명부 200명과 별개이며 명부에서 Auth 계정을 자동 생성하지 않는다. `.invalid`의 `soltech`는 기존 데모 계정 별칭으로 실제 회사 이메일이 아니다. 사용 회사 선택 UI는 솔리데오 하나만 표시하고 비교 조직은 격리 시험에서만 쓴다.

계정은 Supabase Auth 사용자이고, 역할 열은 조직 구성원 표의 업무 역할 `memberships.sol_role` 값이다. admin@soltech.invalid는 조직 관리 권한도 가진다(`org_role=owner` + `sol_role=ADMIN`). 계정·조직·구성원은 `pnpm demo:reset`이 service role 키로 Supabase 프로젝트에 만든다([[16-DECISIONS|16 ADR]] ADR-017).

이메일 도메인은 예약 TLD `.invalid`(RFC 2606)라 실제로 전달되지 않는다. seed 합계: 조직 2, 사용자 5, 프로필 revision 2, 공고 19건 적재 + 1건 격리(FX-12), 사전 리뷰 2건(FX-01 BID, FX-03 NO-BID. FX-02는 S4에서 라이브로 기록). seed 로그 마지막 줄 `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true` ([[10-DEPLOYMENT|10]]).

비밀번호는 `.env.example`의 `DEMO_SEED_PASSWORD` placeholder로 두고 실제 값은 seed 시 입력한다. 문서와 저장소에 실제 값을 쓰지 않는다.

## 2. 장면별 fixture와 기대 결과

seed 배치는 `pnpm demo:reset` 때 revision 1로 적재되고, live 배치(FX-06 r2, FX-07 r2, FX-08 r2, FX-09 재전송, FX-10 02차, FX-20 429 시퀀스)는 S5에서 수동 수집으로 투입한다. 날짜는 seed 시 KST 18:00 기준 절대값으로 변환된다 ([[07-DATA-PIPELINE|07]]).

| 장면 | fixture | 단계 | 특수 케이스 | 기대 자격 | 기대 점수 | 기대 권고 | mock Kev (BID/WATCH/NO_BID) |
|---|---|---|---|---|---|---|---|
| S2 대시보드 | FX-14 광주광역시 AI 행정 비서 시범사업 | NOTICE | 마감 +2일 | — | — | WATCH | 규칙 선택지 0.60 |
| S2 대시보드 | FX-12 (제목 없음) 경상북도 | NOTICE | 필수 필드 누락 → 격리 | — | — | 목록 미노출, 관리자 오류 1건 | — |
| S3 자격·근거 | **FX-01 세종특별자치시 차세대 행정정보시스템 고도화** (12억, +21일) | NOTICE | 정상, RFP 파싱 성공 | 3건 `SATISFIED`, 근거 인용 있음 | 94 | BID | 0.71 / 0.24 / 0.05 (일치) |
| S3 규칙 우선 | **FX-03 부산광역시 지능형 CCTV 통합관제센터 구축** (45억, +15일) | NOTICE | 정보통신공사업 등록 필수 | `NOT_SATISFIED` 1건 | 68 (참고 표시) | NO-BID | 0.55 / 0.30 / 0.15 → `MODEL_RULE_DISAGREEMENT`, mandatoryRisk 0.85 |
| S4 라이브 분석·결정 | **FX-02 경기도교육청 통합 LMS 구축** (28억, +10일) | NOTICE | 요구기술 6개 중 3개 보유(Vue.js·SCORM·WebRTC 없음), 마감 촉박 | `SATISFIED` | 72 (15.0+18.3+14.0+15.0+10.0) | WATCH | 0.36 / 0.52 / 0.12 (일치), needsHumanReview 0.74 → `KEV_NEEDS_REVIEW` |
| **S-LIVE 실제 공고** | 실제 나라장터 정보화사업 공고 1건(`is_demo=false`, C8에서 선정, 공고번호는 `run-modes.md`에 기록) | NOTICE | `live` 모드 사전 실행 run. 실모델 결과라 값을 미리 정하지 않는다 | 규칙 판정 3값 + 사유 코드 | 실값 | 실값 | Kev-9B 실추론 `kev-qs/v0.2`, `UNCALIBRATED`. 엔드포인트 미접속이면 `PARTIAL`·`RULES_ONLY` 그대로 |
| S5 변경 감지(확장 컷, 2순위) | FX-07 한국도로공사 교통정보 데이터플랫폼 고도화 (18억 → r2 21.6억) | NOTICE 정정 | 예산 증액 + Kubernetes 추가 | 변동 없음 | 68 → 76 | WATCH → BID, 재분석 1회, 알림 1건 | — |
| S5 변경 감지 | FX-06 대전광역시 스마트시티 통합플랫폼 유지보수 (마감 +14일 → +28일) | NOTICE 정정 | 기한 변경 | 변동 없음 | 78 유지 | BID 유지, `BID_CHANGED` 1건 | — |
| S5 멱등 | FX-09 서울특별시 공공데이터 개방 플랫폼 운영 | NOTICE | 동일 payload 재전송 | — | — | revision 1 유지, 이벤트 0건 추가 | — |
| S6 장애 대체 | FX-01 재분석(`force=true`) + AI 장애 주입 플래그 | NOTICE | AI 추출 불가 | 규칙 기반 판정만 | 규칙 점수 | `PARTIAL` | 비활성 |
| S7 격리 | FX-01 자격 판정을 `org-02` access token으로 조회 | — | — | — | — | `404 NOT_FOUND`(RLS가 `org-01` 행을 숨김). 공고 자체 조회는 공용이라 `200` | — |
| Q&A 예비 | FX-04 NIA 데이터 거버넌스 컨설팅 (첨부 없음) | NOTICE | 자격 요건 본문에 없음 | `NEEDS_REVIEW`, 인용 0건 | — | WATCH | 0.60 WATCH |
| Q&A 예비 | FX-05 건보공단 대국민 포털 재구축 (HWP 손상) | NOTICE | 첨부 파싱 실패 | `NEEDS_REVIEW`, 추출 `PENDING_REVIEW` | — | WATCH, "첨부 원문 확인" 배지 | 0.60 WATCH |
| Q&A 예비 | FX-15 행정안전부 차세대 지방행정 공통기반 (80억) | NOTICE | 수행 상한 50억 초과 | `SATISFIED` | 58 | WATCH, `SCALE_LIMIT_EXCEEDED` | 0.60 WATCH |
| Q&A 예비 | FX-17 → FX-18 과기정통부 AI 행정서비스 (발주계획 → 사전규격) | PLAN → PRE_SPEC | 식별자 `DEMO-PLAN-0042`로 연결 | PLAN은 `NOT_APPLICABLE` | 82 (PRE_SPEC) | WATCH → BID, StageTimeline 2단계 | — |
| Q&A 예비 | FX-19 세종 행정정보 연계 플랫폼 사전규격 | PRE_SPEC | 식별자 없음, FX-01과 제목만 유사 | — | — | "연결 후보"만 표시, 자동 병합 없음 | — |

> [!tip] 심사 포인트
> 세 결과(BID / WATCH / NO-BID)가 모두 한 번씩 나온다. 핵심은 **FX-03**: mock Kev가 BID 0.55를 내도 정보통신공사업 미충족이 규칙에서 `NOT_SATISFIED`라 NO-BID로 고정되고 `MODEL_RULE_DISAGREEMENT`가 기록된다. 이 한 장면이 "정직한 AI"(D3)와 "규칙이 최종"(D5)을 동시에 보여 준다. 사람 결정 기록(D4)은 FX-02에서 보여 준다.

### 2.1 실행 모드 표시와 장애 대체 순서

실행 모드는 `SOL_RUN_MODE` 하나로 고른다([[16-DECISIONS|ADR-020]]). 위 표의 fixture 장면(S2·S3·S5·S6·S7)과 기본 S4는 그대로 쓴다.

| 모드 | 공고 | AI | 이 데모에서 쓰는 곳 |
|---|---|---|---|
| `mock` | fixture 20건 | 고정 응답(`AI_PROVIDER=mock`) | **기본 시연 모드.** S2~S7 전부. 위 표의 기대 수치(94·72·68, Kev 분포)는 mock 기준이며 골든과 같다 |
| `fixture` | fixture 20건 | 회사 GPU 추론 엔드포인트(HTTPS)의 Qwen3.5-9B·Kev-9B 실추론 | S0 기동 확인. 공공 API가 안 될 때의 대체 |
| `live` | 실제 나라장터 공고 | 회사 GPU 추론 엔드포인트(HTTPS)의 Qwen3.5-9B·Kev-9B 실추론 | S0 기동 확인. S-LIVE용 사전 run(§3 4번) |

- 화면 표시: 머리말 "실행 모드: mock", fixture 공고의 `DEMO` 배지, 상세의 분석 요약 띠 "분석 실행 모드: mock|fixture|live"와 "AI: mock" 또는 "AI: local · Qwen/Qwen3.5-9B · jaredpalmer/kev-9b@v1.0"(받은 모델 식별자 그대로, [[16-DECISIONS|ADR-029]] A6 D12), 모든 모드의 "가상 회사 프로필로 분석" 배지. 분석마다 그때의 모드가 기록되므로 모드를 바꿔도 지난 분석의 표시는 그대로다.
- `fixture`·`live` 모드의 실모델 결과는 mock과 다를 수 있다. S3 "규칙이 Kev를 이긴다"는 mock Kev의 v0.1 `recommendation`(FX-03 BID 0.55)에 기대므로 `mock` 모드에서만 보장된다.
- 장애 대체 순서는 `live` → `fixture` → `mock`이다. 모드 전환은 env(`SOL_RUN_MODE`)를 바꾸고 worker·ai-gateway를 재시작해서 한다. 자동으로 바뀌지 않고(`AI_FALLBACK_TO_MOCK` 기본 `false`, `live`에서는 켤 수 없다), 바꿨으면 청중에게 말한다.
- 회사 GPU 추론 엔드포인트([[16-DECISIONS|ADR-025]])에 닿지 않으면 `live`·`fixture` 분석은 `PARTIAL`·`RULES_ONLY`로 끝난다. 숨기지 않고 S6처럼 보여 준다(§4 S6 엔드포인트 미접속).
- S5의 "live 배치"는 fixture의 두 번째 배치(`batch:"live"`)이며 실행 모드 `live`와 다르다. 실행 모드 `live`에서 fixture 수집을 부르면 `409 RUN_MODE_MISMATCH`라 S5는 `fixture`·`mock` 모드에서만 된다.
- **S-LIVE는 발표 중 모드 전환 없이 한다**([[16-DECISIONS|ADR-023]]). S0에서 `live` 모드로 실공고 1건을 수집·파싱·분석해 둔 run을, `mock` 모드로 돌아온 앱에서 `/bids?origin=all`로 연다. 분석마다 `run_mode`·`ai_provider`·모델 이름이 저장되므로 분석 요약 띠는 "분석 실행 모드: live"와 "AI: local · Qwen/Qwen3.5-9B · jaredpalmer/kev-9b@v1.0"을 그대로 보인다(머리말은 "실행 모드: mock"). `pnpm demo:reset`은 `is_demo=true`만 지우므로 이 run은 남는다. 외부 의존성 컷 규칙([[12-ROADMAP|12 로드맵]]) 4갈래 중 어느 것으로 시연하는지 §3 `run-modes.md`에 적고 발표에서 말한다. 녹화·fixture 결과를 live라고 말하지 않는다.

**live 공고가 데모 DB에 남는 경우** (2026-10-16)
- `live` 모드로 수집한 실제 공고(`is_demo=false`)는 같은 DB에 남는다. `pnpm demo:reset`은 fixture 공고·데모 계정·프로필·사전 리뷰만 처음 상태로 되돌리고 live 공고와 그 분석은 지우지 않는다(실데이터를 시연 준비 때문에 잃지 않게 하려는 것).
- 목록·대시보드의 기본 출처 필터는 실행 모드를 따른다: `fixture`·`mock` 모드면 `origin=demo`, `live` 모드면 `origin=live`. 그래서 S2 대시보드 수치(BID 권고 3건)와 목록 최상단(FX-01 94)은 fixture·mock 모드에서 live 공고와 섞이지 않고, live 모드 목록에는 fixture 공고가 기본으로 나오지 않는다([[05-API-SPEC|05 API]] §3).

## 3. S0 사전 준비 (발표 60분 전)

장면 번호 규약: 데모 장면은 `S0`(준비)~`S7`, 테스트 골든 시나리오는 `G1`~`G10`([[11-TESTING|11]]). 둘을 섞어 쓰지 않는다. [[21-MODEL-TRAINING|21 모델 학습]]의 평가 비교 대상은 `E0`~`E4`로 부르고 데모 장면 번호와 섞지 않는다.

> [!success] 네트워크 의존과 대체 경로 (결정됨 2026-10-19, [[16-DECISIONS|ADR-023]])
> DB와 인증이 Supabase 클라우드 프로젝트라 기본 시연은 인터넷이 필요하다. 끊기면 로그인과 조회가 멈추고 `/health/ready`가 `503`을 낸다. 대체 경로는 §5 표의 6종이다(인터넷 → 로컬 Supabase CLI, 공공 API → `fixture`, GPU → `mock` 또는 사전 run, Supabase → 로컬 CLI, 첨부 → 실패 화면 그대로, 시간 초과 → `PARTIAL`). 자동 fallback은 없고 사람이 전환하며, 전환하면 화면의 실행 모드·출처 표시와 발표에서 밝힌다. 로컬 CLI 전환은 최종 리허설(10-24, [[12-ROADMAP|12 로드맵]]) 항목이다(§6).

1. 인터넷 연결과 Supabase 프로젝트를 확인한다. 환경 변수에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`(서버 전용 비밀, worker·seed만 쓴다)가 들어 있고, Supabase 대시보드에서 프로젝트에 접속되는지 본다. SOL RADAR 마이그레이션은 미리 적용돼 있어야 한다(`pnpm db:push`는 운영 DB를 바꾸므로 사용자 확인 뒤에만 실행한다). env는 `SOL_RUN_MODE=mock`, `AI_FALLBACK_TO_MOCK=false`로 시작한다. `live`·`fixture`를 확인하려면 나라장터 서비스키 4개(`G2B_*_SERVICE_KEY`, 서버 전용, 값은 출력하지 않는다)가 모두 들어 있고 `pnpm check:env`가 모드 모순 없이 통과하는지, 회사 GPU 추론 엔드포인트에 접속되는지(`GET /v1/models`, 방식은 [[10-DEPLOYMENT|10 배포]]) 본다.
2. `docker compose -f infra/compose.yaml up -d --build`로 redis·minio·qdrant·ai-gateway·worker를 띄운다. DB 컨테이너는 없다(DB는 Supabase). web도 Compose 서비스가 아니라 호스트에서 `pnpm -C web start`로 띄운다([[10-DEPLOYMENT|10 배포]] 기동 절차 5). `curl -s http://localhost:3000/health/ready`가 `{status:"ok", checks:{db,redis,storage,ai:"mock"}}`인지 확인한다. `checks.db`는 Supabase(Postgres) 연결이다. 전체 기동 절차는 [[10-DEPLOYMENT|10 배포]].
3. `pnpm demo:reset`으로 seed를 적용한다(Compose 서비스가 아니라 스크립트. service role 키로 Supabase 프로젝트에 조직·계정·구성원·프로필·fixture를 적재, 멱등). 출력 마지막 줄(§1)과 `--write-summary <경로>` JSON의 `ingestRun.summary`(SEED 배치, `ingest_runs` 행과 같다)가 `{created:19, changed:0, cancelled:0, skippedDuplicate:0, quarantined:1, retried:2}`인지 확인한다 (격리 = FX-12 제목 누락, 재시도 2 = FX-20의 429 두 번). `/admin/ingestion` 화면(확장 컷)이 있으면 같은 값을 거기서도 본다.
4. **세 모드 확인**: `SOL_RUN_MODE`를 `live` → `fixture` → `mock` 순서로 바꾸며 worker·ai-gateway를 재시작한다. 모드마다 기동 거부가 없는지, 머리말 "실행 모드"와 `GET /api/v1/admin/ai/status`(admin@soltech.invalid)의 `runMode`가 맞는지, `live`·`fixture`에서는 `qwen.healthy`·`kev.registryMatch`가 `true`인지 본다. `live`에서는 `/admin/sources`의 오늘 호출량(`quotaUsedToday`/`quotaLimit`, 개발계정 서비스당 1,000건/일)을 확인한다. 실패한 모드는 시연에서 빼고 기록한다. **`live`에 있는 동안 S-LIVE용 실공고 1건의 수집·파싱·분석(C8)을 실행하고 공고번호·`score_runs` id·상태(`COMPLETED`/`PARTIAL`)·외부 의존성 컷 규칙의 갈래를 `run-modes.md`에 적는다.** 마지막은 `mock`으로 두고 2의 `/health/ready`(`checks.ai:"mock"`)를 다시 확인한다. 결과는 `docs/evidence/demo-day/<일시>/run-modes.md`에 남긴다([[11-TESTING|11 테스트]] §5).
5. `mock` 모드에서 **FX-02를 뺀 적재 공고 18건을 전부 미리 분석**해 둔다(FX-12는 격리라 공고가 없다). S2 대시보드의 BID 권고 3건(FX-01·FX-18·FX-06), 목록 상단 순서(94·82·78), 분석 현황 카드 "완료 18", [[14-OBSERVABILITY|14 관측성]] 지표 #2·#3이 이 사전 분석 건수에 기댄다. **FX-02는 분석 없음(`latestAnalysis=null`, 화면 `미분석`)으로 남겨** S4에서 라이브 분석한다. FX-06·FX-07의 r1 분석도 이때 들어가고 S5에서 r2 재분석이 보인다. 사전 분석은 별도 명령 `pnpm demo:preanalyze`가 한다(대상 18건, `mock` 모드·gateway 필수, 18건 모두 `COMPLETED`, 순서는 Compose → `pnpm demo:reset` → 모드 확인 → `pnpm demo:preanalyze` → S2, [[10-DEPLOYMENT|10 배포]] 기동 절차 6번, [[16-DECISIONS|ADR-030]] B22). 실행은 사용자 확인 뒤다.
6. 창 A(브라우저): `http://localhost:3000/auth/login` 화면에서 sales@soltech.invalid로 로그인한다(Supabase Auth). 창 B(터미널): viewer@other.invalid(`org-02`)의 Supabase access token을 받아 둔다. 비밀번호는 환경 변수 `DEMO_SEED_PASSWORD`에서 읽고 명령에 직접 쓰지 않는다.

   ```bash
   export ORG02_TOKEN=$(curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
     -d "{\"email\":\"viewer@other.invalid\",\"password\":\"$DEMO_SEED_PASSWORD\"}" | jq -r .access_token)
   ```

   access token에는 만료 시간이 있다(값은 Supabase Auth 설정, 미검증). 60분 전에 받은 토큰이 S7 전에 만료될 수 있으니 발표 직전에 한 번 더 받는다. 응답 형식은 리허설에서 확인한다.
7. 머리말에 "실행 모드: mock", 화면 우상단 모드 표시가 `AI: mock`인지 확인한다.
8. 백업 영상(3분)이 로컬에서 열리는지 확인한다.

## 4. 클릭 경로

각 단계는 [[18-HACKATHON|18]] §6의 시각과 맞춘다. "보여야 하는 것"이 보이지 않으면 그 장면은 건너뛰고 다음으로 간다. 거짓으로 설명하지 않는다.

### S1 문제 (0:00) — 슬라이드

조작 없음.

### S2 대시보드 (0:30)

1. 창 A `/dashboard`.
2. 보여야 하는 것: 머리말 "실행 모드: mock", `DEMO` 배지, `AI: mock` 표시, "마지막 수집" 시각, 카드 5개: BID 권고, 검토 대기, **마감 임박 7일(FX-14 포함)**, 수집(격리 1건 FX-12), 분석 현황(완료 18 · 부분 0 · 실패 0, §3 5번 사전 분석 기준. S6 뒤에는 완료 17 · 부분 1). 최근 변경 목록. 관리자 요약에 "격리 1건(FX-12, 제목 누락)". 이 기대값은 Phase 3에서 [[11-TESTING|11 테스트]] 체크리스트에도 적는다([[16-DECISIONS|ADR-021]]).
3. 말할 것: 지금 모드가 `mock`(가상 공고 + 고정 AI 응답)이고 회사 프로필도 가상 솔리데오라는 것을 먼저 밝힌다. "깨진 데이터는 숨기지 않고 격리한다."
4. (선택, 시간이 남을 때 15초) 사이드바 → 조직·인력: 200명 조직도와 "점수 계산 대상" 27명 배지. 말할 것: "사진과 사람은 모두 가상이고, 점수 계산에는 이 27명만 쓴다." 기존 시각표는 바꾸지 않는다([[16-DECISIONS|ADR-021]]).

### S3 자격 판정과 규칙 우선 (1:00~2:15)

1. `/bids`에서 필터: 단계 `입찰공고`, 정렬 `점수 내림차순`. 상단에 FX-01(94, BID), FX-18(82), FX-06(78) 순으로 보인다.
2. **FX-01** 클릭 → `/bids/[id]`. 상단: 세종특별자치시, 12억, D-21, 단계 타임라인, 원문 링크, `revision 1`, 상태 `COMPLETED`. 분석 패널에 "AI: mock"과 "가상 회사 프로필로 분석" 배지.
3. 자격 체크리스트 3건 모두 `SATISFIED`. 한 건의 근거 열기 → `EvidenceDrawer`: RFP 인용 구절·페이지·문자 위치. 말할 것: "AI가 만든 인용이 아니라 원문과 대조된 인용. 대조에 실패하면 무효."
4. 뒤로 → 필터에서 결정 `NO-BID` 선택 → **FX-03** 클릭.
5. 자격 체크리스트: 정보통신공사업 등록 `NOT_SATISFIED`(사유: 프로필에 등록 없음). 권고 `NO-BID`. Kev 패널: `모델 선택지 신뢰 분포 (충족·수주 확률 아님)` 문구, BID 0.55 / WATCH 0.30 / NO_BID 0.15, 배지 `MODEL_RULE_DISAGREEMENT`.
6. 말할 것: "모델이 BID라고 해도 필수 자격 미충족은 규칙이 이긴다. 모델 분포는 수주확률이 아니다."

### S4 라이브 분석과 사람 결정 (2:15~3:30)

1. 목록에서 **FX-02** 클릭. 상태 `미분석`(분석 없음).
2. "분석 요청" 클릭 → `QUEUED → RUNNING → COMPLETED`(화면 `대기 중 → 분석 중 → 완료`) 전이가 10초 안에 보인다(mock). 응답은 `202` + `pollUrl`.
3. 점수 게이지 72와 5개 요소 분해(값은 [[08-SCORING|08]] worked example B와 동일해야 한다). `missingFactors`가 있으면 표시된다.
4. Kev 패널: BID 0.36 / WATCH 0.52 / NO_BID 0.12, 규칙 권고 WATCH와 일치. 말할 것: "점수 50~75 구간은 사람 검토."
5. 결정 패널: 결정 `WATCH`, 사유 "요구기술 3개(Vue.js·SCORM·WebRTC) 미보유, 협력사 확보 후 재검토", 담당자에 발표자 자신(sales@soltech.invalid) 지정 → 저장. `REVIEW_ASSIGNED`는 담당자에게만 가므로 발표자를 담당자로 둔다.
6. 보여야 하는 것: 결정 이력 1건(결정자·시각·사유), 알림 벨에 `REVIEW_ASSIGNED` 포함. 분석 요청자에게 가는 `ANALYSIS_COMPLETE`도 올 수 있어 벨은 1~2건이다([[16-DECISIONS|ADR-029]] A6 D5).

### S-LIVE 실제 공고 (3:30~4:15, ADR-023)

1. `/bids` 필터 출처 `all`(또는 `?origin=all`). 실제 공고 1건(`DEMO` 배지 없음, 출처 `g2b-bid-notice`)을 연다. 공고번호는 S0 4번의 `run-modes.md`와 같아야 한다.
2. 보여야 하는 것: 상단 요약에 실제 발주기관·예산·마감·원문 링크(실제 나라장터 URL), "가상 회사 프로필로 분석" 배지. 분석 요약 띠에 "분석 실행 모드: live", "AI: local · Qwen/Qwen3.5-9B · jaredpalmer/kev-9b@v1.0", 분석 시각(머리말은 "실행 모드: mock" 그대로). 자격 체크리스트는 3값 + 사유 코드(`NEEDS_REVIEW`가 많아도 그대로), 점수 분해 5행, Kev 참고 지표(`UNCALIBRATED`, 고지 문구), 근거 서랍에 실제 첨부 인용(페이지·문자 위치). 첨부를 못 읽었으면 `DOCUMENT_DOWNLOAD_FAILED`·`PARSE_UNSUPPORTED` 배지를 그대로 보인다.
3. 말할 것: "지금까지는 가상 공고였다. 이 건은 실제 공고를 회사가 제공한 GPU 추론 엔드포인트에서 추론한 결과다. 머리말은 mock이지만 이 분석은 live 모드에서 돌린 것이고 화면이 그 사실을 기록한다. 회사 프로필은 가상이다." 외부 의존성 컷 규칙으로 규칙만 `PARTIAL`이거나 fixture 실추론이거나 녹화면 그 말을 그대로 한다.
4. 보이지 않으면: 녹화 영상(같은 입력·실행 로그 기반)으로 대체하고 "녹화"라고 말한다. 실시간 추론으로 포장하지 않는다.

### S5 변경 감지와 멱등 (확장 컷·2순위, [[16-DECISIONS|ADR-023]]. 구현되고 시간이 남을 때만 S-LIVE 앞에 30초)

1. admin@soltech.invalid로 전환(또는 미리 로그인한 탭) → `/admin/ingestion` → "수동 수집 실행", 배치 `live`. 이 배치는 fixture의 두 번째 배치이며 실행 모드 `live`가 아니다(§2.1).
2. 보여야 하는 것: 수집 결과 `{created:0, changed:3, cancelled:1, skippedDuplicate:1, quarantined:0, retried:0}` = 변경 3(FX-06, FX-07, FX-10), 취소 1(FX-08), 중복 skip 1(FX-09).
3. **FX-07** → `/bids/[id]/revisions`: 예산 18억 → 21.6억, 요구기술에 Kubernetes 추가가 diff로 하이라이트. 재분석 결과 68 → 76, 권고 WATCH → BID.
4. 알림 벨: `BID_CHANGED`가 FX-06, FX-07, FX-10에 각 1건, FX-09는 0건. 말할 것: "같은 수집을 다시 돌려도 알림이 늘지 않는다."

### S6 장애 대체 (4:15~4:45)

1. 장애 주입: 터미널에서 `docker compose -f infra/compose.yaml stop ai-gateway` ([[10-DEPLOYMENT|10]] 장애 주입 절). 우상단 표시가 `AI: unavailable`로 바뀐다.
2. **FX-01** → "재분석(force)".
3. 보여야 하는 것: 새 `score_run` 상태 `PARTIAL`, `recommendationBasis=RULES_ONLY`, `reviewFlags`에 `AI_UNAVAILABLE`, 배너 "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)"([[09-SECURITY|09]] 고지 문구). 자격 체크리스트와 점수는 extract job이 저장해 둔 추출 결과로 그대로 계산되고, Kev 패널은 "사용 불가", 설명은 템플릿 문장. 이전 `COMPLETED` run은 이력에 남아 있다.
4. 말할 것: "모델이 없어도 결과가 나오고, 없다는 사실을 숨기지 않는다. 결과를 덮어쓰지 않고 새 run을 만든다."
5. 복구(Q&A 전): `docker compose -f infra/compose.yaml start ai-gateway` → `AI: mock` 복귀 확인.

**엔드포인트 미접속 (`live`·`fixture` 모드에서)**: 회사 GPU 추론 엔드포인트에 닿지 않으면 gateway는 살아 있고 모델 서버에만 닿지 않는다. 분석은 `QWEN_UNAVAILABLE`·`KEV_UNAVAILABLE`을 따로 기록하고(gateway가 꺼진 위의 `AI_UNAVAILABLE`과 다르다), Qwen 불가면 캐시된 추출로(없으면 모든 필드 `UNKNOWN`) `PARTIAL`, Kev 불가면 `RULES_ONLY`로 끝난다. Qwen까지 불가면 화면은 위 3과 같은 PARTIAL 배너이고 Kev 패널은 "사용 불가"다. mock 결과로 몰래 바꾸지 않는다. 시연 중에 일어나면 그 화면을 그대로 보여 주고 "모델 서버 연결이 끊겨도 규칙만으로 결과가 나오고 그 사실을 숨기지 않는다"고 말한다. 재접속 확인(`GET /v1/models`)을 한 번 시도하고, 안 되면 `mock` 모드로 전환하고 바꿨다고 말한다. 데모에서 일부러 넣는 장애는 지금처럼 ai-gateway 중지 하나다([[10-DEPLOYMENT|10]] 장애 주입 절).

### S7 격리와 마무리 (4:45~5:00)

1. 창 B 터미널에서 S0에서 받은 `org-02`(viewer@other.invalid) access token으로 FX-01 자격 판정을 조회한다. API는 web이 함께 제공한다(`http://localhost:3000/api/v1/...`).

   ```bash
   curl -s -i -H "Authorization: Bearer $ORG02_TOKEN" \
     "http://localhost:3000/api/v1/bids/{FX-01 id}/qualification-checks"
   ```

2. 보여야 하는 것: `404 NOT_FOUND`, 본문 `{error:{code,message,details,requestId}}`. 서버가 토큰을 Supabase로 검증한 뒤 그 사용자 권한으로 조회하므로, RLS가 `org-01`의 자격 판정 행을 숨겨 404가 된다.
3. 대조: 같은 토큰으로 `GET http://localhost:3000/api/v1/bids/{FX-01 id}` → `200`. 공고는 공용 데이터이고, 회사 점수·판정·검토·인력은 조직 밖에서 보이지 않는다.
4. 마무리 슬라이드: 정직성 표([[18-HACKATHON|18]] §7)와 범위 외 항목.

## 5. 장면별 실패 대응

| 장면 | 실패 양상 | 대응 |
|---|---|---|
| S4 분석 | `RUNNING`(분석 중)에서 멈춤 | 미리 분석된 FX-01·FX-03으로 점수·자격 설명을 이어 간다. 라이브 분석은 S6 재분석에서 다시 시도 |
| S4 저장 | 결정 저장 실패 | 오류 코드와 `requestId`를 그대로 보여 주고 "오류를 숨기지 않는 설계"로 설명. 백업 영상 해당 구간 |
| S5 수집 | 변경이 감지되지 않음 | 생략하고 S6으로. Q&A에서 [[07-DATA-PIPELINE\|07]] 변경 감지 설계로 답 |
| S6 장애 | `PARTIAL`이 아니라 `FAILED` | `FAILED` 상태와 재시도 버튼을 보여 주고 "상태를 그대로 노출"로 설명 |
| S7 격리 | 자격 판정 조회에 `200`이 돌아옴 | **데모를 멈추고 사실대로 말한다.** 격리는 핵심 보안 주장이므로 리허설에서 반드시 확인 |
| S0 세 모드 | 한 모드가 기동 거부하거나 `kev.registryMatch: false` | 거부 메시지의 모순 키·레지스트리 항목을 고친다. 안 되면 그 모드를 시연에서 빼고 `run-modes.md`에 기록 |
| `live`·`fixture` 장면 | 회사 GPU 추론 엔드포인트 미접속 | §4 S6 엔드포인트 미접속 대응. 재접속 확인 1회, 안 되면 `mock` 전환을 말하고 진행 |
| `live` 장면 | 공공 API 오류·일일 한도 초과(에러코드 22) | `fixture` 모드로 전환. 관리자 수집 화면의 "공공 API 오류: {코드}"를 그대로 보여 준다 |
| `live` 장면 | 첨부 다운로드 실패 | `DOCUMENT_DOWNLOAD_FAILED`와 관련 자격 `확인 필요`를 그대로 보여 주고, 읽지 못한 첨부 내용을 AI가 추측하지 않는다고 설명한다 |
| S7 격리 | `401 UNAUTHENTICATED` | access token 만료. S0 6의 명령으로 토큰을 다시 받아 호출한다 |
| S-LIVE | live run이 없거나 `FAILED` | 녹화 영상으로 대체하고 "녹화"라고 말한다. 녹화도 없으면 장면을 빼고 §3 `run-modes.md`의 실패 사유를 Q&A에서 말한다 |
| S-LIVE | run이 `PARTIAL`·`RULES_ONLY`(엔드포인트 미접속·추출 실패) | 그 화면을 그대로 보여 주고 "실제 공고에 규칙만 적용한 결과"라고 말한다 |
| 전 장면 (대체 경로 ①) | 인터넷 끊김으로 Supabase 접속 불가(로그인 실패, `/health/ready` `503`) | 로컬 Supabase CLI로 전환: `pnpm db:start` → `pnpm demo:reset` → web 재시작. 최종 리허설(10-24)에서 해 본 절차만 쓴다. 전환하면 "로컬 DB로 전환했다"고 말한다. live run은 로컬 DB에 없으므로 S-LIVE는 녹화로 |
| `live` 장면 (대체 경로 ②) | 공공 API 장애·일일 한도 초과 | `fixture` 모드로 전환. 위 "`live` 장면" 행과 같다 |
| S-LIVE (대체 경로 ③) | 회사 GPU 추론 엔드포인트 접속 실패 | S0에서 실패했으면 외부 의존성 컷 규칙의 "GPU 불가" 갈래(규칙만 `PARTIAL` 또는 녹화·증거만). 발표 중 실패는 사전 run 조회라 영향 없음 |
| 전 장면 (대체 경로 ④) | Supabase 클라우드 장애(인터넷은 정상) | 대체 경로 ①과 같다 |
| S-LIVE (대체 경로 ⑤) | 첨부 다운로드·파싱 실패 | `DOCUMENT_DOWNLOAD_FAILED`·`PARSE_UNSUPPORTED` 배지를 그대로 보여 주고 읽지 못한 내용을 AI가 추측하지 않는다고 말한다 |
| S4·S6 (대체 경로 ⑥) | 추론 시간 초과(`AI_TIMEOUT_MS`·`KEV_TIMEOUT_MS`) | `PARTIAL`·`RULES_ONLY` 화면 그대로. 재시도는 한 번만 |

## 6. 리허설 체크리스트

- [ ] 발표 회장 회선에서 Supabase 프로젝트 접속, `/auth/login` 로그인, `org-02` access token 발급 확인
- [ ] seed 재적용 포함 전체 경로 2회 연속 통과
- [ ] 각 장면 소요 시간 기록, 합계 5분 이내
- [ ] S7 `404` 응답 캡처, S3 `MODEL_RULE_DISAGREEMENT` 화면, S6 `PARTIAL` 화면을 `docs/evidence/`에 저장
- [ ] 백업 영상 3분 녹화 (S2~S7)
- [ ] 1440px에서 상세 화면 상단 요약·자격·점수가 스크롤 없이 보이는지 확인
- [ ] 머리말 "실행 모드: mock"과 `AI: mock` 표시가 모든 화면에, "가상 회사 프로필로 분석" 배지가 분석 화면에 보이는지 확인
- [ ] 세 모드(`live`·`fixture`·`mock`) 기동 각 1회, 머리말·`runMode` 일치, 마지막은 `mock`
- [ ] 회사 GPU 추론 엔드포인트 미접속 → `PARTIAL`·`RULES_ONLY` → 재접속 확인(`GET /v1/models`), 소요 시간을 `rehearsal-log.md`에 기록. 끝나면 `pnpm demo:reset`
- [ ] live 리허설 호출 수가 공공 API 일일 한도(개발계정 서비스당 1,000건/일) 안인지 확인
- [ ] 08 worked example 값과 S4 화면 값(72, 요소 분해, Kev 분포) 일치 확인
- [ ] S-LIVE: `live` run 1건이 `mock` 모드 앱에서 `origin=all`로 열리고 분석 요약 띠에 "분석 실행 모드: live"·모델 식별자가 보이는지, `pnpm demo:reset` 뒤에도 남는지 확인. 녹화 영상(같은 입력·실행 로그)을 따로 준비
- [ ] 대체 경로 ①: 로컬 Supabase CLI 전환(`pnpm db:start` → `pnpm demo:reset` → web 재시작) 소요 시간 실측, `rehearsal-log.md`에 기록

## 솔리데오 직원·사진 준비 체크 (ADR-019)

명부·카탈로그·사진·가입·27명/20 FTE 검사는 [[11-TESTING|11 테스트]] §8 PPL-01~07을 그대로 쓴다. `/people`에서 사진 200장이 누락 없이 보이는지는 `/people`이 확장 컷이라([[16-DECISIONS|ADR-021]]·ADR-023) 그 화면을 노출할 때의 리허설에서 본다.

원본 엑셀은 배포물·발표 화면에 넣지 않는다. 직원 명부·사진 저장 위치는 [[07-DATA-PIPELINE]]을 따른다.

## 관련 문서

- [[18-HACKATHON|18 해커톤 전략]]
- [[07-DATA-PIPELINE|07 수집·fixture]]
- [[08-SCORING|08 SOL Score·계산 예시]]
- [[06-UI-UX|06 화면]]
- [[10-DEPLOYMENT|10 배포·프로필]]
- [[11-TESTING|11 테스트·수용 체크리스트]]
- [[09-SECURITY|09 보안·격리]]
- [[16-DECISIONS|16 ADR]] — ADR-020(실행 모드·실데이터)
- [[12-ROADMAP|12 로드맵]] — 해커톤 컷, freeze~D-day 리허설
- [[21-MODEL-TRAINING|21 모델 학습]] — 평가 비교 대상(E0~E4)
