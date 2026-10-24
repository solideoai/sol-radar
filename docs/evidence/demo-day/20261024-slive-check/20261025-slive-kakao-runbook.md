---
title: "10-25 S-LIVE·카카오 실수신 녹화 실행 절차서"
doc: "runbook-20261025-slive-kakao"
status: draft
updated: 2026-10-24
---

# 10-25 S-LIVE·카카오 실수신 녹화 실행 절차서

2026-10-24 사용자 재결정(카카오 실수신 녹화)에 따라 마스터 sol-radar-78이 배정한 절차서다. 코드 기준은 `origin/main@3e9ab6a`이다. 이 문서를 쓰면서 운영 env 변경·재시작·실발송·수집은 하지 않았다. 아래 단계는 10-25에 사용자와 함께 실행한다.

> [!warning] 선행 조건: 회사 Worker 정상화
> 10-24 운영 분석이 `QUEUED`에서 멈췄다(run `6a90acc4`, 회사 Worker 미소비). 원인은 sol-radar-78이 조사 중이다([진단](../../deployment/20261024-company-queue-diagnosis.md)). **Worker가 `mock` 분석을 `COMPLETED`로 끝내는 것을 확인하기 전에는 아래 어느 단계도 시작하지 않는다.**

## 0. 한눈에 보기

| 시각(10-25) | 할 일 | 회사 모드 | 카카오 발송 수단 |
| --- | --- | --- | --- |
| 전날(10-24) | 회사 `mock` 정렬, Vercel 카카오 env 4개 넣고 재배포, 카카오 앱 설정(§2) | mock | mock |
| 오전 | 카카오 S0 수신 시험(사용자) | mock | **memo** |
| 오전 | C9 리허설 2회(reset 포함). 시작 전에 카카오 알림 **끔** | mock | memo(알림 끔) |
| 리허설 뒤 | 마지막 `demo:reset`·`demo:preanalyze` | mock | memo(알림 끔) |
| 녹화 | `live` 전환 → 실공고 분석 → 카카오 수신 녹화 | **live** | memo(알림 켬) |
| 녹화 뒤 | `mock` 복귀 | mock | mock |

## 1. 서비스별 env 이름

값은 쓰지 않는다. 값은 사용자가 각 서비스의 env 저장소에 직접 넣는다.

| 서비스 | 항상 | 카카오 실발송 | live 전환 때 추가·변경 |
| --- | --- | --- | --- |
| Vercel web(`frontend`) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `API_CURSOR_SECRET`, `SOL_RUN_MODE`, `SOL_DEPLOYMENT_ROLE=frontend`, `REDIS_API_BASE_URL`, `REDIS_API_TOKEN`(선택 `REDIS_API_TIMEOUT_MS`) | `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_TOKEN_ENC_KEY`, `KAKAO_REDIRECT_URI` | 필수 없음(§3 참고) |
| 회사 compose 보간 `infra/.env.company.local` | `SOL_RADAR_REDIS_NETWORK`, `SOL_RUN_MODE` | — | `SOL_RUN_MODE=live` |
| 회사 redis-api `infra/.env.redis-api.local` | `SOL_DEPLOYMENT_ROLE`(compose가 `redis-api`로 덮음), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `API_CURSOR_SECRET`, `REDIS_API_TOKEN`(선택 `REDIS_API_TOKEN_PREVIOUS`), `REDIS_URL`, `SUPABASE_STORAGE_RAW_BUCKET`, `SUPABASE_STORAGE_PARSED_BUCKET` | — | 없음. `SOL_RUN_MODE`는 compose가 주입한다 |
| 회사 Worker `infra/.env.worker.local` | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `SUPABASE_STORAGE_RAW_BUCKET`, `SUPABASE_STORAGE_PARSED_BUCKET`, `NOTIFY_KAKAO_PROVIDER` | `NOTIFY_KAKAO_PROVIDER=memo`, `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_TOKEN_ENC_KEY`, **`SITE_URL`** | `G2B_BID_NOTICE_SERVICE_KEY`, `G2B_PRE_SPEC_SERVICE_KEY`, `G2B_ORDER_PLAN_SERVICE_KEY`, `G2B_INDUSTRY_MASTER_SERVICE_KEY`(선택 `G2B_INGEST_INTERVAL_MINUTES`, 기본 30) |
| 회사 AI gateway `infra/.env.ai-gateway.local` | `AI_PROVIDER`, `AI_HOSTED_APPROVED`, `AI_FALLBACK_TO_MOCK=false`, `KEV_ENABLED` | — | `AI_PROVIDER=local`, `QWEN_BASE_URL`, `QWEN_MODEL`, `QWEN_API_KEY`, `KEV_BASE_URL`, `KEV_MODEL_ID`, `KEV_API_KEY`, `KEV_QUESTION_SET=kev-qs/v0.2`, `KEV_ALLOW_KO_STATE=false`(`DEMO_MODE`는 비우거나 `false`) |

코드로 확인한 것과 78 메모와 다른 점:

- **Worker 카카오 키는 3개가 아니라 4개다.** `NOTIFY_KAKAO_PROVIDER=memo`이면 `KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`·`KAKAO_TOKEN_ENC_KEY`·`SITE_URL`이 모두 있어야 기동한다(`web/worker/notify-outbox.ts` `MEMO_REQUIRED_KEYS`). `SITE_URL`은 피드 버튼 링크의 바탕이다. `https://www.solideos-radar.com`으로 둔다. 비면 Worker가 기동하지 않는다.
- `KAKAO_TOKEN_ENC_KEY`는 정규 base64 32바이트다. Vercel과 Worker가 **같은 값**이어야 한다. 다르면 발송이 `KAKAO_TOKEN_KEY_MISMATCH`로 실패한다(`web/server/kakao-notify/kakao-sender.ts`).
- Vercel 연결·콜백 라우트는 회사로 넘기지 않고 Vercel에서 돈다(`web/app/api/v1/me/kakao-notify/*`, 4개 키 검사 `web/server/kakao-notify/kakao-connect.config.ts`). 운영 빌드에서 `KAKAO_REDIRECT_URI`는 https여야 한다. 시험 발송(`POST /me/kakao-notify/test`)은 outbox에 넣고 **Worker가 보낸다**.
- Vercel env는 새 배포부터 적용된다. 카카오 키 4개를 넣은 뒤 재배포해야 한다.
- Vercel에는 `REDIS_URL`·`SUPABASE_SERVICE_ROLE_KEY`를 넣지 않는다. 넣으면 `validateDeployment`가 기동을 거부한다(`web/app/_lib/deployment-role.ts`).
- Worker의 live 필수 키는 서비스키 4개다(`infra/run-modes.json` `requiredSecrets`). AI gateway는 서비스키를 받지 않는다.

## 2. 카카오 개발자 앱 설정 (사용자)

원천: [[10-DEPLOYMENT|10 배포]] "카카오 앱 설정", 코드 `web/server/kakao-notify/kakao-api.ts`.

1. 카카오 로그인을 활성화한다. 간편 로그인과 같은 앱이어도 된다. 연결 해제는 카카오 `unlink`를 부르지 않는다.
2. **Redirect URI**에 `https://www.solideos-radar.com/api/v1/me/kakao-notify/callback`을 등록한다. Vercel `KAKAO_REDIRECT_URI`와 글자까지 같아야 한다.
3. **플랫폼 → Web → 사이트 도메인**에 `https://www.solideos-radar.com`을 등록한다. 피드 링크 `web_url`·`mobile_web_url`의 도메인은 여기 등록한 도메인이어야 한다.
4. **피드 버튼 링크 도메인:** [분석 보기]는 `SITE_URL/bids/<id>`이고 [공고 원문]은 공고의 `sourceUrl`(나라장터 `https://www.g2b.go.kr/...`)이다(`web/server/kakao-notify/feed.model.ts`). `https://www.g2b.go.kr`도 사이트 도메인에 등록을 시도한다. 등록할 수 없을 때 [공고 원문] 버튼이 어떻게 동작하는지는 **미확인**이다. S0 시험 메시지는 `/settings` 링크만 있어 이 도메인을 시험하지 못한다.
5. **동의항목**에서 "카카오톡 메시지 전송(`talk_message`)"을 선택 동의로 켠다. 연결 때 코드가 `scope=talk_message`를 요청한다.
6. **클라이언트 시크릿**을 발급하고 사용함으로 둔다. 코드는 시크릿이 비면 연결을 시작하지 않는다.
7. REST API 키·시크릿·토큰 암호화 키 값은 사용자가 Vercel과 회사 Worker env에 직접 넣는다.

## 3. live 전환·복귀 순서

### 실행 모드가 어디서 정해지는가 (코드 근거)

- 분석 run의 `run_mode`는 **접수한 회사 redis-api의 `SOL_RUN_MODE`**에서 온다(`web/server/bids/bids.supabase.ts:518-519`). Vercel은 회사로 넘기기만 한다.
- health의 scope 일치 검사(runMode·Supabase·버킷)는 **회사 redis-api와 Worker 사이**에서 한다. Vercel `/health/ready`는 redis-api 응답을 그대로 전달한다(`web/app/_lib/application-health.ts`). 회사 compose는 `infra/.env.company.local`의 `SOL_RUN_MODE` 하나를 redis-api·AI gateway·Worker 셋에 똑같이 주입한다(`infra/compose.company.yaml`). 그래서 회사 셋은 항상 같은 모드다.
- Vercel 자신의 `SOL_RUN_MODE`는 머리말 "실행 모드" 표시와 목록 기본 출처에만 쓰인다(`web/app/_lib/run-mode.ts` 사용처).

**추천: 회사만 live로 바꾸고 Vercel은 mock 그대로 둔다.** [[19-DEMO-SCENARIO|19]] §4 S-LIVE는 "머리말은 mock, 분석 요약 띠는 live"를 보여 주는 장면이고, Vercel 재배포 2회(전환·복귀)가 필요 없다. sol-radar-78이 이 추천을 채택했다(10-24, [[2026-10-24-freeze-priorities|10-24 우선순위]] §2-6). 처음 안처럼 Vercel까지 live로 바꾸면 머리말도 live가 되고, 전환·복귀 때마다 Vercel env 변경 뒤 재배포가 필요하다.

### 전환 (마지막 `demo:reset`·`demo:preanalyze` 뒤)

1. 운영 `/admin/ingestion`에서 **마지막으로 성공한 일정 수집 run의 창 끝 시각**과 오늘 `quotaUsed`를 본다(§5 호출 수 계산의 입력).
2. 회사 터미널에서 셸에 `SOL_RUN_MODE`가 export돼 있지 않은지 본다(`env | grep -c '^SOL_RUN_MODE='`가 0). 셸 값은 `--env-file`보다 우선한다.
3. `infra/.env.company.local`: `SOL_RUN_MODE=live`.
4. `infra/.env.ai-gateway.local`: `AI_PROVIDER=local`과 Qwen·결정 모델 접속 변수(§1). 결정 서버(Bosun)가 회사에서 떠 있지 않으면 `KEV_ENABLED=false`로 둔다(규칙 + Qwen 추출, 결정 모델 지표 없음).
5. `infra/.env.worker.local`: 서비스키 4개, `NOTIFY_KAKAO_PROVIDER=memo`와 카카오 키 4개.
6. 세 서비스를 다시 만든다. env가 바뀐 컨테이너만 교체된다. **`--no-recreate`·`down`·`--remove-orphans`·volume 삭제를 쓰지 않는다.**

   ```bash
   DC="docker compose --env-file infra/.env.company.local -f infra/compose.company.yaml"
   $DC config --quiet
   $DC up -d --wait --wait-timeout 300 redis-api ai-gateway worker
   $DC ps
   ```

   Worker는 정지 유예가 180초라 교체에 최대 3분이 걸린다. 옛 Worker가 남아 있으면 [회사 실행서](../../../../infra/company/README.md) §6대로 옛 Worker를 먼저 멈춘다.
7. 확인(admin 로그인): `GET /api/v1/admin/ai/status`의 `runMode=live`·`gateway.runMode=live`·`qwen.healthy=true`·`kev.registryMatch=true`(KEV를 끈 경우 제외), 운영 `/health/ready`의 `checks.ai="local"`.
8. live Worker는 기동 즉시 일정 수집을 1회 돈다(창: 마지막 성공 일정 run의 창 끝부터 지금까지, 없으면 지금 − 1일, [[07-DATA-PIPELINE|07]] §2.2). `/admin/ingestion`에서 run이 `SUCCEEDED`인지와 `quotaUsed`를 본다.

### 복귀 (녹화 직후)

1. `infra/.env.company.local`: `SOL_RUN_MODE=mock`. `infra/.env.ai-gateway.local`: `AI_PROVIDER=mock`. `infra/.env.worker.local`: `NOTIFY_KAKAO_PROVIDER=mock`(서비스키·카카오 키는 남겨도 mock이면 쓰지 않는다).
2. 위 6번과 같은 `up -d --wait`로 다시 만든다. mock Worker는 G2B 일정 수집을 등록하지 않는다(`web/worker/main.ts` `syncG2bSchedule`).
3. 확인: `/health/ready`의 `checks.ai="mock"`, admin AI 상태 `runMode=mock`.
4. Vercel을 live로 바꿨다면 mock으로 되돌리고 재배포한다.
5. 복귀 뒤 `pnpm demo:reset`을 다시 돌리지 않는다. reset은 데모 조직의 `score_runs`·`outbox_events`·`notifications`를 지워 S-LIVE run이 사라진다(`scripts/demo-reset.mjs` `ORG_SCOPED_TABLES`). 실공고(`is_demo=false`)와 카카오 연결(`kakao_notify_links`)은 지우지 않는다.

> [!question] 78 확인 필요
> 10-27 발표 전 S0에서 `demo:reset`을 다시 돌리면 10-25에 만든 S-LIVE run도 지워진다. 발표 당일에 reset을 할지, 하면 S-LIVE를 녹화 화면으로 보여 줄지 정해야 한다.

## 4. 실제 공고 후보

**운영 DB는 로그인을 못 해 직접 보지 못했다.** 아래는 10-20 격리 live 수집 기록([live-bids.txt](../20261020-1434/live-bids.txt), 정보화 공고 86건)에서 가상 솔리데오 프로필에 맞는 공고를 골라, 규칙 엔진을 로컬 순수 함수로 계산한 결과다([원본 출력](candidates-rules-only.txt)). 녹화 전에 운영 `/bids?origin=all`에 같은 공고가 있는지 보거나, 같은 기준으로 다시 고른다.

계산 조건: `analyze()`(`web/server/scoring/analyze.ts`), 회사 프로필 `fixtures/company/solideo-profile.json`, 인력 `fixtures/people/solideo.people.json`, 기준일 2026-10-25, 추출 없음(`QWEN_UNAVAILABLE`, 규칙만), 면허제한은 "소프트웨어사업자/1468" 한 줄로 가정했다. 보정으로 10-20 실측 run(R26BK01774434, PARTIAL·RULES_ONLY WATCH 73)을 같은 조건에서 다시 계산해 **73으로 일치**하는 것을 확인했다.

| 순위 | 공고 | 발주처 | 예산(원) | 마감 | 규칙만 결과 | 고른 근거 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2027년 교육행정통합누리집 유지관리 사업 | 경상북도교육청 정보센터 | 302,663,460 | 11-10 10:00 | WATCH 85 | 선호 기관 유형 교육청, 선호 도메인 교육, 과거 실적 24.9 |
| 2 | 2027년 행정정보시스템 통합유지보수 용역 | 경기도 광주시 | 835,748,200 | 11-11 10:00 | WATCH 83 | 지자체, 민원 계열, 과거 실적 22.7 |
| 3 | 2027년 학교 누리집 및 내친구교육넷 유지관리 사업 | 경상북도교육청 정보센터 | 524,225,360 | 11-10 10:00 | WATCH 82 | 교육청, 교육 |
| 4 | 2027년 수원시 빅데이터 플랫폼 유지관리 용역 | 경기도 수원시 | 336,124,880 | 11-11 10:00 | WATCH 78 | 지자체, 데이터 플랫폼 |
| 참고 | AI 디지털노동위원회 구축 2차 사업(R26BK01774434) | 고용노동부 중앙노동위원회 | 1,143,558,000 | 11-19 10:00 | WATCH 73 | 10-20 실측 run이 있는 공고 |

읽는 법:

- 규칙만이면 모든 후보가 **WATCH**다. 추출이 없어 참가 자격이 `NEEDS_REVIEW`(`NOTICE_INFO_MISSING`)가 되고, 점수가 75 이상이어도 BID가 WATCH로 낮아진다. 대조군으로 넣은 국방 공고(지상무기효과분석모델)도 WATCH 62였다. 즉 **Qwen이 실패해도 `PARTIAL` WATCH가 나와 카카오 발송 조건(BID·WATCH, COMPLETED·PARTIAL)은 채워진다**(`supabase/migrations/20261023000701_bid_recommended_outbox.sql`).
- Qwen 추출이 성공하면 결과가 바뀐다. 자격이 모두 `SATISFIED`이고 점수가 75 이상이면 BID다. 정보통신공사업·ISMS-P·CSAP·방산업체처럼 솔리데오가 `NOT_HELD`인 자격이 필수로 추출되면 `NOT_SATISFIED`라 NO-BID가 되고 **카카오가 나가지 않는다**. 그래서 이런 자격이 제목·본문에 보이는 공고는 피한다.
- 운영 DB에서 다시 고를 때 기준: `DEMO` 배지 없음, 마감이 10-27 뒤, 발주처가 지자체·교육청, 도메인이 데이터 플랫폼·AX·민원·교육, 예산 50억 이하, 국방·무기체계 아님.

## 5. 녹화 순서·말할 것·되돌리기

### 준비 (10-25 오전, 회사 mock)

1. Vercel 카카오 키 4개와 재배포가 끝났는지 본다. 회사 Worker를 `NOTIFY_KAKAO_PROVIDER=memo`(키 4개)로 다시 만든다.
2. 녹화할 계정(예: `admin@admin.com`)으로 운영에 로그인해 개인 설정 "카카오톡 알림"을 사용자 본인 카카오 계정과 연결하고 켠다.
3. **S0 수신 시험:** 설정의 [시험 메시지 보내기]를 누른다. 휴대폰 "나와의 채팅"에 시험 피드가 오고 알림이 울리는지 본다. 알림이 울리지 않으면 멈추고 사용자에게 묻는다.
4. **리허설 전에 "카카오톡 알림"을 끈다.** 사전 분석(`demo:preanalyze`)은 요청자 없이 run을 넣어 카카오를 만들지 않는다. 하지만 리허설에서 화면으로 FX-02(WATCH)·FX-01 재분석을 하면 실제로 발송된다.

### 녹화 (마지막 reset·preanalyze 뒤)

1. §3 전환 1~8.
2. 카카오톡 알림을 다시 켠다.
3. 녹화를 시작한다. 휴대폰 화면과 운영 화면(1440)을 함께 담는다.
4. `/bids?origin=all` → §4 후보 1건 상세 → [분석 실행]. 분석 요약 띠에 "분석 실행 모드: live", 모델 이름, "가상 회사 프로필로 분석" 배지가 나오는지 본다.
5. 분석이 끝나면 outbox Worker가 2초 주기로 발송한다(`NOTIFY_POLL_INTERVAL_MS` 기본 2000). 휴대폰 "나와의 채팅"에 피드(공고명, `WATCH 권고 · <사유 한 줄>`, 발주처·마감·추정금액·점수, [분석 보기]·[공고 원문])가 오는 장면을 담는다.
6. 공고번호·`score_runs.id`·상태·`run_mode`·모델 식별자·갈래와 1440·1280 스크린샷을 `docs/evidence/demo-day/<일시>/run-modes.md`에 남긴다.

갈래 판정(외부 의존성 컷 규칙, [[12-ROADMAP|12]]):

| admin AI 상태 | 결과 | 말할 것 |
| --- | --- | --- |
| `qwen.healthy`·`kev.registryMatch` 모두 true | `COMPLETED`, 모델 열 채워짐 | 실공고·실추론 |
| Qwen만 정상, `KEV_ENABLED=false` | `COMPLETED`, 결정 모델 지표 없음 | 실공고·Qwen 실추론, 결정 모델 미사용 |
| Qwen 불가 | `PARTIAL`·`RULES_ONLY`·`QWEN_UNAVAILABLE`, WATCH(카카오는 나감) | 실공고·규칙만 |
| 분석이 끝나지 않음 | — | 녹화·증거만. 실시간이라고 말하지 않는다 |

말할 것: "추천 공고는 알림을 켠 사람의 카카오톡으로도 간다. 이건 실제 나라장터 공고를 가상 회사 프로필로 분석한 결과다. 해커톤에서는 카카오 '나에게 보내기'로 보내고, 운영에서는 알림톡으로 바꾼다." 실추론이 아니면 위 표의 갈래를 그대로 말한다.

### 다시 찍기와 되돌리기

- 같은 공고는 조직마다 처음 한 번만 보낸다(멱등 키 `<orgId>:<bidId>:BID_RECOMMENDED`). 다시 찍으려면 **다른 후보 공고**를 분석한다. reset은 S-LIVE run을 지우므로 쓰지 않는다.
- 끝나면 §3 복귀 1~5. 카카오톡 알림을 끄거나 연결을 해제할지는 사용자가 정한다.

### 소요 시간 (추정)

| 단계 | 시간 |
| --- | --- |
| 회사 live 전환(3개 재생성, Worker 유예 최대 180초)과 상태 확인 | 10~15분 |
| 첫 일정 수집(24h 창 기준 10-20 실측 2분 44초) | 3~6분 |
| 분석 1건(규칙만 10-20 실측 3.4초, 실추론은 측정 기록 없음) | 수 초~2분 |
| 카카오 수신 | 수 초 |
| 기록·스크린샷 | 10분 |
| mock 복귀 | 10분 |
| **합계** | **약 45~60분** |

### 공공 API 호출 수 (서비스 15129394, 1,000건/일, KST 날짜별)

- 첫 일정 수집 = 목록 쪽수 + 새 정보화 revision × 보조 3회. 10-20 평일 24h 창 실측은 266회(목록 5 + 87 × 3)였다.
- 창은 마지막 성공 일정 run의 창 끝부터 지금까지다. 10-24에 회사를 mock으로 바꾸면 10-25 전환 때 창은 약 하루다. 10-24·10-25가 주말이라 공고가 적어 **약 50~150회**로 추정하고, 상한은 평일 실측 기준 **약 300회**로 잡는다.
- **위험:** 마지막 성공 일정 run이 오래전이면(예: 10-24 live Worker가 수집에 계속 실패) 창이 여러 날로 길어진다. 평일 하루당 약 266회라 3일이면 한도를 넘는다. 전환 1번에서 창 시작을 보고, 2일이 넘으면 전환 전에 78·사용자와 정한다. 한도의 90%를 넘으면 보조 조회를 건너뛰어 새 공고가 `NEEDS_REVIEW`가 된다. 1,000회에 닿으면 run이 `QUOTA_EXCEEDED`로 실패한다. 이미 DB에 있는 실공고의 분석은 수집과 무관하게 할 수 있다(분석은 공공 API 0회).
- live로 켜 둔 동안 30분마다 반복 수집이 돈다. 회당 목록 1쪽 이상 + 새 revision × 3이다. 녹화 1시간이면 2회, 약 10회 안쪽으로 추정한다.
