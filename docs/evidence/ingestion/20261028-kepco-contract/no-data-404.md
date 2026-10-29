---
title: "10-29 KEPCO 공고 없는 날 응답(HTTP 404 NotFound) — 원인과 수정"
doc: "evidence-20261029-kepco-no-data-404"
status: active
tags: [sol-radar, evidence, ingestion, kepco]
updated: 2026-10-29
---

# 10-29 KEPCO 공고 없는 날 응답(HTTP 404 NotFound)

운영 앱 머리 줄에 "수집 실패"가 떴다(2026-10-28 23:36 KST, 45 보고). 원인은 KEPCO 회차 실패였다. 읽기 전용으로 확인한 뒤, 사용자 승인 1회 녹음으로 원인을 확정했다.

## 1. 증상 (운영 DB `ingest_runs`·`ingest_errors` 읽기)

| 시각(KST) | 창(KST) | 결과 |
|---|---|---|
| 10-28 18:20 | 10-27 18:20 ~ 10-28 18:20 | `PARTIAL`, 71건. 10-27 하루 녹음(71건)과 같은 수였다. 10-28 공고는 없었다 |
| 10-28 21:18 | 10-28 18:20 ~ 21:18 | `FAILED`. `kepco:page:start`, `API_HTTP_ERROR`, `RESPONSE_SCHEMA_INVALID`. 원문 저장 없음 |
| 10-29 00:17·03:15·06:14 | 같은 창 다시 씀 | 세 번 모두 같은 오류. 실패한 창은 24시간 안에서 다시 쓴다(`web/worker/ingest-queue.ts`) |
| 10-29 09:25 | 같은 창 다시 씀 | `PARTIAL`, 10-28 공고 64건 생성. quota 누계 5 |

- 같은 21:00 회차의 나라장터·K-water·LH 는 정상이었다. KEPCO 는 큐 맨 뒤라 다른 출처를 막지 않았다.
- Worker 로그에는 `ingest.job.timing` 줄만 있고 응답 원문은 없었다.

## 2. 확인 녹음 (회사 서버, `/data/www/ai_workspace` 안에서만)

처음 승인은 "공고일 10-28 하루 1회"였다. 09:25 재시도에서 10-28 공고가 나와 빈 응답을 볼 수 없게 됐다. 사용자 승인으로 같은 1회를 "공고일 10-29 하루"로 바꿨다.

| 단계 | 결과 |
|---|---|
| 사전 점검(호출 0) | 녹음 스크립트 3개를 회사 저장소(`d171a716`)에서 새 폴더 `sol-kepco-rec-20261029` 로 복사했다. sha256 이 첫 녹음 때와 같았다. 키 `{"kepco":"SET","length40":true}`, dry-run `calls 0` |
| 호출 1회 | 09:26:01 KST. HTTP 404, `text/plain;charset=utf-8`, 35바이트. 판정 `FAILED`(HTTP 404) |
| 사후 점검(호출 0) | 녹음 폴더 전 파일 `keyHits 0`·`apiKeyParam 0`·`email 0`. 운영 Worker 그대로, 일회용 컨테이너 남지 않음 |

녹음은 `errCd` 값을 가렸다(`***`). 원문 sha256 `b8038158…b3a646eb` 와 맞는 본문을 찾아 값을 확인했다.

```json
{"errCd":"404","errMsg":"NotFound"}
```

## 3. 원인

- KEPCO 는 하루치 공고를 다음 날 아침에 올린다. 10-28 공고는 10-29 06:15 ~ 09:25 사이에 처음 나왔다.
- 조회한 날짜에 공고가 없으면 KEPCO 는 HTTP 404 와 위 본문으로 답한다.
- `parseExternalPayload` 는 행 배열(`data`·`items` 등)이 없으면 `RESPONSE_SCHEMA_INVALID` 로 본다. 그래서 같은 날 조회는 다음 날 아침까지 실패했다. 3시간 회차 8번 중 대부분이 실패하고, 공고는 하루 늦게 들어왔다.

## 4. 수정 (사용자 결정 "404 빈 응답 + 3일 앞당김")

- `web/server/ingestion/external-api-connector.ts`: KEPCO 의 HTTP 404 이고 본문이 정확히 위 JSON 일 때만 빈 쪽으로 받는다. 다른 404·다른 본문은 지금처럼 실패다. 빈 쪽은 KEPCO 의 다른 쪽처럼 `PARTIAL` 이다.
- `web/server/ingestion/external-request.ts`: KEPCO 조회 시작일을 창 첫날 앞 3일로 둔다. 404 를 빈 쪽으로 받으면 창이 넘어가므로, 그날 공고가 다음 날(주말이면 월요일) 올라와도 뒤 회차가 받게 한다. 회차당 호출은 1회 그대로이고, 중복은 저장 때 걸러진다.
- 시험: "KEPCO 가 공고 없는 날에 주는 404 NotFound 본문만 빈 쪽으로 받는다"를 더했다. KEPCO 날짜 조각 시험 2개는 앞 3일을 반영했다. 404 허용을 빼면 새 시험이, 앞당김을 0일로 두면 조각 시험 2개가 실패하는 것을 확인했다.
- `infra/sources/registry.yaml` KEPCO 설명에 같은 내용을 적었다.

예상 비용: 회차당 행이 최대 약 3일치(평일 하루 64~71건)로 는다. 첨부 차단 경고(`ATTACHMENT_URL_BLOCKED`)는 중복 행에도 회차마다 남아 하루 수천 행이 쌓일 수 있다. KEPCO 첨부 허용 여부(PROGRESS 결정 대기 6)와 함께 본다.

## 5. 남은 것

- 회사 반영: ingest 이미지 빌드·`--check`·ingest Worker 재생성(정각 +15분 ~ 다음 정각 −30분 창, 사용자 승인 뒤).
- 반영 뒤 첫 회차에서 KEPCO 가 `FAILED` 없이 `PARTIAL` 로 끝나는지, 같은 날 조회가 0건이어도 실패로 세지 않는지 본다.
- 회사 녹음 폴더 `sol-kepco-rec-20261029` 는 사용자 OK 뒤 다른 녹음 폴더와 함께 정리한다.

## 관련 문서

- [[evidence/ingestion/20261028-kepco-contract/first-call|KEPCO 첫 실호출]]
- [[evidence/company-rollout/20261028/sources-rollout|회사 수집 서비스 반영 기록]]
- [[PROGRESS|진행 상황]]
