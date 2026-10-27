---
title: "첨부 처리 구현 — 실공고 첨부 내려받기·파싱·분석 연결"
status: done
tags: [sol-radar, evidence, ingestion, documents, analysis]
updated: 2026-10-27
---

# 첨부 처리 구현 (2026-10-27)

브랜치 `feat/attachment-worker`(main `43e4e024` 기준)의 변경을 운영 DB·회사 서버·나라장터·유료 모델 없이 확인한 기록이다. 회사 기동·실다운로드·실파싱은 하지 않았다(통합 때 메인 세션이 확인한다).

## 끊겼던 곳

- 나라장터 목록 정규화는 본문을 비운다(`normalize-g2b.ts` `content = ""`, 의도). 실공고 분석의 근거는 첨부뿐이다.
- `documents` 큐에 소비자가 없었다. 실사이트 첨부 다운로더가 없었고 `uploadImmutable`을 부르는 운영 코드가 없었다.
- 분석 runtime이 `EMPTY_ATTACHMENT_READER`를 썼고 `ANALYSIS_READS_ATTACHMENT_TEXT = false`라 본문 없는 실공고는 `409 ANALYSIS_SOURCE_MISSING`이었다.
- 운영 DB(10-27 메인 세션 확인): 실공고 553건, 첨부 1,975행 모두 `download_status = PENDING`(hwpx 697·pdf 650·hwp 449·xlsx 84·zip 28·docx 13).

## 바꾼 것

| 영역 | 파일 |
| --- | --- |
| DB 함수 | `supabase/migrations/20261027000500_document_processing_lease.sql`(새), `web/lib/database.types.ts`(생성물), `scripts/database.test.mjs` |
| 다운로더 | `web/server/ingestion/g2b-attachment-fetcher.ts`(새)·`.test.ts`, `web/server/ingestion/index.ts` |
| /parse 클라이언트 | `web/server/analysis/gateway.client.ts`(공용 호출기 `createCaller` + `createParseClient`), `gateway.model.ts`(`parseResponseSchema`·`readParseConfig`), `index.ts` |
| 처리 범위·저장 port·텍스트 reader | `web/server/documents/document-selection.model.ts`·`document-processing.model.ts`·`document-processing.repo.ts`·`document-text.repo.ts`(새)·`document-text.repo.test.ts`, `index.ts` |
| documents worker | `web/worker/documents-job.ts`(새)·`.test.ts`, `web/worker/documents-only-main.ts`(새)·`.test.ts`, `web/worker/main.ts`, `web/worker/documents-reconcile.ts`, `web/worker/document-storage.ts` |
| 분석 연결 | `web/worker/analysis-runtime.ts`, `web/server/analysis/analysis-store.model.ts`(`ANALYSIS_READS_ATTACHMENT_TEXT = true`), `web/server/bids/analysis-readiness.model.ts`·`bids.supabase.ts`(주석) |
| readiness 시험 | `web/server/bids/analysis-readiness.test.ts`·`analysis-readiness.repo.test.ts`, `web/app/api/v1/redis-gateway-contract.test.ts`, `web/app/api/v1/_lib/fake-session.ts`(`in`·`not is null` 흉내) |
| 회사 실행 | `infra/compose.documents-only.company.yaml`(새), `infra/company/README.md` §8 |

## 설계 요점

### 처리 범위 상한

- live의 실제 공고(`is_demo = false`), 최신 revision, `OPEN`·`AMENDED`, 마감 전(마감 없음 포함)만 다룬다.
- 이름이 `.pdf`·`.hwp`·`.hwpx`인 첨부만 받는다. xlsx·zip·docx는 받지 않고 `PENDING`으로 남긴다. 받은 뒤 매직 바이트가 파서 형식이 아니면 gateway에 보내지 않고 `UNSUPPORTED`·`UNSUPPORTED_FORMAT`(parser `none`)으로 끝낸다.
- 공고마다 우선순위(공고서·공고문·제안요청서·과업지시서·입찰공고·RFP → 규격서·과업·설명서 → 기타 → 서식·서약서 등 양식) 상위 N건만 받는다. 같은 정렬이 분석 입력 순서다.

| env | 기본 | 범위 | 근거 |
| --- | --- | --- | --- |
| `DOCUMENTS_MAX_PER_BID` | 3 | 1~20 | 공고당 첨부 평균 3.6건, 본문 문서는 보통 3건 안. Qwen 입력 예산이 12,000자 근사라 뒤 문서는 거의 쓰이지 않는다 |
| `DOCUMENTS_ROUND_MAX_REVISIONS` | 10 | 1~100 | 60초마다 최대 10공고 × 3건 = 30건. 2초 간격이면 분당 30건이라 넣는 속도와 받는 속도가 같다 |
| `DOCUMENTS_FETCH_INTERVAL_MS` | 2000 | 500~60000 | 나라장터 웹 서버에 초당 0.5건 이하 |
| `DOCUMENTS_CONCURRENCY` | 2 | 1~2 | gateway `/parse`는 파서 하위 프로세스를 동시 2개까지 띄운다 |
| `DOCUMENTS_LEASE_SECONDS` | 600 | 60~3600 | 한 단계(내려받기 30초 + Storage, 또는 `/parse` 185초 × 재시도 1회)를 덮는다 |
| `PARSE_TIMEOUT_MS` | 180000(+5000) | 1~3600000 | 파서 처리 90초 + 자리 대기 90초. `/extract` timeout을 쓰지 않는다 |
| `ANALYSIS_ATTACHMENT_MAX_CHARS` | 200000 | 1000~2000000 | 15 §5.2 인용 검증의 문서 길이 기준 |
| `ANALYSIS_ATTACHMENT_TOTAL_CHARS` | 600000 | 1000~2000000 | 3건 × 200,000자. gateway `/extract` 문자열 상한 2,000,000자 안 |

### 다운로더(`createG2bAttachmentFetcher`)

- 허용 목록(`https`·`www.g2b.go.kr`·`/pn/`·포트·userinfo 없음)을 통과한 URL만 요청한다. 리다이렉트는 매번 같은 목록으로 다시 보고 최대 3회다. 같은 호스트의 `login`·`sso` 경로면 `AUTH_REQUIRED`다.
- `node:https` + 직접 넣은 `lookup`: DNS 결과에 공인 주소가 아닌 것이 섞이면 연결 전에 끊고(`HOST_NOT_ALLOWED`), 확인한 주소로만 연결한다(DNS rebinding). `agent: false`라 요청마다 다시 확인한다.
- 리다이렉트를 포함해 30초(`TIMEOUT`), 선언 크기·받는 양이 50 MiB를 넘으면 그 순간 연결을 끊는다(`TOO_LARGE`). 빈 200은 `HTTP_5XX`다. 형식은 매직 바이트, sha256은 받은 본문으로 정한다.
- 기록하는 사유는 화면 계약의 일곱 값뿐이다(`NOT_FOUND`는 쓰지 않는다).

### documents job

- 문서마다 DB 리스(`claim_document_processing`)를 잡고 단계(내려받기 뒤·파싱 전·저장 전)마다 다시 잡아 늘린다. 다른 시도가 잡고 있으면(`BUSY`) 그 리스가 끝나는 시각으로 job을 옮긴다(`moveToDelayed` + `DelayedError`, 시도 횟수를 쓰지 않는다). 리스를 잃으면 그 문서는 쓰지 않는다. 실패 기록 함수도 리스 소유를 확인한다.
- 원본: `uploadImmutable(raw)` → `finish_document_storage`가 다운로드 `OK`·파싱 `PENDING`. 이미 원본이 있으면 Storage에서 다시 읽고 sha256을 확인한다(`readRaw`, 나라장터를 다시 부르지 않는다).
- 파싱: `PARSED`·`PARTIAL`이면 텍스트 객체(`sol-radar/parsed-document/v1`, 원본 해시·문서 id 포함)를 `bid-parsed`에 확정한다. HWP·HWPX는 `pages`가 비어 `page_count = null`이다. 성공인데 글자가 없으면 `FAILED`·`PARSER_ERROR`(`EMPTY_TEXT`)다.
- 재시도: 나라장터 `TIMEOUT`·`HTTP_5XX`와 파서 `FAILED`·`PARSER_ERROR`는 던져 BullMQ 재시도(attempts 3, 지수 백오프 2초)에 맡기고 마지막 시도에 `FAILED`로 남긴다. 영구 다운로드 사유, `UNSUPPORTED` 전부(`NO_TEXT_LAYER`·`ENCRYPTED`·`DISTRIBUTION_PROTECTED`·`TOO_LARGE`), `FAILED`·`CORRUPTED`, gateway 4xx·계약 위반 응답은 바로 남긴다.
- 우리 쪽이 준비되지 않은 경우(Storage·DB 오류, gateway 접속·timeout·5xx·breaker, `PARSER_NOT_CONFIGURED` 경고)는 기록하지 않고 10분씩 최대 12번 미룬다. 그 뒤에는 `PENDING`으로 두고 job을 끝낸다.
- 문서 하나의 실패는 그 문서에만 남고 다음 문서를 계속 처리한다. 범위 밖·옛 jobId·revision 재생성·행 없음은 문서를 잡지 않고 끝낸다.
- 로그는 문서 id·결과 코드만 싣는다(`documents.job`). 첨부 이름·URL·본문은 싣지 않는다.

### 복구 회차와 실행 위치

- 복구 회차(60초)를 ingest 등록에서 documents 등록으로 옮겼다. live는 소비자 + `document_processing_candidates` 복구(회차당 10 revision), mock·fixture는 소비자 없이 예전 복구(데모 공고, 100건)만 돈다. 데모 첨부를 처리하면 `attachmentsIncomplete`가 붙어 골든이 바뀌므로 처리하지 않는다.
- 회사에서는 `web/worker/documents-only-main.ts`(live 강제, `--check`)가 documents 등록 하나만 돈다. ingest 전용 Worker(재시작 금지)와 analysis 전용 Worker는 건드리지 않는다.
- `infra/compose.company.yaml`이 아니라 `infra/compose.documents-only.company.yaml`(프로젝트 `sol-radar-documents`)에 두었다. README §7.11이 `sol-radar-gateway` 프로젝트의 `up`을 금지하고, ingest 전용과 같은 배치이기 때문이다(지시와 다르다).
- 전체 Worker와 함께 떠도 같은 첨부를 두 번 처리하지 않는다(문서 리스, jobId 중복 제거). 나라장터 간격은 프로세스마다 따로라 README가 함께 띄우기를 금지한다.

### 첨부 텍스트 reader(`createAttachmentTextReader`)

- revision의 첨부를 우선순위 순으로 돌려준다. `PARSED`·`PARTIAL`이고 텍스트 키가 설정한 `bid-parsed` 버킷을 가리킬 때만 읽는다.
- 문서당 상한으로 앞에서 자르고(서로게이트 쌍을 가르지 않는다, 자른 뒤에 시작하는 쪽은 뺀다) 전체 상한을 넘는 문서는 뺀다.
- 텍스트 객체가 계약과 다르면(JSON·schema·문서 id·원본 해시 불일치) 넣지 않고 그 문서를 `FAILED`·`PARSER_ERROR`로 보여 첨부 문제로 드러낸다(DB는 바꾸지 않는다).
- 근거 로그: `{"event":"analysis.attachments","revisionId",…,"included":[{documentId,chars,truncated}],"omitted":[{documentId,reason}]}`.
- `PENDING` 행은 빈 reader와 같은 결과(문제 없음, 텍스트 없음)라 데모 골든 입력이 바뀌지 않는다.

## 새 migration과 권한

`20261027000500_document_processing_lease.sql`. 다섯 함수 모두 `security invoker`, `search_path = ''`, `public`·`anon`·`authenticated`에서 실행 권한을 빼고 `service_role`만 연다. 표·열·제약은 바꾸지 않는다(`20261021000700`의 `processing_attempt_id`·`processing_lease_until`을 처음 쓴다).

| 함수 | 하는 일 |
| --- | --- |
| `claim_document_processing(doc, attempt, lease초 30~3600)` | 처리 대기 행만, 리스가 없거나 끝났거나 같은 시도면 잡는다. `MISSING`·`DONE`·`BUSY(leaseUntil)` |
| `fail_document_download(doc, attempt, code, message)` | 일곱 사유만. 리스 소유 + 다운로드 `PENDING`일 때만 `FAILED`, 리스 해제 |
| `fail_document_parse(doc, attempt, UNSUPPORTED·FAILED, code, parser, message)` | 리스 소유 + 다운로드 `OK`·파싱 `PENDING`일 때만 |
| `release_document_processing(doc, attempt)` | 그 시도의 리스만 푼다 |
| `document_processing_candidates(is_demo, after, limit≤100, max_per_bid≤20)` | 최신 revision·접수 중·마감 전, 파서 형식 처리 대기 첨부가 있고 끝난 파서 형식 첨부가 상한보다 적은 revision |

정책 시험 3개를 `scripts/database.test.mjs`에 더했다(리스 BUSY·만료 인계·만료된 시도의 기록 거부·사유 코드 거부, 처리 대상 필터·공고당 상한, `anon`·`authenticated` 실행 거부).

## 시험(ADR-046 핵심만)

| 파일 | 본 것 |
| --- | --- |
| `g2b-attachment-fetcher.test.ts` | 허용 목록 밖 URL은 요청하지 않음, 외부 호스트 리다이렉트 차단·로그인 경로 `AUTH_REQUIRED`, 50 MiB 넘는 순간 중단(51번째 조각에서 닫음), 같은 호스트 리다이렉트 뒤 매직 바이트·sha256 |
| `documents-job.test.ts` | 성공(상한·우선순위·양식/xlsx 제외·텍스트 객체 계약), 다운로드 실패(영구 즉시·일시 재시도 후 마지막 시도 FAILED·다른 문서 계속), 파싱 실패(UNSUPPORTED 즉시·gateway 불가 미룸·PARSER_ERROR 재시도 후 FAILED·원본 재사용), 리스 만료 재처리, 범위 밖·옛 jobId |
| `document-text.repo.test.ts` | 우선순위 순서, 문서당·전체 상한과 쪽 오프셋, 근거 로그, 계약 위반 객체·전체 상한 초과 제외 |
| `documents-only-main.test.ts` | mock 모드·범위 밖 설정이면 연결 없이 exit 1, 값 미출력 |
| readiness 3곳 | 본문 없음 + PARSED·PARTIAL 첨부 → 분석 가능(202), 미파싱·미저장 첨부만 → 409 |

변형 확인: 일시 다운로드 재시도 조건 반전, 파서 미설정 판정 제거, BUSY 미룸 제거를 각각 넣으면 해당 시험이 실패했다(원복 확인).

DNS 차단 확인(외부 호출 없음): 기본 전송으로 `https://localhost:9/pn/x`를 부르면 `BlockedAddressError`로 연결 전에 끊긴다.

## 실행한 검사

| 명령 | 결과 |
| --- | --- |
| `node --test --test-name-pattern="documents job" scripts/database.test.mjs` | 3 pass, 0 fail |
| `pnpm -C web exec vitest run` 새·바꾼 시험 7개 파일(다운로더 4·job 5·reader 2·진입점 2·readiness 29) | 모두 통과 |
| `pnpm -C web type-check` | exit 0 |
| `pnpm verify:changed`(슬롯) | exit 0 — 루트 format·node 시험 233·DB 타입 일치, web verify:quick(format·type·lint·lint 가드·vitest 84 파일 739·lodestar·토큰·색), services/ai 153, services/decision 57 |
| `pnpm verify`(슬롯, 빌드 포함) | exit 0 — 같은 검사 + `next build` 성공 |

## 못 한 것

- 회사 기동, 나라장터 첨부 실다운로드, 실파서 `/parse` 호출, 운영 DB 적용(`db:push`)은 하지 않았다.
- 격리 Supabase·Redis 통합 실행(실제 BullMQ·Storage로 documents job 한 바퀴)은 하지 않았다(미실행). 상태 전이는 가짜 DB·Storage·gateway 시험과 PGlite 정책 시험으로만 봤다.
- 회사 Analysis Worker 이미지(`sol-radar-ai-worker-worker:latest`, 회사 운영 원본) 교체 방법은 정하지 않았다(README §8.6, 승인 필요).

## 알려진 한계·후속

- 추출 캐시 키가 `(revision_id, model_name, prompt_hash)`라 첨부가 일부만 파싱된 때 분석하면 그 추출이 뒤에 파싱된 첨부가 생겨도 재사용된다. 계획 2026-10-21 §8.4의 `source_hash`(입력 문서 집합) 키가 필요하다.
- 파서를 바꾸면 parserId가 바뀌어 텍스트 객체 경로(`…/{sha256(parserId)}/result.json`)가 새로 생긴다. 이미 `PARSED`인 문서는 다시 파싱하지 않는다(재파싱 절차 없음). 옛 객체는 참조가 바뀔 때 Storage 정리가 지운다.
- 상한 밖·xlsx·zip·docx·마감 지난 공고의 첨부는 `PENDING`으로 남는다. 07 계약("끝내기 전 모든 행을 PENDING 밖으로")과 다르다.
- Storage·gateway 장애가 2시간을 넘으면 그 revision은 jobId 보존(1일) 뒤에야 다시 들어온다.
- documents 전용 Worker에는 의존성 보고·Storage 정리(10분)가 없다. 회사에서 고아 객체 정리를 돌릴 곳이 정해지지 않았다.
- 나라장터 이용약관상 자동 다운로드 제한은 여전히 미확인이다(07 §2.4).
