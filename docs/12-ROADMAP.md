---
title: "12. 구현 순서와 해커톤 컷"
doc: "12"
status: draft
tags:
  - sol-radar
  - hackathon
  - ops
updated: 2026-10-30
---

# 12. 구현 순서와 해커톤 컷

> [!success] 새 마감 (2026-10-27 사용자 결정, [[16-DECISIONS|ADR-054]])
> 공식 제출 **2026-11-03(화)**, 발표 **2026-11-04(수)**. 사용자 원문: "새 마감일은 11월 3일. 발표일은 11월 4일." 사용자가 정한 날짜는 이 둘뿐이다. 남은 날의 세부 일정은 아래 "남은 일정 제안" 표 한 곳에만 두고, 사용자 확인 전이다. 이전 일정은 ADR-054로 바뀌었다(이력은 [[16-DECISIONS|16 ADR]] ADR-042·054).

[[16-DECISIONS|ADR-020]]으로 해커톤 MVP의 목표가 "fixture 20건 + mock AI"에서 **실제 나라장터 공고를 대상으로 끝까지 동작하는 MVP**로 바뀌었다(사용자 원문: "해커톤 시연용 가짜 AI가 아니라, 실제 공공입찰 데이터를 대상으로 끝까지 동작하는 SOL RADAR MVP"). 실수집·실추론·평가 트랙(P0-0~P0-11)은 별도 트랙이 아니라 아래 Phase 0~7 안에 들어간다. fixture 경로와 live 경로는 같은 인터페이스(`BidSourceConnector`·`AttachmentFetcher`·`DocumentParser`·`ModelClient`)로 함께 만든다. 시험과 CI는 `SOL_RUN_MODE=mock`으로 돈다.

## 남은 일정 제안 (2026-10-30 갱신, 사용자 확인 전)

> [!todo] 제안(사용자 확인 전)
> 마스터 세션의 제안이다. 사용자가 확인하기 전에는 확정 일정으로 쓰지 않는다. 확정된 것은 11-03 제출·11-04 발표와 발표 형식(덱 20분 + 녹화 클립)이다([[16-DECISIONS|ADR-054]]). 화면 동결은 **2026-11-03(화)**다(2026-10-30 사용자 결정으로 11-01에서 연기. [[16-DECISIONS|ADR-073]]). 화면 개편 스펙 §6의 11-01은 당시 기록이다([스펙](../polaris/specs/done/2026-10-28-ui-refresh.md)). 동결 전 main에 구글 캘린더 연동(ADR-073)이 들어간다.

|날짜|할 일|조건·상태|
|---|---|---|
|10-30(금)~10-31(토)|알림 Worker 회사 기동|완료(2026-10-30 12:45 KST, 사용자 승인). 카카오 발송 꺼짐으로 띄웠다([[16-DECISIONS\|ADR-068]] 6번). 인앱 알림 2종·마감 알림을 처리한다([기록](evidence/company-rollout/20261030/notify-worker-rollout.md))|
|10-30(금)|카카오 사용자 연결·S0 수신 시험|사용자 보고(2026-10-30): 카카오 간편 로그인과 카카오 메시지(나에게 보내기) 실발송까지 됐다. 증거 기록 경로 미확인. 실수신 녹화는 촬영 때 한다. 알림 Worker 기동 기록(12:47)의 "카카오 발송 꺼짐"과의 관계는 미확인이다|
|10-30(금)~11-03(화) 동결 전|구글 캘린더 연동(11-03 동결 전 main)|2026-10-30 사용자 결정([[16-DECISIONS\|ADR-073]]): `.ics` 내려받기와 `GET /api/v1/calendar/ics`를 빼고, 구글 로그인 연결에 캘린더 권한을 얹어 지금 보는 달의 일정을 전용 보조 캘린더 "SOL RADAR 입찰 일정"에 수동으로 밀어넣는다. 일정별 "구글 캘린더에 추가" 링크는 유지. 순서·완료 기준은 [스펙](../polaris/specs/planned/2026-10-30-google-calendar-sync.md). 사용자가 Google Cloud(Calendar API·동의 화면 범위)와 env 값을 준비해야 한다|
|11-01(일)~11-02(월)|촬영(녹화 클립): D1 운영 사이트 장면·S-GAPS·S-LIVE·카카오 실수신, 로컬 Compose S5·S6|실공고 분석은 운영에 있다([2026-10-29 기록](evidence/company-rollout/20261029/ai-gateway-rollout.md)). 카카오 실발송은 사용자 보고(2026-10-30) 기준이고 증거 기록 경로는 미확인이다. `/calendar`는 녹화 클립에 없고 질의응답 라이브라([[18-HACKATHON\|18 해커톤]] §6) 동결 전 바뀌는 구글 캘린더 연동은 촬영 장면과 겹치지 않는다|
|11-02(월)까지|리허설 중 FX-02 재분석 금지|촬영 때 "이전 분석 66(가상 프로필) → 새 분석 59(공개 자료 프로필)"이 보여야 한다. 촬영의 S4 [재분석]만 한다(예상: 11-02까지 59 보류(`WATCH`), 11-03부터 53 보류, SOL Score v0.2, [v0.2 미리 계산](evidence/sol-score-v02/20261030/fx02-forecast.md), [[16-DECISIONS\|ADR-059]]·[[16-DECISIONS\|ADR-071]]). 회사 gateway가 `req-extract/v0.2`로 바뀌어 재분석 때 Qwen을 새로 부르므로 59는 촬영 화면 값으로 다시 확인한다([[16-DECISIONS\|ADR-064]])|
|11-02(월)|리허설 1|D1 운영 사이트 `?origin=demo` 기준. `demo:reset` 안 함. 2026-10-30 사용자 결정으로 11-01에서 옮겼다|
|11-02(월)|발표 덱(20분)·녹화 클립 완성, 리허설 2|로컬 전체 `pnpm verify` 1회(GitHub Actions가 돌지 않는다). 사용자 승인 뒤 운영 읽기로 랜딩 출처 9곳 수집을 확인한다([출처 연결 목록](plans/2026-10-28-landing-sources-to-connect.md))|
|11-03(화)|화면 동결|2026-10-30 사용자 결정(11-01에서 연기, [[16-DECISIONS\|ADR-073]]). D1 운영 사이트 `?origin=demo` 기준. `demo:reset` 안 함|
|11-03(화)|공식 제출|확정(사용자)|
|11-04(수)|발표: 덱 20분 + 녹화 클립. D1 운영 사이트(`?origin=demo`)는 질의응답 라이브|확정(사용자). `demo:reset` 안 함|

- 끝난 것: 첨부 처리(Documents Worker 회사 운영, [기록](evidence/company-rollout/20261028/sources-rollout.md)), 실공고 분석(위 기록), 새 메뉴 3개([[16-DECISIONS|ADR-060]]), 화면 개편([[16-DECISIONS|ADR-061]]), 추천 분석 운영 반영([[16-DECISIONS|ADR-066]], [기록](evidence/company-rollout/20261029/rec-insight-rollout.md)), DEMO 공고 마감 +15일([기록](evidence/demo-deadline/20261027/prod-run.md)).
- 운영 DEMO 삭제(실운영 전환 A단계)는 발표 뒤로 미뤘다(ADR-054 2번). 이 표에 넣지 않는다.
- X6 파인튜닝·평가 실험 E0~E3·X2는 발표 뒤 진행 예정이라([[16-DECISIONS|ADR-067]]) 이 표에 넣지 않는다. 아래 해커톤 컷 표 "해커톤 이후" 행에 있다.

## 순차 실행 (Claude Code 기준)

어느 작업이 해커톤 어느 컷에 드는지는 아래 "해커톤 컷" 절의 표와 Critical Path 표가 정본이다.

|Phase|작업|종료 조건|
|---|---|---|
|0|템플릿 정리(Supabase·`web/` 유지, 견본 도메인 `memos`·`tasks` 등 정리 범위 결정), `infra/compose.yaml`(redis·qdrant·ai-gateway·worker), `web/worker` 진입점, AI gateway 골격, `/health/live`·`/health/ready`, Supabase 클라우드 프로젝트 연결·env, `pnpm check:env`, CI(`verify.config.json`), `demo` 프로필 기동. 실행 모드 `SOL_RUN_MODE`(`live`·`fixture`·`mock`)와 `pnpm check:env` 모드 모순 검사(P0-1), 서비스키 4개(`G2B_*_SERVICE_KEY`) 자리(서버 전용, [[16-DECISIONS\|ADR-022]]), 회사 GPU 추론 엔드포인트에 HTTPS로 붙는 `ai-local` 연결 방식([[16-DECISIONS\|ADR-025]]). 서비스키·회사 엔드포인트가 준비되는 대로 P0-0 외부 의존성 조기 점검. 템플릿 `tasks`는 지우지 않고 입찰 프로젝트 체크리스트로 재사용한다|Compose 서비스(redis/qdrant/ai-gateway/worker) healthy + web `/health/ready` green + Supabase 프로젝트 연결(`checks.db` ok). 모드 모순 env 기동 거부 시험 통과. `docs/evidence/phase-0/external-deps.md`에 P0-0 항목별 결과(막힌 항목은 사용자 보고)|
|1|`supabase/migrations`로 SOL RADAR 스키마([[04-DATABASE\|04 DB]])·RLS·`memberships.sol_role`, 정책 시험, seed(`pnpm demo:reset`), Supabase Auth 연결·RBAC, 솔리데오 부서·직급 카탈로그·가상 인력 200명 seed(ADR-019). ADR-020 저장 변경(실행 모드·출처 기록, 첨부 다운로드·파싱 상태, `requirement_assessments`·`bid_structured_requirements`·`eval_runs`)을 첫 SOL 마이그레이션에 포함(04 표 정의를 먼저 고친다). ADR-021 저장 변경: `departments` 계층(`parent_id`·`kind`), `team_members`(운영)·`team_member_scoring`(점수) 분리, 가입 시 개인 조직 생성 중단, 구성원 관리 정책을 `sol_role=ADMIN` 기준으로|회사 격리 RLS 정책 시험(`pnpm test:db`) 통과, 새 표마다 정책 시험, seed 20건(19건 적재 + `FX-12` 격리 1건) 멱등|
|2|공고 Connector 인터페이스 + `FixtureConnector` + `OfficialApiConnector`(나라장터 입찰공고 용역 중 정보화사업, 면허제한·참가가능지역·e발주 첨부 조회, P0-2) + 정규화 + revision. documents job·첨부 다운로드·`/parse`(PDF·HWPX·HWP, P0-3). 사전규격·발주계획 수집과 단계 연결(P0-8)|재실행 멱등 + 변경 감지 테스트. 서비스키·첨부 다운로드가 되면 live 수집 `ingest_runs` 요약과 실공고 형식별 파싱 성공률|
|3|Next.js 대시보드/검색/상세·가입 부서/직급 필수 선택·간편 가입 정보 보완·가상 정장 사진 200장 연결 (1440 기준). 실행 모드·출처 배지, 공고 목록 `origin` 필터, "가상 회사 프로필로 분석" 배지. 앱 셸(사이드바 정보 구조·조직 주소 없는 경로·서버 조직 결정), 설정(개인·조직 탭), 조직·인력 조회(200명 조직도·명부·상세, 사진 연결 자리), 데이터 수집 관리(`/admin/ingestion`), 대시보드 카드 5개([[16-DECISIONS\|ADR-021]])|fixture 실제 API로 화면 E2E, PPL-01~06, NAV-01~NAV-09([[11-TESTING\|11 테스트]] §9)|
|4|기업 프로필·필수 자격·규칙 점수. 규칙은 API 구조화 필드 우선 + 업종 코드 사전 + 3값·사유 코드(P0-5), SOL Score v0.1(P0-7의 점수 부분)|골든셋 일치(`mock` 모드), 근거 저장, worked example 3건 일치, 정보 부족 ≠ 미충족 단위 시험|
|5|AI gateway: mock adapter(CI용, 먼저) → 장애 대체(`PARTIAL`) → Qwen3.8-Flash-Next(회사 운영 vLLM API) `/extract` local + `translations`(P0-4) → Bosun v3.1 0.6B `kev-qs/v0.2` 참고 지표·`stateTrace`·레지스트리 검증(P0-6) → `/explain`(P0-7)|mock/실모델 switch, PARTIAL 경로, 실패 유형 구분, 인용 검증 통과율·실공고 1건 E2E 로그, 결정 모델 응답 원문 저장·규칙 불변 시험|
|6|최종 권고 + 영업 리뷰 + 인앱 알림|엔드투엔드 검토 완료|
|7|보안·성능·로그·배포. 세 모드 기동 리허설, 엔드포인트 재접속 확인 리허설|릴리즈 체크리스트 PASS|
|평가 트랙|평가셋 v0.1(P0-9), 평가 하네스와 E0·E1'·E2 리포트(P0-10), 학습셋 번들 내보내기와 LoRA 메모리 검증 스크립트·절차(P0-11). Bosun LoRA 학습(F1·F2·F3)은 회사 GPU 서버의 물리 GPU 1(A40 46,068 MiB, 학습 전 메모리 확인, [[16-DECISIONS\|ADR-066]])에서 회사 측 실행(X6, [[16-DECISIONS\|ADR-034]]). 발표 뒤 진행 예정이다([[16-DECISIONS\|ADR-067]])|[[21-MODEL-TRAINING\|21 모델 학습]] §7 수용 기준|
|8 (P1)|카카오 알림톡 운영 전환(해커톤은 "나에게 보내기"로 대체, [[16-DECISIONS\|ADR-038]])/경쟁사/인력배치|공식 데이터 및 외부 승인 확보 후|

## 해커톤 우선순위 (P0)

공식 제출은 2026-11-03, 발표는 2026-11-04다([[16-DECISIONS|ADR-054]]). 아래 순서가 곧 잘라낼 순서다. 시간이 모자라도 범위를 임의로 줄이지 않고 선택지를 보고한다([[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]). `E0`~`E2`는 [[21-MODEL-TRAINING|21 모델 학습]]의 평가 비교 대상이며 데모 장면 번호(`S0`~`S7`)와 다르다.

|순서|항목|Phase|완료 기준|
|---|---|---|---|
|P0-0|**외부 의존성 조기 점검.** ① data.go.kr 오퍼레이션별 실제 응답 3건 저장·필드 확인 ② 공고 3건의 첨부 실제 다운로드(로그인·세션 필요 여부) ③ 회사 GPU 추론 엔드포인트([[16-DECISIONS\|ADR-025]]) G1 HTTPS 접속(TLS·인증) → G2 Qwen·Bosun `GET /v1/models`·레지스트리 대조 → G3 지연 실측 → G4 vLLM guided JSON → G5 회사 제공 GPU 정보 기록 → G6 차단 시 `PARTIAL`([[11-TESTING\|11 테스트]] §3.3 ③) ④ 실제 RFP 샘플로 파서 후보 비교 시작|서비스키·회사 엔드포인트(경로·인증 방식 전달, 모델 기동 완료 통보)가 준비되는 즉시. 그동안 다른 항목은 인터페이스로 진행|`docs/evidence/phase-0/external-deps.md`에 항목별 결과. 막힌 항목은 즉시 사용자 보고([[11-TESTING\|11 테스트]] §3.3)|
|P0-1|실행 모드 3종 + 출처·모드 기록 + 모드 모순 기동 거부|0 (기록 필드는 1)|모순 env 기동 거부 시험, 세 모드 기동 로그. 골든은 Phase 4에서 고정된 뒤 `mock` 모드로만 단언|
|P0-2|서비스키 발급(사용자 작업) → 실제 응답 3건 저장·registry 검증 → 입찰공고 용역 수집(정보화사업) + 면허제한·참가지역·e발주 첨부 조회 + 첨부 다운로드 가능성 확인|2|`ingest_runs` 요약, 공고 목록에 live 공고 노출|
|P0-3|첨부 다운로드 + `/parse`(PDF·HWPX·HWP) + 미지원 표시|2|실공고 30건 형식별 파싱 성공률 증거|
|P0-4|Qwen3.8-Flash-Next(회사 운영 vLLM API) 실추출(`/extract` local) + `translations`|5|인용 검증 통과율 증거, 실공고 1건 E2E 로그|
|P0-5|규칙: API 구조화 필드 우선 + 업종 코드 사전 + 3값·사유 코드|4|단위 시험(정보 부족 ≠ 미충족)|
|P0-6|Bosun v3.1 0.6B(`sol_decision`) `kev-qs/v0.2` 실추론(en) + 참고 지표·플래그 + `stateTrace` + 레지스트리 검증|5|결정 모델 응답 원문·trace 저장, 규칙 불변 시험|
|P0-7|SOL Score v0.1 + `/explain` + 대시보드(모드·출처 배지, 결정 모델 참고 패널, 근거 서랍)|3 (화면)·4 (점수)·5 (`/explain`)|1440·1280 스크린샷|
|P0-8|사전규격·발주계획 수집과 단계 연결|2|StageTimeline에 실데이터|
|P0-9|평가셋 v0.1: test 20·dev 10 사업, 가상 기업 원형 6개, 라벨 검수(추출 정답 20건, 의미 대응 라벨 150건 이상)|X6|manifest·라벨 검증 통과|
|P0-10|평가 하네스 + E0·E1'·E2 리포트(한국어/영어 비교 포함)|평가 트랙|`docs/evidence/eval/` 리포트|
|P0-11|학습셋 번들 내보내기 + 메모리 검증 스크립트·절차|X6|train 1,000 레코드 이상, 번들 sha256, 학습 요청서. F1·F2·F3 실행은 GPU 서버 셸이 필요해 회사 측(X6, [[16-DECISIONS\|ADR-034]])|

**순서 규칙** ([[16-DECISIONS|ADR-020]], 2026-10-16)
- **작업 순서는 Phase 순서**, **P0 번호는 우선순위**다. 시간이 모자라면 큰 번호부터 잘라낼 후보로 보고하고 사용자가 정한다([[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]). P0-0 항목이 막히면 즉시 보고한다.
- P0 번호와 C-ID의 대응은 아래 Critical Path 표의 "Phase / P0" 열이다. P0-8은 확장 컷(ADR-023), P0-9·P0-11은 X6(ADR-034)이고, P0-10 하네스는 X1·X6이 같이 쓴다.

## 해커톤 컷 (ADR-023, 2026-10-19)

[[16-DECISIONS|ADR-023]]으로 컷을 3단 + 이후로 정했다. ADR-020·021의 설계는 그대로이고 우선순위와 데모 노출 범위만 바뀐다.

|구분|포함|이유|
|---|---|---|
|**핵심 컷**(데모 필수)|장면: S2 대시보드, S3 FX-01 근거·결정 모델 상충·가정 재계산(D1 공개 자료 프로필은 92 보류, 자격 3건 가정이면 추천. 로컬 `mock`은 94 추천(`BID`)과 FX-03 비추천), S4 FX-02 분석·사람 결정·알림, **S-LIVE 실제 공고 1건 AI 분석 결과**, S6 `PARTIAL`, S7 격리 404. 기능: Phase 0 마감(Compose·gateway 골격·health 병합), Phase 1(공고·프로필·분석·검토·알림·감사 표, RLS, `sol_role`, `pnpm demo:reset`), Phase 2 중 `FixtureConnector`·정규화·revision·격리·documents job·`OfficialApiConnector`(P0-2·P0-3 live 1건), Phase 4 전부(P0-5·P0-7 점수), Phase 5 중 `/extract`·`/kev`·`/explain`·`/parse`(검증 형식만)·mock adapter·`PARTIAL`·`local` 어댑터(P0-4·P0-6, 1건 실추론), Phase 6 결정 기록·인앱 알림 2종, Phase 3 중 앱 셸 최소(메뉴 3개·상단바 DEMO 배지·수집 신선도)·`/dashboard`·`/bids`·`/bids/[id]`·`/notifications`, Phase 7 중 `check:env`·healthcheck·DEMO 배지·증거·세 모드 기동·대체 경로 리허설. 평가 중 **E3 대조 실험(축소 규모)**(ADR-067로 발표 뒤 진행). 인력 200명 전원·고정 기간 95.5 FTE는 점수 입력으로만 쓴다. 아래 Critical Path C0~C9·X1~X4|공식 제출 2026-11-03·발표 2026-11-04(ADR-054), 배점 실용성 30 + 완성도 25. "이 입찰에 들어가야 하는가"가 끝까지 도는 것이 먼저다|
|**파인튜닝 트랙 X6**([[16-DECISIONS\|ADR-034]]. 발표 뒤 진행, [[16-DECISIONS\|ADR-067]])|평가셋 v0.1(test 20·dev 10, P0-9), 학습셋 번들 내보내기·학습 요청서(P0-11), Bosun LoRA F1·F2·F3(회사 측 실행), E4 = Bosun+LoRA를 E1'(공개 Bosun zero-shot)과 같은 test 분할에서 짝 부트스트랩 95% CI로 비교. 데모·S-LIVE 모델은 공개 Bosun v3.1 0.6B 그대로|사용자 결정(2026-10-19). 발표 뒤 진행 예정이다(ADR-067, "해커톤 이후" 행). 회사 측 학습 결과를 못 받으면 "회사 측 미실행"으로 적는다. 핵심 컷 green 판정은 학습 결과를 기다리지 않는다|
|**데모 강화 컷**(핵심 컷과 나란히, [[16-DECISIONS\|ADR-037]])|BOOST-2 가정 재계산: 공고 상세의 미보유 필수 자격에 "보유 가정" 스위치 → 저장된 입력 스냅샷으로 점수·권고·자격 판정을 다시 계산해 원래 → 가정 띠로 보인다(저장 없음, 결정 모델 재호출 없음). 데모는 S3 `FX-01`(92 보류)에서 필수 자격 세 건 스위치(보류 → 추천, 92 그대로). FX-02는 가정해도 보류 59라 S4에서 뺐다(ADR-059 2026-10-30 개정, ADR-071)|main 병합, 데모 S3에 포함. 조건: 핵심 컷 코드 경로·계약을 바꾸지 않는 추가형, 확률·승률 표시 금지(ADR-007)|
|**확장 컷**(예외: 카카오 ADR-038, 4건 ADR-039, 부처 지원사업 공고 ADR-040)|**카카오톡 추천 공고 알림**(나에게 보내기, [[16-DECISIONS\|ADR-038]]) → S5 변경 감지(FX-06·07·09·10 LIVE 배치, revision diff, `BID_CHANGED`) → `/people`·`/org-chart` 메뉴 → `/admin/ingestion` 화면 → 설정 조직 탭 → ADR-021 앱 셸 나머지·대시보드 카드 5개 → P0-8 사전규격·발주계획 단계 연결 → 부처 지원사업 공고 수집·목록([[16-DECISIONS\|ADR-040]]) → E0·E2·E3 전체 평가셋(test 20) 리포트(발표 뒤, ADR-067) → `/admin/ai/eval-runs`(코드 없음)|평가 리포트·`/admin/ai/eval-runs` 밖의 항목은 main에 들어갔다([통합 기록](evidence/committed-integrations/integration.md)). 카카오는 간편 로그인·나에게 보내기 실발송까지 됐다는 사용자 보고(2026-10-30)가 있고 증거 기록 경로는 미확인이다. 실수신 녹화는 촬영 때 한다(위 남은 일정 제안 표). 메일 알림([[16-DECISIONS\|ADR-041]])은 해커톤에서 뺐다(코드 없음)|
|**P1**(ADR-021 P1, [[16-DECISIONS\|ADR-042]]로 병행)|관심 공고(N3) → 분석 결과 비교(N5) → 입찰 프로젝트(N6, 대시보드 다섯 번째 카드 교체 포함) → 인력 배치 시뮬레이션(N7) → 조직·인력 ADMIN 편집(N4b). 그 뒤(이번에는 하지 않는다): 계약과정통합공개로 사업 묶기, Qdrant 의미 검색, Playwright 전체 E2E 녹화, 간편 로그인 제공자 설정(맨 마지막)|다섯 화면 모두 main 병합·운영 배포. 확률·승률 없음|
|해커톤 이후|API·worker NestJS 전환([[16-DECISIONS\|ADR-028]]. 화면은 Next.js, DB·Auth는 Supabase 그대로). X6 Bosun LoRA 학습(F1·F2·F3)·E1'·E4 채점, 평가 실험 E0~E3, 임팩트 예비 실험 X2(발표 뒤 진행 예정, 날짜 미정, [[16-DECISIONS\|ADR-067]]). Bosun LoRA 운영 반영(레지스트리 서빙 항목·데모 모델 교체, [[21-MODEL-TRAINING\|21 모델 학습]] §4.4 판단과 ADR). τ·온도 정식 보정. `sol-v0.2.x`의 결정 모델 반영 검토. Qwen 파인튜닝(2026-10-20 사용자 결정으로 하지 않음. 재검토는 별도 ADR). 낙찰·계약 수집. zip·스캔 PDF·혁신장터 RFP. Phase 5 `ai-hosted`. Phase 7 운영 심화(nginx TLS, 백업·복구 리허설, Sentry/Grafana). Phase 8 P1 전부(카카오 알림톡 운영 전환: 사업자·비즈니스 채널·딜러사·템플릿 검수, [[16-DECISIONS\|ADR-038]]. 경쟁사 통계, 인력 배치 저장·배정 확정). `/ops` 분리. P2([[01-PRD\|01 PRD]] FR-12 발주 예측·승률 모델, 검증 데이터와 백테스트 뒤 노출). ADR-021 후속: 수주 전략·시장 분석(낙찰·경쟁. 수집 공고 집계인 발주 현황과 입찰 일정은 [[16-DECISIONS\|ADR-060]]으로 해커톤 안), 개인 알림 수신 설정, ANALYST 검토 의견, 멀티 조직 지원(조직 전환 UI 포함)|외부 승인·비용·GPU 의존. 운영 반영은 초기 목표 지표 미달만으로 정하지 않고, 오류 분석에서 모델 판단 오류가 주된 원인일 때 사람이 정한다|

규칙: 핵심 컷 → 확장 컷 → P1 순서다. 예외(데모 강화 컷 ADR-037, 카카오 ADR-038, 확장 컷 4건 ADR-039, 부처 지원사업 공고 ADR-040, P1 ADR-042)는 핵심 컷과 나란히 진행했고 모두 main에 들어갔다. 작업자가 겹치면 핵심 컷이 먼저다. 범위를 더 줄여야 하면 선택지를 보고하고 사용자가 정한다([[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]).

### Critical Path 상태 (ADR-023, 2026-10-29 기준)

남은 일의 날짜는 위 "남은 일정 제안" 표다. 진행 기록은 [[PROGRESS]]다.

|ID|작업|Phase / P0|상태|
|---|---|---|---|
|C0|Phase 0 마감: Compose 통합 기동·증거·main 병합|0 / P0-1|완료|
|C1|P0-0: ① API 4종 실제 GET ② 첨부 3건 다운로드 ③ 회사 GPU 추론 엔드포인트([[16-DECISIONS\|ADR-025]]) G1~G6 ④ 파서 후보 비교. 체크리스트 `docs/evidence/phase-0/external-deps.md`|0 / P0-0|①② 완료(2026-10-19). ③ Qwen probe 통과(2026-10-21). 운영 실모델 분석은 DEMO 재분석([[16-DECISIONS\|ADR-059]])과 실공고 3건([2026-10-29 기록](evidence/company-rollout/20261029/ai-gateway-rollout.md))이다. ④ 파서는 구현됐고, 실표본 비교·"지원" 판정은 해커톤 뒤([[03-AI-PIPELINE\|03]] §10.3, [[16-DECISIONS\|ADR-068]] 1번)|
|C2|Phase 1 DB·RLS·`sol_role`·`pnpm demo:reset`|1|완료|
|C3|Phase 2 수집: `FixtureConnector`·정규화·revision·격리·ingest job, documents job, `OfficialApiConnector`·`G2bAttachmentFetcher`|2 / P0-2·P0-3|완료. 운영 3시간 정기 수집(나라장터·LH·KEPCO·K-water 입찰공고, 기업마당은 전용 Worker). 첨부 다운로드·파싱은 Documents Worker가 회사에서 운영 중이다([기록](evidence/company-rollout/20261028/sources-rollout.md)). 건수는 [[PROGRESS]]|
|C4|Phase 4 규칙 엔진(순수 함수)·골든 94/72/68·200명 입력|4 / P0-5·P0-7|완료|
|C5|Phase 5 gateway `/extract`·`/kev`·`/explain`·`/parse` → worker extract·analysis·`PARTIAL` → `local` 어댑터|5 / P0-4·P0-6|완료. 회사 gateway에 파서 3종(PDF·HWPX·HWP)과 첨부 조립 v0.2([[16-DECISIONS\|ADR-064]])가 있다|
|C6|Phase 3 화면: 앱 셸 최소·`/dashboard`·`/bids`·`/bids/[id]`·`/notifications`, Route Handler 10개([[16-DECISIONS\|ADR-029]] A6 D8)|3 / P0-7|완료|
|C7|Phase 6: 결정 기록 트리거·audit·outbox·인앱 알림 2종|6|완료|
|C8|S-LIVE: 실공고 1건 `live` E2E, 실행 로그·녹화|5 / P0-4·P0-6|실공고 분석은 됐다(2026-10-29 3건, 모두 보류(`WATCH`), 2건은 Bosun 참고 의견 포함, [기록](evidence/company-rollout/20261029/ai-gateway-rollout.md)). S-LIVE 녹화는 남음|
|C9|리허설·대체 경로·세 모드 전환·로컬 Supabase CLI 전환·체크리스트|7|로컬 `mock` 리허설 기록 있음(`docs/evidence/demo-day/`). D1 리허설·촬영은 남음|
|X1|E3 대조 실험(축소 규모)|평가|발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]])|
|X2|임팩트 예비 실험 n=3|—|발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]])|
|X3|경쟁 서비스 비교(공개 페이지)|—|완료(2026-10-19)|
|X4|제출물: 발표 덱 20분·녹화 클립·기술 자료(`docs/submission/`)|—|초안. 완성은 남음|
|X5|확장 컷(위 표 순서)|—|위 해커톤 컷 표 "확장 컷" 행|
|X6|Bosun LoRA 파인튜닝 트랙([[16-DECISIONS\|ADR-034]]): 평가셋 v0.1(P0-9) → 학습셋 번들·학습 요청서(P0-11) → 회사 F1·F2·F3 → E4·E1' 채점|평가 / P0-9·P0-11|발표 뒤 진행 예정([[16-DECISIONS\|ADR-067]]). 회사 서버에서 돈 기록은 없다. 절차는 [[22-FINETUNE-RUNBOOK\|22 파인튜닝 실행서]]|
|BOOST-2|데모 강화 컷 가정 재계산(`whatIf`·`POST /api/v1/analyses/{id}/what-if`·상세 스위치·띠)|데모 강화 ([[16-DECISIONS\|ADR-037]])|완료|
|KAKAO|카카오톡 추천 공고 알림(나에게 보내기). [카카오 설계](plans/2026-10-20-kakao-memo-notify-design.md)·[카카오 계획](plans/2026-10-20-kakao-memo-notify-plan.md)|6 / 확장 컷 ([[16-DECISIONS\|ADR-038]])|main 병합, 운영 migration 적용. 카카오 간편 로그인·나에게 보내기 실발송 완료는 사용자 보고(2026-10-30), 증거 기록 경로 미확인. 실수신 녹화는 남음(알림 Worker는 2026-10-30 카카오 발송 꺼짐으로 기동했고, 켠 기록은 미확인)|
|P1|ADR-021 P1 다섯 화면(N3·N5·N6·N7·N4b, [[16-DECISIONS\|ADR-042]]). 완료 기준은 [설계 §3.2](plans/2026-10-16-sidebar-ia-design.md) 표|3·6 / P1|완료(main 병합·운영 배포)|

C3 수집의 저장과 하위 job([[16-DECISIONS|ADR-030]] B18): revision 저장은 RPC `ingest_save_revision`(마이그레이션 `20261019000009`)으로 원자적으로 하고, 하위 job은 outbox와 `documents` 큐만 만든다. **새 공고 자동 분석은 핵심 컷에 없다**. live 정기 수집은 BullMQ cron `0 */3 * * *`(`Asia/Seoul`, KST 00·03·…·21시)이고 옛 `G2B_INGEST_INTERVAL_MINUTES`는 무시한다([[07-DATA-PIPELINE|07 수집]] §2.2).

**외부 의존성 컷 규칙**(S-LIVE 장면, [[16-DECISIONS|ADR-023]]·[[16-DECISIONS|ADR-025]]):

|C1 결과|S-LIVE 장면|
|---|---|
|API 정상·GPU 정상|실제 공고·실제 추론 경로 유지|
|API 정상·GPU 불가|실제 공고에 규칙 기반 `PARTIAL` 결과|
|API 불가·GPU 정상|검증된 fixture 기반 실제 추론 시연|
|API 불가·GPU 불가|fixture·mock 시연과 사전 확보한 실제 검증 증거만|

"GPU 정상"은 C1 ③의 G2(`GET /v1/models`·레지스트리 대조)·G3(지연 실측) 통과다([[16-DECISIONS|ADR-025]]). 어느 경우든 실행 모드와 출처를 화면에 표시한다. 실시간 추론을 못 했으면 녹화·fixture 결과를 live라고 표시하지 않는다.

## 공공 입찰 확장·업무 UI (ADR-047)

[[16-DECISIONS|ADR-047]]은 채택됐고 main 통합·운영 적용됐다([기록](evidence/procurement-expansion/20261022-release.md)). 설계는 [스펙](../polaris/specs/in-progress/2026-10-21-public-procurement-expansion.md)이다. Phase0~8 계획 원문은 git `3ae02acf` 의 `docs/plans/2026-10-21-public-procurement-expansion-plan.md`에 있다. 기관별 수집 서비스는 서비스별 검증 뒤에 켠다(절차 `infra/company/README.md` §7, 지금 켠 출처는 [[07-DATA-PIPELINE|07]]). 기존 모델·점수·권한·DEMO 정책은 그대로다.

## 관련 문서
- [[01-PRD|01 PRD]] — FR별 P0·P1·P2
- [[10-DEPLOYMENT|10 배포]]
- [[11-TESTING|11 테스트]]
- [[16-DECISIONS|16 ADR]] — ADR-017(Next.js + Supabase), ADR-020(실데이터 MVP·P0 순서), ADR-023(3단 컷·대체 경로), ADR-034(결정 모델 Bosun·추출 Qwen3.8-Flash-Next), ADR-037(데모 강화 컷), ADR-054(마감 11-03·발표 11-04)
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]
- [[18-HACKATHON|18 해커톤]]
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
- [[21-MODEL-TRAINING|21 모델 학습]]
- [[22-FINETUNE-RUNBOOK|22 파인튜닝 실행서]] — X6 실행 절차
- [[PROGRESS]]
