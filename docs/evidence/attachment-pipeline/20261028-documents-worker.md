---
title: "Documents Worker 기동 판단과 시범·기본 속도 기동 (2026-10-28)"
status: done
tags: [sol-radar, evidence, documents, attachments, prod-readonly]
updated: 2026-10-28
---

# Documents Worker 기동 판단과 시범·기본 속도 기동 (2026-10-28)

## 기동 전 운영 읽기 (17:5x KST)

사용자 승인("9개 모두 실행")으로 Supabase MCP `execute_sql`, SELECT 만. SQL 원문은 09 조사 메모 §7(저장소 밖). Q7 은 원문이 42803(ungrouped column)으로 실패해 같은 뜻으로 고쳐 다시 돌렸다.

| 질의 | 결과 |
|---|---|
| Q1 상태별 | live 첨부 5,562건 전부 `download_status=PENDING`, 오류 0 |
| Q2 대상 | 열린 최신 revision 1,427 · 파서 형식 첨부가 있는 것 1,380 · 처리할 첨부 상한 3: 3,793 / 상한 2: 2,733 / 상한 1: 1,380 · 상한 밖 733 |
| Q3 관련도 | 미분류 1,140 rev(3,123건) · CANDIDATE 183 rev(505건) · RELEVANT 57 rev(165건) |
| Q4 마감 | 3일 이내 159(관련 7) · 3~7일 377(관련 10) · 7~14일 435(관련 115) · 14일 넘음 255(관련 96) · 마감 없음 154(관련 12) |
| Q5 크기 | 받은 첨부 0건(값 없음) |
| Q6 Storage | `bid-documents`·`bid-parsed` 각 1객체 79B(사실상 0) |
| Q7 유입 | 10-26 566공고·첨부 1,736 · 10-27 681·2,090 · 10-28 433·1,259(수집 중) |
| Q8 영상 후보 | 0건(처리된 첨부 없음) |
| Q9 | `score_runs` QUEUED·RUNNING 0 · 허용 목록 밖 URL 0 |
| README §8.1 | 함수 5개 있음 · 버킷 2개 `public=false` · 후보 함수 첫 페이지 100 |

추정(09 메모 처리율 10~24건/분 기준):
- 밀린 3,793건: 약 2.6~6.3시간. 순서가 revision id 라 관련 공고(240 rev·670건)도 그 사이 고르게 끝난다.
- 새 유입: 하루 첨부 약 1,100~1,900건(공고당 상한 3) → 하루 약 0.8~3시간 처리.
- Storage: 원본 0.1~0.4MB 가정 시 밀린 분 약 0.4~1.5GB + 텍스트 약 0.15~0.35GB. 요금제 Pro 이상(사용자 답) → 포함 100GB 안.

## 1단계(시범) 확인 (2026-10-28 18:34 KST)

e3 기동 18:16:42 KST, `DOCUMENTS_ROUND_MAX_REVISIONS=1`, 이미지 `sol-radar-documents-worker:db442be15481`. 약 17분 뒤 Q1·Q5 (사용자 승인 "2단계로 켜기"의 시범 확인).

| 질의 | 결과 |
|---|---|
| Q1 상태별 | 처리 47건: `OK`+`PARSED` 45 · `OK`+`PARTIAL` 1 · `OK`+`UNSUPPORTED`(`UNSUPPORTED_FORMAT`) 1. `FAILED`·`DEFERRED` 0. 남은 `PENDING` 6,462(수집이 이어져 live 첨부가 5,562 → 6,509) |
| Q5 크기 | 47건 평균 375,882B · p50 132,702B · p90 677,066B · 최대 4,652,217B(HWPX) · 합 17.7MB. 형식별 HWP 11(평균 128KB) · HWPX 16(609KB) · PDF 19(315KB) · ZIP 1(514KB) |

판정: 중단 조건(실패 중 `AUTH_REQUIRED`·`HTTP_4XX` 절반 초과, `DEFERRED` 지속, Q5 평균이 한도 계산 초과) 해당 없음. 처리 속도 약 2.8건/분(시범 상한 3건/분). 밀린 처리 대상 3,793건(17:5x 기준) × 평균 376KB ≈ 1.4GB(원본) — Pro 포함 100GB 안. 2단계(기본 속도) 진행.

## 2단계(기본 속도) 기동 (e3 보고)

- 2026-10-28 18:34:28 KST 재생성, 이미지 `sol-radar-documents-worker:db442be15481` 그대로, running·healthy·재시작 0. 사용자 승인은 e3 세션("2단계 승인").
- `documents.enabled`: maxPerBid 3 · roundMaxRevisions 10 · fetchIntervalMs 2000 · concurrency 2 · leaseSeconds 600.
- 첫 두 reconcile: 각각 checked 10 · queued 10 · failed 0.
- 첫 75초: job 6개, 문서 17건(PARSED 16 · PARTIAL 1), FAILED·DEFERRED 0. 다른 Worker 이미지·가동 시간 변화 없음.
