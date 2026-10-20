# 실행 모드 확인 (C8 갈래 ② S-LIVE 사전 run) — 2026-10-20 14:34~15:10 KST · 커밋 9ed2085 (main 301f2a5 병합 뒤 381b098)

외부 의존성 컷 규칙 갈래: **"API 정상·GPU 불가"** — 실제 공고에 규칙 기반 `PARTIAL` 결과(12 로드맵). 회사 GPU 추론 엔드포인트(C1 ③)가 아직 없어 `QWEN_BASE_URL`·`KEV_BASE_URL` 을 닿지 않는 주소로 두고 gateway 를 `live`·`local` 로 띄웠다. 녹화·fixture 결과를 live 라고 적지 않았다.

## 환경

- DB·Auth: 전용 격리 로컬 Supabase CLI 스택(project `sol-radar-c8-live-20261020`, API `127.0.0.1:59421`, DB `59422`, 마이그레이션 `20261016000001`~`20261019000017` 적용). `pnpm demo:reset -- --env-file <scratch>/.env.c8-demo-reset` 로 조직 2·계정 5·프로필 rev 2·fixture 공고 19 적재. 클라우드 Supabase 에는 아무것도 넣지 않았다.
- Compose: `docker compose -p sol-radar-c8 --env-file <main>/infra/.env --env-file <worktree>/infra/.env.c8-live -f <worktree>/infra/compose.yaml up -d --build`. 서비스키 4개는 main `infra/.env` 에서 Compose 가 읽어 worker 컨테이너에만 넘겼다(값을 읽거나 복사하지 않았다). 덮어쓰기 env: `SOL_RUN_MODE=live DEMO_MODE=false AI_PROVIDER=local KEV_ENABLED=true AI_FALLBACK_TO_MOCK=false KEV_ALLOW_KO_STATE=false`, `QWEN_BASE_URL=http://127.0.0.1:9/qwen`, `KEV_BASE_URL=http://127.0.0.1:9/kev`(컨테이너 안 빈 포트), `QWEN_MODEL=Qwen/Qwen3.5-9B`, `KEV_MODEL_ID=kev-9b-v1.0`, `KEV_QUESTION_SET=kev-qs/v0.2`, 호스트 포트 6390·9010·6343·8010, `NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:59421`.
- web: worktree 에서 `pnpm -C web dev -p 3100`, `web/.env.local` `SOL_RUN_MODE=mock`(19 §4 S-LIVE: `mock` 앱에서 live run 을 `origin=all` 로 연다). 브라우저는 `http://localhost:3100`(`127.0.0.1` 은 Next dev 의 `allowedDevOrigins` 에 막혀 hydration 이 안 된다).

## 모드 확인

| 모드 | 기동 | 머리말 "실행 모드" | gateway `/health` | `qwen.healthy`·`kev.registryMatch` | 판정 |
| --- | --- | --- | --- | --- | --- |
| `live` (gateway·worker) | 기동 거부 없음. gateway 로그 `qwen /v1/models unreachable: ConnectError`, `kev /v1/models unreachable: ConnectError` 뒤 `Application startup complete`. worker 는 registry·서비스키 검사(목록 + 보조 소스 3키) 통과 뒤 `worker started`, healthy | (web 은 mock) | `{"status":"ok","runMode":"live","provider":"local","kevEnabled":true,"qwen":{"model":"Qwen/Qwen3.5-9B"},"kev":{"modelId":"kev-9b-v1.0","registryMatch":null},"questionSets":["kev-qs/v0.2"]}` ([gateway-health.json](gateway-health.json)) | 둘 다 미접속(`registryMatch: null`) — 의도한 상태 | ✅ 갈래 "GPU 불가" 대로 기동 |
| `mock` (web) | `pnpm -C web dev` | "실행 모드: mock", 우상단 "AI: local"(gateway `/health` provider) | web `/health/ready` `{"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok","ai":"local"}}` ([web-health-ready.json](web-health-ready.json)) | — | ✅ |
| `fixture` | 시도하지 않음 | — | — | — | 이번 범위 밖 |

- `SOL_RUN_MODE=live pnpm check:env`: **돌리지 못했다.** `check:env` 는 `infra/.env`·`web/.env.local` 파일만 읽고(process.env 무시) main `infra/.env` 는 `mock` 이며, 서비스키 사본을 worktree 에 만들지 않았다(`.env` 복사는 가드가 막는다). 대신 worker 가 `live` 로 기동했고(기동 때 `G2B_BID_NOTICE_SERVICE_KEY` 를 읽어 디코딩, 없으면 기동 거부) 실호출이 `resultCode 00` 으로 266회 성공한 것이 서비스키 유효 증거다.
- `GET /api/v1/admin/ai/status`·`/admin/sources` 는 미구현(404)이라 보지 않았다(C9 1차와 같다).

## S-LIVE 사전 run

| 항목 | 값 |
| --- | --- |
| 공고번호 | **R26BK01774434** "AI 디지털노동위원회 구축 2차 사업" — 고용노동부 중앙노동위원회, 예산 1,143,558,000원, 마감 2026-11-19 10:00 KST, 원문 `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01774434&bidPbancOrd=000` |
| `bid_notices.id` | `88b00bf7-9928-4425-ab38-99406c9e91a9` (`is_demo=false`, source `g2b-bid-notice`, revision 1, 수집 15:02 KST) |
| `score_runs.id` | `99614071-1bf9-4417-b0ad-8c3f1a2b4fe0` ([score-run-live.json](score-run-live.json)) |
| 상태 | `PARTIAL` · `recommendation_basis=RULES_ONLY` · `error_code=QWEN_UNAVAILABLE` · `review_flags=[QWEN_UNAVAILABLE]` · `run_mode=LIVE` · `ai_provider=LOCAL` · 모델 열 null · `fallback_reason` null |
| 결과 | 권고 WATCH, SOL Score 73(합계 72.6), 필수자격 2건(충족 1 — 면허제한 `lcnsLmtNm` 소프트웨어사업자 1468, 공고 API 필드 · 확인 필요 1 — 참가 자격 요건 `NOTICE_INFO_MISSING`), 점수 분해 5행, Kev "사용 안 함" |
| 소요 | 분석 요청(상세 "분석 실행" 버튼, analyst@soltech.invalid) 15:04:35 → 완료 15:04:39, 3.4초 |
| 실행 경로 | web `POST /api/v1/bids/{id}/analyses` → worker(live) → gateway `/extract` 200 `QWEN_UNAVAILABLE`(gateway 로그 `qwen call failed: ConnectError`) → 규칙만 계산 → `/explain` 200(TEMPLATE). Kev 는 추출이 없어 부르지 않았다(03 §8 설계대로 — 같은 run 에 `KEV_UNAVAILABLE` 은 남지 않는다) |

`pnpm demo:reset` 뒤에도 남는지는 이번에 확인하지 않았다(격리 스택을 run 뒤에 다시 reset 하지 않음). 04 §6·C2 증거(`live 공고 보존: true`)가 근거다.

## live 수집 1회 (호출 수)

| 항목 | 값 |
| --- | --- |
| run | `ingest_runs.id` `2c0002b4-e656-4f74-8823-c0f5a1250e8a`, `SCHEDULED`(worker 기동 즉시 BullMQ 반복 job 이 1회 돈다), `run_mode=LIVE` ([ingest-run-live.json](ingest-run-live.json)) |
| 창 | 2026-10-19 15:00 ~ 2026-10-20 15:00 KST (체크포인트 없음 → 24h) |
| 결과 | `SUCCEEDED`, 실공고 **86**건(created 86 · changed 1 = revision 87) · quarantined 0 · retried 0, `ingest_errors` 0, 2분 44초 ([live-bids.txt](live-bids.txt)) |
| 보조 조회 3종 | 새 revision 마다 공고 단위 `inqryDiv=2` + `bidNtceNo` 로 면허제한·참가가능지역·e발주 첨부 호출(커밋 9ed2085). `bid_structured_requirements` 113행(LICENSE_LIMIT 110 · PARTICIPATION_REGION 2 · PERMITTED_INDUSTRY 1, [structured-requirements-count.txt](structured-requirements-count.txt)). e발주 첨부는 `attachments[]` 에 합쳐졌다(선정 공고의 "제안요청서 12") |
| **공공 API 호출 수** | **266** (`ingest_runs.quota_used`: 목록 쪽 5 + 새 revision 87(공고 86 + 변경 1)×3 보조 = 266, 재시도 0). 15129394 오늘 누적 496(X6a 녹음) + 266 = **762 / 1,000** |
| 조치 | 분석이 끝난 15:05 에 worker 컨테이너를 `stop` 했다(30분 뒤 반복 run 이 다시 호출하므로). 오늘은 live 수집을 더 돌리지 않는다 |

> [!warning] S0 live 전환 비용
> live worker 는 기동 즉시 "마지막 체크포인트 ~ 지금"(없으면 24h) 창을 돌고 30분마다 반복한다. 24h 창 하나가 정보화 공고 약 86건 × 보조 3회 ≈ 260회다. 데모 당일 S0 에서 `live` 로 전환하면 같은 비용이 든다. 호출 예산(개발계정 1,000/일)을 쓰는 다른 작업(X6a 녹음)과 같은 날에 겹치지 않게 잡아야 한다.

## 11 §5 11a 항목별

| 보여야 하는 것 | 결과 |
| --- | --- |
| `/bids?origin=all` 에서 실제 공고 열기 | ✅ 목록 출처 "나라장터", DEMO 배지 없음, SOL Score 73 · WATCH · 부분 완료 ([s-live-list-1440.png](s-live-list-1440.png), [1280](s-live-list-1280.png)) |
| 출처 `g2b-bid-notice`, 원문 링크 실제 URL | ✅ "출처 나라장터 입찰공고 (g2b-bid-notice)", "원문 보기" → g2b.go.kr |
| 실제 발주기관·예산·마감 | ✅ |
| 분석 요약 띠 "분석 실행 모드: live" | ✅ |
| "AI: local · Qwen/Qwen3.5-9B · jaredpalmer/kev-9b@v1.0" | △ "AI: local" 만. `PARTIAL` run 은 모델 열이 null 이라 식별자가 없다(실추론이 없었으니 맞는 표시) |
| "가상 회사 프로필로 분석" | ✅ + "실제 공고 × 가상 회사 프로필" |
| Topbar "실행 모드: mock" 유지 | ✅ |
| 자격 3값 + 사유 코드 | ✅ 충족 1 · 확인 필요 1(`NOTICE_INFO_MISSING`) |
| 점수 분해 5행 | ✅ |
| Kev `UNCALIBRATED` + 고지 | ❌ Kev 미호출(추출 없음) → "사용 안 함". 갈래 "GPU 불가" 에서는 이것이 정답 |
| 근거 서랍 실제 첨부 인용 | ❌ 첨부 다운로드·파싱(documents 소비자)이 아직 없어 `bid_documents` 4건 모두 `PENDING`. API 필드 인용 1건(`lcnsLmtNm`)만 |
| `DOCUMENT_DOWNLOAD_FAILED`·`PARSE_UNSUPPORTED` 배지 | — 다운로드를 시도하지 않아 배지도 없다(`PENDING`). 19 §4 2번의 "못 읽었으면 배지" 는 소비자 구현 뒤 확인 |
| `PARTIAL` 배너 | ✅ "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)" + `recommendationBasis: RULES_ONLY` `QWEN_UNAVAILABLE`, 우측 "Qwen 서버 미접속" |
| 1440·1280 두 폭 | ✅ 넘침·잘림 없음 ([s-live-detail-1440.png](s-live-detail-1440.png), [1280](s-live-detail-1280.png)) |
| 갈래가 `run-modes.md` 와 같다 | ✅ "API 정상·GPU 불가" |

## 하지 않은 것·남은 것

- 첨부 다운로드(`G2bAttachmentFetcher`)·MinIO 저장·gateway `/parse`·`AttachmentTextReader`·documents 큐 소비자: 없음(C3 잔여). 이번 범위에 넣지 않았다.
- `pnpm check:env` live 판정(위), `/admin/sources` 호출량 화면, Redis 호출 예산 카운터(`quota:{serviceId}:{YYYYMMDD}`)·90% 중단: 없음. 호출 수는 run 단위 `ingest_runs.quota_used` 로만 센다.
- 화면 녹화: 없음(스크린샷 4장만).
- `KEV_UNAVAILABLE` 을 같은 run 에 남기려면 worker 가 추출 없이도 `/kev` 를 불러야 하는데 03 §5.6·§8 과 부딪힌다(사람 결정). 대신 gateway 기동 로그·`/health` `kev.registryMatch: null` 로 Kev 미접속을 남겼다.
- 실제 공고의 보조 응답 필드 가정(`lcnsLmtNm` "이름/4자리코드", `prtcptPsblRgnNm`, `eorderAtchFileUrl`)은 10-19 녹음 4파일 기준이고 이번 실호출 86건에서 오류 0 이었다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `started-at.txt`·`worker-started-at.txt` | 시작 시각 |
| `compose-ps-before-worker.txt` | redis·minio·qdrant·ai-gateway healthy |
| `gateway-health.json`·`gateway-startup.log`·`gateway-log.txt` | gateway `/health`, unreachable 로그, `/extract`·`/explain` 요청 로그(해시 가림) |
| `web-health-ready.json` | web `/health/ready` |
| `ingest-run-live.json`·`live-bids.txt`·`structured-requirements-count.txt` | live run 요약, 적재된 실공고 86건 목록(공고번호·제목·발주기관·예산·마감·구조화 자격 수·첨부 수), 구조화 자격 집계·오류 0 |
| `score-run-live.json`·`worker-log.txt` | S-LIVE run 행, worker `analysis.completed` 로그 |
| `s-live-list-1440.png`·`s-live-list-1280.png`·`s-live-detail-1440.png`·`s-live-detail-1280.png` | 화면 |

서비스키·Supabase 키·담당자 개인정보는 어느 파일에도 없다(security-auditor 점검).
