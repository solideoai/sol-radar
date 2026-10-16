---
title: "19. 데모 시나리오: 데모 기업·fixture 스토리·클릭 경로"
doc: "19"
status: draft
tags:
  - sol-radar
  - hackathon
  - demo
updated: 2026-10-16
---

# 19. 데모 시나리오

발표 시간표는 [[18-HACKATHON|18 해커톤 전략]] §6에 있다. 이 문서는 조작자가 따라가는 **클릭 경로**, 데모에 쓰는 **가상 기업과 fixture**, 각 장면에서 **화면에 보여야 하는 것**을 정의한다. fixture 20건의 전체 명세는 [[07-DATA-PIPELINE|07 수집]] §6.2의 fixture 표(`FX-01`~`FX-20`)가 단일 원천이고, 데모 기업 프로필과 점수 계산 예시는 [[08-SCORING|08 SOL Score]]가 단일 원천이다. 이 문서와 충돌하면 07·08을 따르고 이 문서를 고친다.

> [!warning] 가상 데이터
> 데모 기업 "SOL테크", 사용자, 공고, 실적은 모두 가상이다. 실제 기업·실제 공고가 아니며 모든 fixture는 `isDemo=true`, `sourceUrl`은 `https://demo.sol-radar.invalid/notices/FX-xx`다. 화면에 `DEMO` 배지가 붙는다. 발주기관 이름은 실제 기관명을 쓰지만 공고 내용은 지어낸 것이다.

## 1. 데모 테넌트와 계정 (seed)

| 테넌트 | ID | 내용 |
|---|---|---|
| SOL테크 (가상 공공 SI 중견) | `org-01` | 프로필 revision 2. 상세는 [[08-SCORING\|08]]이 단일 원천. 데모에 영향을 주는 값: 소프트웨어사업자·직접생산확인·**중소기업확인서(중기업)** 보유(FX-01 중소기업 제한경쟁 충족), ISO 27001·CMMI L3 보유, **정보통신공사업 등록 없음, 방산업체 지정 없음**, ISMS-P·CSAP 미보유, 단일 사업 수행 상한 50억, 기술 스택 Java/Spring·Next.js·NestJS·PostgreSQL·Kubernetes(FX-07 정정 후 BID 전환에 필요), 선호 분야 데이터 플랫폼·AX·민원·**교육**(FX-02 72 성립에 필요), 인력 27명 중 2026-12~2027-06 가용 20 FTE, 실적 3건 완료일 2024-11 / 2024-03 / 2025-09(모두 증빙 있음) |
| 비교조직 | `org-02` | 사용자 1명(VIEWER), 프로필 revision 1, 리뷰 0건. 격리 시연(S7) 전용 |

| 역할 | 계정 | 데모에서 하는 일 |
|---|---|---|
| ADMIN | admin@soltech.invalid (`org-01`) | 수동 수집 실행(live 배치) |
| SALES | sales@soltech.invalid (`org-01`) | 공고 탐색, 최종 결정 기록. **주 발표 계정** |
| ANALYST | analyst@soltech.invalid (`org-01`) | 분석 요청 (S4에서 SALES 계정이 대신해도 됨) |
| VIEWER | viewer@soltech.invalid (`org-01`) | 읽기 전용 확인(데모 미사용, RBAC 테스트용) |
| VIEWER | viewer@other.invalid (`org-02`) | 격리 시연 |

계정은 Supabase Auth 사용자이고, 역할 열은 조직 구성원 표의 업무 역할 `memberships.sol_role` 값이다. admin@soltech.invalid는 조직 관리 권한도 가진다(`org_role=owner` + `sol_role=ADMIN`). 계정·조직·구성원은 `pnpm demo:reset`이 service role 키로 Supabase 프로젝트에 만든다([[16-DECISIONS|16 ADR]] ADR-017).

이메일 도메인은 예약 TLD `.invalid`(RFC 2606)라 실제로 전달되지 않는다. seed 합계: 조직 2, 사용자 5, 프로필 revision 2, 공고 19건 적재 + 1건 격리(FX-12), 사전 리뷰 2건(FX-01 BID, FX-03 NO-BID. FX-02는 S4에서 라이브로 기록). seed 로그 마지막 줄 `seed: orgs=2 users=5 profileRevisions=2 bids=19 quarantined=1 reviews=2 isDemo=true` ([[10-DEPLOYMENT|10]]).

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
| S5 변경 감지 | FX-07 한국도로공사 교통정보 데이터플랫폼 고도화 (18억 → r2 21.6억) | NOTICE 정정 | 예산 증액 + Kubernetes 추가 | 변동 없음 | 68 → 76 | WATCH → BID, 재분석 1회, 알림 1건 | — |
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

## 3. S0 사전 준비 (발표 60분 전)

장면 번호 규약: 데모 장면은 `S0`(준비)~`S7`, 테스트 골든 시나리오는 `G1`~`G10`([[11-TESTING|11]]). 둘을 섞어 쓰지 않는다.

> [!warning] 네트워크 의존 (대체 경로 미결정)
> DB와 인증이 Supabase 클라우드 프로젝트(개발 환경)라 데모 내내 인터넷 연결이 필요하다. 끊기면 로그인과 조회가 멈추고 `/health/ready`가 `503`(`status:"unavailable"`)을 낸다. 네트워크 없이 시연하는 경로는 아직 없다. 대체 경로(사전 녹화 영상 재생, 로컬 Supabase CLI `pnpm db:start`로 전환)는 미결정이다([[16-DECISIONS|16 ADR]] 미결정 표). 정해지기 전까지 회선이 끊기면 사실대로 말한다.

1. 인터넷 연결과 Supabase 프로젝트를 확인한다. 환경 변수에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`(서버 전용 비밀, worker·seed만 쓴다)가 들어 있고, Supabase 대시보드에서 프로젝트에 접속되는지 본다. SOL RADAR 마이그레이션은 미리 적용돼 있어야 한다(`pnpm db:push`는 운영 DB를 바꾸므로 사용자 확인 뒤에만 실행한다).
2. `docker compose -f infra/compose.yaml --profile demo up -d --build`로 redis·minio·qdrant·ai-gateway·worker를 띄운다. DB 컨테이너는 없다(DB는 Supabase). web은 Compose의 선택 서비스 `web`으로 띄우거나 `web/`에서 따로 실행한다(데모 실행 방식은 [[10-DEPLOYMENT|10 배포]]). `curl -s http://localhost:3000/health/ready`가 `{status:"ok", checks:{db,redis,storage,ai:"mock"}}`인지 확인한다. `checks.db`는 Supabase(Postgres) 연결이다. 전체 기동 절차는 [[10-DEPLOYMENT|10 배포]].
3. `pnpm demo:reset`으로 seed를 적용한다(Compose 서비스가 아니라 스크립트. service role 키로 Supabase 프로젝트에 조직·계정·구성원·프로필·fixture를 적재, 멱등). `/admin/ingestion`에서 SEED 배치 결과를 확인한다: `{created:19, changed:0, cancelled:0, skippedDuplicate:0, quarantined:1, retried:2}` (격리 = FX-12 제목 누락, 재시도 2 = FX-20의 429 두 번).
4. **FX-01, FX-03, FX-14는 분석을 미리 완료**해 둔다. **FX-02는 `NOT_ANALYZED`로 남겨** S4에서 라이브 분석한다. FX-06, FX-07은 r1 분석까지 완료해 둔다(S5에서 r2 재분석이 보이도록).
5. 창 A(브라우저): `http://localhost:3000/auth/login` 화면에서 sales@soltech.invalid로 로그인한다(Supabase Auth). 창 B(터미널): viewer@other.invalid(`org-02`)의 Supabase access token을 받아 둔다. 비밀번호는 환경 변수 `DEMO_SEED_PASSWORD`에서 읽고 명령에 직접 쓰지 않는다.

   ```bash
   export ORG02_TOKEN=$(curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
     -d "{\"email\":\"viewer@other.invalid\",\"password\":\"$DEMO_SEED_PASSWORD\"}" | jq -r .access_token)
   ```

   access token에는 만료 시간이 있다(값은 Supabase Auth 설정, 미검증). 60분 전에 받은 토큰이 S7 전에 만료될 수 있으니 발표 직전에 한 번 더 받는다. 응답 형식은 리허설에서 확인한다.
6. 화면 우상단 모드 표시가 `AI: mock`인지 확인한다.
7. 백업 영상(3분)이 로컬에서 열리는지 확인한다.

## 4. 클릭 경로

각 단계는 [[18-HACKATHON|18]] §6의 시각과 맞춘다. "보여야 하는 것"이 보이지 않으면 그 장면은 건너뛰고 다음으로 간다. 거짓으로 설명하지 않는다.

### S1 문제 (0:00) — 슬라이드

조작 없음.

### S2 대시보드 (0:30)

1. 창 A `/dashboard`.
2. 보여야 하는 것: `DEMO` 배지, `AI: mock` 표시, "마지막 수집" 시각, 카드: BID 후보 수, 검토 대기, **마감 임박 7일(FX-14 포함)**, 최근 변경. 관리자 요약에 "격리 1건(FX-12, 제목 누락)".
3. 말할 것: 가상 데이터임을 먼저 밝힌다. "깨진 데이터는 숨기지 않고 격리한다."

### S3 자격 판정과 규칙 우선 (1:00~2:15)

1. `/bids`에서 필터: 단계 `입찰공고`, 정렬 `점수 내림차순`. 상단에 FX-01(94, BID), FX-18(82), FX-06(78) 순으로 보인다.
2. **FX-01** 클릭 → `/bids/[id]`. 상단: 세종특별자치시, 12억, D-21, 단계 타임라인, 원문 링크, `revision 1`, 상태 `COMPLETED`.
3. 자격 체크리스트 3건 모두 `SATISFIED`. 한 건의 근거 열기 → `EvidenceDrawer`: RFP 인용 구절·페이지·문자 위치. 말할 것: "AI가 만든 인용이 아니라 원문과 대조된 인용. 대조에 실패하면 무효."
4. 뒤로 → 필터에서 결정 `NO-BID` 선택 → **FX-03** 클릭.
5. 자격 체크리스트: 정보통신공사업 등록 `NOT_SATISFIED`(사유: 프로필에 등록 없음). 권고 `NO-BID`. Kev 패널: `모델 선택지 신뢰 분포(수주 확률 아님)` 문구, BID 0.55 / WATCH 0.30 / NO_BID 0.15, 배지 `MODEL_RULE_DISAGREEMENT`.
6. 말할 것: "모델이 BID라고 해도 필수 자격 미충족은 규칙이 이긴다. 모델 분포는 수주확률이 아니다."

### S4 라이브 분석과 사람 결정 (2:15~3:30)

1. 목록에서 **FX-02** 클릭. 상태 `NOT_ANALYZED`.
2. "분석 요청" 클릭 → `QUEUED → PROCESSING → COMPLETED` 전이가 10초 안에 보인다(mock). 응답은 `202` + `pollUrl`.
3. 점수 게이지 72와 5개 요소 분해(값은 [[08-SCORING|08]] worked example B와 동일해야 한다). `missingFactors`가 있으면 표시된다.
4. Kev 패널: BID 0.36 / WATCH 0.52 / NO_BID 0.12, 규칙 권고 WATCH와 일치. 말할 것: "점수 50~75 구간은 사람 검토."
5. 결정 패널: 결정 `WATCH`, 사유 "요구기술 3개(Vue.js·SCORM·WebRTC) 미보유, 협력사 확보 후 재검토", 담당자 지정 → 저장.
6. 보여야 하는 것: 결정 이력 1건(결정자·시각·사유), 알림 벨 `REVIEW_ASSIGNED` 1건.

### S5 변경 감지와 멱등 (3:30~4:15, 시간 부족 시 생략)

1. admin@soltech.invalid로 전환(또는 미리 로그인한 탭) → `/admin/ingestion` → "수동 수집 실행", 배치 `live`.
2. 보여야 하는 것: 수집 결과 `{created:0, changed:3, cancelled:1, skippedDuplicate:1, quarantined:0, retried:0}` = 변경 3(FX-06, FX-07, FX-10), 취소 1(FX-08), 중복 skip 1(FX-09).
3. **FX-07** → `/bids/[id]/revisions`: 예산 18억 → 21.6억, 요구기술에 Kubernetes 추가가 diff로 하이라이트. 재분석 결과 68 → 76, 권고 WATCH → BID.
4. 알림 벨: `BID_CHANGED`가 FX-06, FX-07, FX-10에 각 1건, FX-09는 0건. 말할 것: "같은 수집을 다시 돌려도 알림이 늘지 않는다."

### S6 장애 대체 (4:15~4:45)

1. 장애 주입: 터미널에서 `docker compose -f infra/compose.yaml stop ai-gateway` ([[10-DEPLOYMENT|10]] 장애 주입 절). 우상단 표시가 `AI: unavailable`로 바뀐다.
2. **FX-01** → "재분석(force)".
3. 보여야 하는 것: 새 `score_run` 상태 `PARTIAL`, `recommendationBasis=RULES_ONLY`, `reviewFlags`에 `AI_UNAVAILABLE`, 배너 "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)"([[09-SECURITY|09]] 고지 문구). 자격 체크리스트와 점수는 ingest 때 저장된 추출 결과로 그대로 계산되고, Kev 패널은 "사용 불가", 설명은 템플릿 문장. 이전 `COMPLETED` run은 이력에 남아 있다.
4. 말할 것: "모델이 없어도 결과가 나오고, 없다는 사실을 숨기지 않는다. 결과를 덮어쓰지 않고 새 run을 만든다."
5. 복구(Q&A 전): `docker compose -f infra/compose.yaml start ai-gateway` → `AI: mock` 복귀 확인.

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
| S4 분석 | `PROCESSING`에서 멈춤 | 미리 분석된 FX-01·FX-03으로 점수·자격 설명을 이어 간다. 라이브 분석은 S6 재분석에서 다시 시도 |
| S4 저장 | 결정 저장 실패 | 오류 코드와 `requestId`를 그대로 보여 주고 "오류를 숨기지 않는 설계"로 설명. 백업 영상 해당 구간 |
| S5 수집 | 변경이 감지되지 않음 | 생략하고 S6으로. Q&A에서 [[07-DATA-PIPELINE\|07]] 변경 감지 설계로 답 |
| S6 장애 | `PARTIAL`이 아니라 `FAILED` | `FAILED` 상태와 재시도 버튼을 보여 주고 "상태를 그대로 노출"로 설명 |
| S7 격리 | 자격 판정 조회에 `200`이 돌아옴 | **데모를 멈추고 사실대로 말한다.** 격리는 핵심 보안 주장이므로 리허설에서 반드시 확인 |
| S7 격리 | `401 UNAUTHENTICATED` | access token 만료. S0 5의 명령으로 토큰을 다시 받아 호출한다 |
| 전 장면 | 인터넷 끊김으로 Supabase 접속 불가(로그인 실패, `/health/ready` `503`) | 대체 경로 미결정(§3 경고). 정해지기 전까지 사실대로 말하고 중단한다 |

## 6. 리허설 체크리스트

- [ ] 발표 회장 회선에서 Supabase 프로젝트 접속, `/auth/login` 로그인, `org-02` access token 발급 확인
- [ ] seed 재적용 포함 전체 경로 2회 연속 통과
- [ ] 각 장면 소요 시간 기록, 합계 5분 이내
- [ ] S7 `404` 응답 캡처, S3 `MODEL_RULE_DISAGREEMENT` 화면, S6 `PARTIAL` 화면을 `docs/evidence/`에 저장
- [ ] 백업 영상 3분 녹화 (S2~S7)
- [ ] 1440px에서 상세 화면 상단 요약·자격·점수가 스크롤 없이 보이는지 확인
- [ ] `AI: mock` 표시가 모든 화면에 보이는지 확인
- [ ] 08 worked example 값과 S4 화면 값(72, 요소 분해, Kev 분포) 일치 확인

## 관련 문서

- [[18-HACKATHON|18 해커톤 전략]]
- [[07-DATA-PIPELINE|07 수집·fixture]]
- [[08-SCORING|08 SOL Score·계산 예시]]
- [[06-UI-UX|06 화면]]
- [[10-DEPLOYMENT|10 배포·프로필]]
- [[11-TESTING|11 테스트·수용 체크리스트]]
- [[09-SECURITY|09 보안·격리]]
- [[16-DECISIONS|16 ADR]]
