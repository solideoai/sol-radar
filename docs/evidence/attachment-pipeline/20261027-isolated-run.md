---
title: "첨부 처리·가입 동의 격리 실동작 확인 (2026-10-27)"
status: done
tags: [sol-radar, evidence, documents, analysis, auth, isolated]
updated: 2026-10-27
---

# 첨부 처리·가입 동의 격리 실동작 확인 (2026-10-27)

통합 worktree `integration-1027`(브랜치 `integration/blockers-1027`, main `43e4e024` + 미커밋 변경)을 격리 로컬 스택에서 실제로 돌린 기록이다. 운영 반영 승인 전 근거로 쓴다. 코드·설정·시험 파일은 고치지 않았다. 구현 기록은 [[20261027-implementation|첨부 처리 구현]], 파서 실표본은 [[20261027-parser-check|파서 실표본 확인]], 가입 동의 수정은 [[20261027|live 가드 검증]]이다.

## 결과 요약

| 항목 | 결과 | 근거 |
|---|---|---|
| A1 documents 전용 Worker 실처리(HWP·PDF·HWPX) | 통과 | 3건 모두 `OK`·`PARSED`, 원본·텍스트 객체 확정, 리스 해제 |
| A2 처리 범위(xlsx 제외) | 통과 | xlsx 행은 요청 0회, `PENDING` 그대로 |
| A3 멱등(같은 job 다시 넣기) | 통과 | 같은 jobId 재등록은 중복 제거, 완료 job 을 지우고 다시 넣어도 처리 대상 0건, 나라장터 요청 수 3 그대로 |
| A4 허용 목록 밖 URL | 통과 | `FAILED`·`HOST_NOT_ALLOWED`, 외부 요청 0회 |
| A5 분석 준비(readiness) | 통과 | 본문 없는 A·B 공고 `ready: true`, C 공고 `SOURCE_TEXT_MISSING`·분석 요청 409 |
| A6 첨부 텍스트가 `/extract` 에 들어가는가 | 통과 | `analysis.attachments` 로그 + `/extract` 요청 본문 모양 기록(첨부 2건 17,103·17,299자) |
| A7 분석 결과 | 기록만(기대하지 않음) | mock gateway 는 fixture 없는 공고를 추출하지 못해 `PARTIAL`·`EXTRACTION_FAILED`·`RULES_ONLY`, 점수 68 `WATCH` |
| A8 live Worker 의 공공 API·카카오 호출 | 0회 | 프로세스 감시(아래)에 g2b 첨부 3건 말고 외부 요청 없음 |
| B1 가입 화면 1440·1280 | 통과 | 스크린샷 2장, 가로 넘침 0px, 콘솔 오류 0 |
| B2 필수 동의 셋 체크 후 가입 → `user_consents` | 통과 | 행 생성(필수 셋 시각 있음, 마케팅 null), 확인 메일 1통 |
| B3 필수 하나 빠진 직접 가입 요청 | 통과(거절) | 3가지 모두 HTTP 500 `unexpected_failure`, auth 로그 `consent_required (SQLSTATE 22023)` 3건, 계정 미생성 |
| 카카오 live 가드(`notify-outbox.ts`) | 미실행 | 이번 범위 밖. 알림 Worker 는 띄우지 않았다 |

나라장터 실다운로드는 **3건**이다(허용 6건 안). 리다이렉트 0회.

## 환경

| 부분 | 값 |
|---|---|
| Supabase | 격리 로컬 스택 `sol-radar-att1027`(API 127.0.0.1:53421, DB 53422, shadow 53420, 메일함 53424·53425). 작업 폴더는 scratchpad 의 복사본(`migrations` 62개·`templates` 그대로, `config.toml` 은 project_id·포트·`site_url`·studio 끔만 바꿈). 저장소 `supabase/config.toml` 은 고치지 않았다 |
| 끈 서비스 | imgproxy·studio·postgres-meta·logflare·vector·supavisor·realtime·edge-runtime |
| Storage | `node scripts/storage-local-buckets.mjs`(격리 대상 env 두 개)로 `bid-documents`·`bid-parsed`·`profile-photos` 생성, 셋 모두 `public = false` |
| Redis | 일회용 컨테이너 `sol-radar-att1027-redis`(redis:7.4-alpine, 127.0.0.1:6537, 비밀번호는 격리용 임의 값, 저장 끔) |
| AI gateway | `services/ai/.venv` 로 `Settings → create_app → uvicorn` 을 127.0.0.1:8537 에 띄움(`__main__` 은 포트가 8000 고정이라 다른 스택과 겹친다). `SOL_RUN_MODE=mock`·`DEMO_MODE=true`·`AI_PROVIDER=mock`·`KEV_ENABLED=true`, 셸 env 는 `env -i` 로 비웠다. `/health` 의 `parsers`: `pdfplumber@0.11.10`·`sol-hwpx@1`·`sol-hwp5@1+olefile@0.47` |
| documents Worker | `node --conditions=react-server --import tsx worker/documents-only-main.ts`(web 폴더). `SOL_RUN_MODE=live`, `REDIS_URL`·Supabase URL·service role·`AI_GATEWAY_URL` 만. 공공 API 키·카카오 키 없음. 처리 설정은 기본값(공고당 3건·회차당 10·간격 2000ms·동시 2·리스 600초) |
| analysis Worker | `worker/analysis-only-main.ts`, `SOL_RUN_MODE=mock`(gateway 와 같게 두어 `runModeMismatch: false`) |
| web | `next dev`(Next.js 16.4.2) localhost:3537, `SOL_DEPLOYMENT_ROLE=standalone`·`SOL_RUN_MODE=mock`·`SOL_INGEST_MODE=live`·`SOL_DEFAULT_ORIGIN=live`. anon 키만 넘김 |
| 계정 | `demo:reset`(격리용 임의 비밀번호, 셸 env 로만 전달) — `seed: orgs=2 users=5 … bids=19 quarantined=1 … isDemo=true` |
| 키 | 모두 `supabase status`(저장소 `scripts/local-test-target.mjs`)에서 읽어 자식 프로세스 env 로만 넘겼다. 이 문서·로그에 적지 않았다. `.env` 파일은 만들지도 읽지도 않았다 |

### 외부 호출 감시

Worker·시드·분석 프로세스에 scratchpad 의 preload(`--import net-guard.mjs`)를 붙였다. `fetch`·`http(s).request` 를 감싸 127.0.0.1·localhost 만 통과시키고, `www.g2b.go.kr` 은 지시받은 첨부 URL 세 개(정확한 주소)만 누적 6회까지 통과시키며, 나머지는 요청 전에 막고 기록한다. 저장소 코드가 아니다.

| 프로세스 | 외부 요청 |
|---|---|
| documents Worker | g2b 첨부 3건(전부 HTTP 200, 리다이렉트 없음). 막힌 요청 0 |
| 시드·멱등·객체 확인·analysis Worker | 0 |
| web(`next dev`, `NODE_OPTIONS` 로 같은 preload) | `registry.npmjs.org` 2회를 막음(Next dev 의 버전 확인). 그 밖 0 |
| 브라우저(Playwright) | localhost 밖 요청 0(가입 화면의 카카오 우편번호 스크립트는 주소 검색을 열 때만 불러 이번에는 요청이 없었다) |

## A. 첨부 파이프라인

### 데이터 넣기(실제 수집 경로)

scratchpad 스크립트가 `runIngest`(실제 `normalizeG2bBidNotice` → `decideRevision` → `createSupabaseIngestionRepo.saveRevision` = RPC `ingest_save_revision`)를 메모리 connector 로 불렀다. 응답 행은 녹음 파일(`fixtures/recorded/15129394/getBidPblancListInfoServc.20261019.masked.json`)의 열 집합만 빌리고 값은 모두 비운 뒤 채웠다(제목·기관은 가상, 마감 2026-11-20 10:00 KST). 보조 조회·예산은 넘기지 않았다(녹음 재생과 같은 조건). 저장 뒤 live ingest job 처럼 첨부가 있는 revision 마다 `enqueueDocuments` 로 documents job 을 넣었다.

| 공고 | 첨부(`ntceSpecFileNm`/`ntceSpecDocUrl`) | 저장 결과 |
|---|---|---|
| A `R26BK01789921` | `(공고서) 격리 확인 A.hwp`(fileSeq=1), `가격 산출 내역서 A.xlsx`(fileSeq=2), `(공고서) 격리 확인 A.pdf`(fileSeq=4) | 첨부 3행 `PENDING` |
| B `R26BK01789896` | `(공고서) 격리 확인 B.hwpx`(fileSeq=1) | 첨부 1행 `PENDING` |
| C `ATT1027-ISO-C`(가상) | `https://files.attacker.invalid/pn/notice.pdf` | 정규화가 URL 을 빼고 `ingest_errors` 에 `ATTACHMENT_URL_BLOCKED` 1건, 첨부 0행. 그 뒤 같은 URL 의 행을 `bid_documents` 에 직접 1행 넣었다(Worker 의 2차 방어 확인용. 실제 수집으로는 들어오지 않는다) |

- run `SUCCEEDED`, `created 3`, 격리 0. 공고 행: `source = g2b-bid-notice`, `is_demo = false`, `status = OPEN`, `stage = NOTICE`, 정규화 본문 길이 0. `outbox_events` 에 `BID_CREATED` 3건(알림 Worker 는 띄우지 않았다).
- 처리 전 `document_processing_candidates(false, nil, 100, 3)` = 3 revision.

### documents Worker 처리

`--check` 는 live 에서 exit 0(설정 네 줄), `SOL_RUN_MODE=mock` 이면 `documents 전용 worker 는 SOL_RUN_MODE=live 에서만 실행한다` 로 exit 1.

기동 로그(발췌, `documentId` 만 있고 이름·URL·본문 없음):

```text
{"event":"documents.enabled","maxPerBid":3,"roundMaxRevisions":10,"fetchIntervalMs":2000,"concurrency":2,"leaseSeconds":600}
{"event":"documents.reconcile","checked":3,"queued":3,"failed":0,"nextCursor":null}
{"event":"documents.job",…,"revisionId":"79fc1146-…","documents":[{"documentId":"be4ebf81-…","outcome":"PARSED"}]}
{"event":"documents.job",…,"revisionId":"dca849d1-…","documents":[{"documentId":"d615c27b-…","outcome":"DOWNLOAD_FAILED","detail":"HOST_NOT_ALLOWED"}]}
{"event":"documents.job",…,"revisionId":"42b567f4-…","documents":[{"documentId":"f61d491b-…","outcome":"PARSED"},{"documentId":"da8f67cb-…","outcome":"PARSED"}]}
```

나라장터 요청은 46.29초·48.29초·50.29초(UTC 02:40)에 나갔다. 프로세스 안 간격 2초가 지켜졌다.

처리 뒤 `bid_documents`:

| 첨부 | download | parse | format·mime | 크기 | page_count | parser_id | 리스 |
|---|---|---|---|---|---|---|---|
| A.hwp | `OK` | `PARSED` | HWP · `application/x-hwp` | 115,200 | null | `sol-hwp5@1+olefile@0.47` | 해제(null) |
| A.pdf | `OK` | `PARSED` | PDF · `application/pdf` | 351,326 | 22 | `pdfplumber@0.11.10` | 해제 |
| B.hwpx | `OK` | `PARSED` | HWPX · `application/hwp+zip` | 400,687 | null | `sol-hwpx@1` | 해제 |
| A.xlsx | `PENDING` | null | — | — | — | — | 잡지 않음 |
| C.pdf | `FAILED`(`HOST_NOT_ALLOWED`) | null | — | — | — | — | 해제 |

- `parse_quality.charCount`: HWP 17,103 · PDF 17,299 · HWPX 13,635(표 14·21·1개). [[20261027-parser-check|파서 실표본]]의 같은 첨부 숫자와 같다. `partialReasons` 는 셋 다 비었다.
- 원본 확정→파싱 저장까지: HWP 0.49초, HWPX 0.30초, PDF 2.15초(`uploaded_at`·`parsed_at`).
- 객체 키 모양: `raw/bids/<bid>/<revision>/<storage id>/<sha256>.<ext>`, 텍스트는 `parsed/bids/<bid>/<revision>/<원본 sha256>/<sha256(parserId)>/<storage id>/result.json`. `storage.objects`: `bid-documents` 원본 3개(+ 소유 표식 1), `bid-parsed` 텍스트 3개(84,062·91,384·44,557 B, + 표식 1). `document_storage_objects` 6행.
- Storage API 로 다시 내려받아 확인(scratchpad `check-objects.mts`): 원본 sha256·크기가 행과 같다. 텍스트 객체는 `parsedDocumentSchema` 통과, `schemaVersion = sol-radar/parsed-document/v1`, `documentId`·`rawSha256`·`parserId` 가 행과 같다. `pages` 는 PDF 22, HWP·HWPX 0(→ `page_count` null).
- 처리 뒤 `document_processing_candidates` = 0 revision. 이후 60초 복구 회차 8번 모두 `checked 0, queued 0`. heartbeat 파일 갱신 2초 전.
- 같은 문서에 `claim_document_processing` 을 직접 부르면 `{"claimed": false, "reason": "DONE"}`.

### 멱등

scratchpad `idempotency.mts`(격리 Redis 의 A job 만 다룸):

| 단계 | job 상태 | 처리 결과 | 나라장터 요청 누계 |
|---|---|---|---|
| 처음 | completed(processedOn …846260) | 문서 2건 `PARSED` | 3 |
| 같은 jobId 로 `enqueueDocuments` 다시 | completed, processedOn 그대로 | 다시 돌지 않음(BullMQ 중복 제거) | 3 |
| 완료 job 을 지우고 같은 jobId 로 다시 | completed(새 processedOn …921012) | `{"status":"DONE","documents":[]}`(처리할 문서 없음) | 3 |

### 분석 준비와 첨부 텍스트 reader

analyst 계정(데모 seed)으로 로그인해 web API 를 불렀다(scratchpad `web-readiness.mjs`, 토큰은 출력하지 않음).

| 공고 | `GET /api/v1/bids/:id` | `documentsStatus` | `POST /api/v1/bids/:id/analyses` |
|---|---|---|---|
| A | 200, `analysisReadiness {ready: true, reason: null}` | total 3 · parsed 2 · pending 1(xlsx) | 202 `QUEUED` |
| B | 200, `ready: true` | total 1 · parsed 1 | 요청하지 않음 |
| C | 200, `ready: false, reason: SOURCE_TEXT_MISSING` | total 1 · downloadFailed 1 | 409 `ANALYSIS_SOURCE_MISSING`(`공고 본문 미확보 · 분석 준비 중`) |

화면(1440, analyst): B 상세는 `분석 실행` 이 켜져 있고 미확보 안내가 없다. C 상세는 `분석 실행` 이 꺼지고 `공고 본문 미확보 · 분석 준비 중`, 첨부 상태에 `DOCUMENT_DOWNLOAD_FAILED HOST_NOT_ALLOWED` 가 보인다. A 상세는 분석 뒤 `부분 완료 (규칙만)`·`EXTRACTION_FAILED` 와 `재분석` 이 보인다. 스크린샷: `20261027-isolated-bid-B-1440.png`·`-C-1440.png`·`-A-1440.png`(이 폴더).

analysis Worker 로그(A 분석):

```text
{"event":"analysis.attachments","revisionId":"42b567f4-…","included":[{"documentId":"f61d491b-…","chars":17103,"truncated":false},{"documentId":"da8f67cb-…","chars":17299,"truncated":false}],"omitted":[]}
{"event":"analysis.completed",…,"status":"PARTIAL","errorCode":"EXTRACTION_FAILED","recommendationBasis":"RULES_ONLY","settingsSource":"HEALTH","runModeMismatch":false,"elapsedMs":245}
```

- `analysis.attachments` 는 job 마다 두 번 찍힌다(loader 와 추출이 같은 revision 을 읽는다. 코드 주석대로 두 번째는 캐시).
- 두 번째 분석(`force: true`)에서 preload 가 `/extract` 요청 본문의 모양만 기록했다: 77,454 B, `body` 0자, `attachments` 2건 `[{documentId: f61d491b…, text: 17,103자, pages: 0}, {documentId: da8f67cb…, text: 17,299자, pages: 22}]`. 첨부 텍스트가 그대로 `/extract` 에 들어갔다(본문 문서 순, 자름 없음).
- gateway 는 `/extract` 200 → mock 추출 실패, `/explain` 200. `/kev` 는 부르지 않았다. `score_runs`: `PARTIAL`·`EXTRACTION_FAILED`·`WATCH`·점수 68·`recommendation_basis RULES_ONLY`·`missing_factors {skillMatch,pastPerformance}`·`review_flags {EXTRACTION_FAILED}`, `requirement_extractions` 0행. 실모델(local) 추출은 확인하지 않았다.

## B. 가입 동의

scratchpad `signup.mjs`(저장소 web 의 `@playwright/test` 1.64.1 chromium, 스크립트 실행). 확인 메일 설정(`enable_confirmations = true`)은 바꾸지 않았다. 가입 트리거는 `auth.users` 삽입 때 돌기 때문에 메일 확인 전에도 동의 행이 생긴다. 메일 확인 링크는 열지 않았다.

| 확인 | 결과 |
|---|---|
| `/auth/sign-up` 1440·1280 | HTTP 200, 가로 넘침 0px, 콘솔 오류 0. 스크린샷 `docs/evidence/live-guards/20261027-signup-1440.png`·`-1280.png`(dev 모드라 오른쪽에 Next 표시가 있다) |
| 화면: 필수 둘만 체크하고 제출 | 칸 아래 `만 14세 이상만 가입할 수 있습니다`, `/auth/v1/signup` 요청 0 |
| 화면: 필수 셋 체크(마케팅 안 함)하고 제출 | signup 200, `확인 메일을 보냈습니다…` 안내. `user_consents` 행: 필수 셋 시각 있음, `marketing_agreed_at` null. 프로필의 신고 부서 있음. 메일함에 `가입을 확인해 주세요` 1통 |
| 직접 요청: 부서·직급 키 + consents 없음 | HTTP 500 `unexpected_failure` `Database error saving new user`, 계정 없음 |
| 직접 요청: `age_over_14: false` | 같은 거절, 계정 없음 |
| 직접 요청: `terms: "true"`(문자열) | 같은 거절, 계정 없음 |
| 직접 요청: 필수 셋 + 마케팅 true | 200, `user_consents` 네 시각 모두 있음 |
| auth 컨테이너 로그 | `consent_required (SQLSTATE 22023)` 3건(거절 셋과 같은 수) |
| 계정 수 | 데모 5 → 7(성공 두 건만). `user_consents` 도 5 → 7 |

거절은 GoTrue 가 트리거 예외를 일반 500 으로 바꿔 돌려준다. 클라이언트는 사유(`consent_required`)를 구별할 수 없고, 화면은 이 경우 `가입하지 못했습니다…` 일반 문구를 보인다(화면 검증이 먼저 막으므로 정상 경로에서는 닿지 않는다).

## 찾은 것

결함으로 볼 것은 없었다. 관찰만 남긴다.

1. 복구 회차 로그의 `queued` 는 새로 넣은 job 수가 아니라 넣기를 시도한 수다. 시드가 이미 넣은 A·B job 이 있었는데 첫 회차가 `queued: 3` 이었다(BullMQ 가 같은 jobId 를 버린다. 처리는 한 번).
2. 파서 형식이 아닌 첨부(xlsx)는 계속 `PENDING` 이라 상세의 `documentsStatus.pending` 이 0 이 되지 않는다. 구현 기록의 "알려진 한계"(07 계약과 다름)와 같다. A 상세 화면의 첨부 상태에 xlsx 는 상태 표시 없이 이름만 나온다.
3. `next dev` 가 `registry.npmjs.org` 에 버전 확인 요청을 보낸다(preload 가 막음). 운영(`next start`·Vercel)과 무관하다.

## 한계

- mock gateway 라 첨부 텍스트로 만든 실제 추출·인용 검증은 보지 않았다. 회사 Qwen 연결, 회사 Compose(`infra/compose.documents-only.company.yaml`) 기동, 회사 Analysis Worker 이미지 교체(README §8.6)는 하지 않았다.
- 나라장터 다운로드는 3건뿐이다. 타임아웃·5xx 재시도, BUSY 리스 인계, gateway 장애 때 미룸, 50 MiB 상한은 실환경에서 재현하지 않았다(단위 시험만).
- 첨부 이름은 실제 이름이 아니라 가상이다(우선순위 규칙은 같은 낱말로 맞췄다). 공고 제목·기관도 가상이다.
- 가입: 메일 확인 링크 열기·로그인 뒤 흐름, 간편 가입(OAuth)은 확인하지 않았다.
- 카카오 live 가드는 이번에 실행하지 않았다.

## 정리

끝난 뒤 이 작업이 띄운 것만 PID·이름을 지정해 내렸다. 기본 54321 스택과 다른 세션의 컨테이너·포트(56321·57421·58321·59981·6380·8000 등)는 건드리지 않았다(정리 뒤에도 다른 스택의 `supabase_*` 컨테이너 37개가 그대로 떠 있다).

| 대상 | 방법 | 결과 |
|---|---|---|
| documents Worker | 자식 node 에 SIGTERM | 10초 안에 exit 0. 종료 전 복구 회차 로그 12줄, 처리 뒤 회차는 모두 `checked 0` |
| analysis Worker | 자식 node 에 SIGTERM | exit 0 |
| web `next dev`(3537) | next·next-server 에 SIGTERM | exit 0, 3537 수신 없음 |
| AI gateway(8537) | python 에 SIGTERM | exit 143(SIGTERM), 8537 수신 없음 |
| Redis `sol-radar-att1027-redis` | `docker rm -f` | 컨테이너 없음, 6537 수신 없음 |
| 격리 Supabase `sol-radar-att1027` | `supabase stop --workdir <scratchpad> --no-backup` | 컨테이너·볼륨(`supabase_db_*`·`supabase_storage_*`)·네트워크 0, 53421·53422 수신 없음 |
| `web/.next/dev` | `rm -r`(이번 `next dev` 가 11:42:55 에 만든 개발 캐시, 428 MB, git 무시 대상) | 지움. 앞서 `pnpm verify` 가 만든 `.next` 빌드 산출물은 두었다 |
| scratchpad `att1027/` | `rm -r` | 지움(격리 `config.toml`·마이그레이션 복사본·감시 preload·시험 스크립트·격리용 임의 비밀번호 파일·로그·원본 스크린샷) |

남긴 것은 이 문서와 스크린샷 5장(`20261027-isolated-bid-A·B·C-1440.png`, `live-guards/20261027-signup-1440·1280.png`)뿐이다. 모두 미커밋이다. Docker 이미지(`redis:7.4-alpine`, Supabase 이미지)는 다른 스택도 쓰므로 지우지 않았다.

## 관련 문서

- [[20261027-implementation|첨부 처리 구현]]
- [[20261027-parser-check|첨부 파서 실표본 확인]]
- [[20261027|live 카카오·가입 동의 검증]]
- [[PROGRESS|진행 상황]]
