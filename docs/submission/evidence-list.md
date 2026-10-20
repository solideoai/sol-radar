---
title: "실제 AI 검증 증거 목록"
status: draft
tags:
  - sol-radar
  - hackathon
  - submission
updated: 2026-10-20
---

# 실제 AI 검증 증거 목록

"실제 데이터·실제 모델로 돌았다"는 주장을 받칠 증거다. 2026-10-20 기준 1·2번(C1 ①②)은 있고 9번은 mock 리허설 일부가 있다. 나머지 실모델·live 증거는 없음·예정이다. 파일 경로는 [[11-TESTING|11 테스트]] §6과 [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] 증거 규칙을 따른다. 담당 작업 ID는 [수상 전략 계획](../plans/2026-10-18-hackathon-award-plan.md) §4의 C1·C5·C8이다. 증거가 생기면 상태를 "있음(날짜)"으로 바꾸고 `docs/evidence/README.md` 색인에도 넣는다.

| # | 증거 항목 | 무엇을 증명하나 | 예정 파일 경로 | 상태 | 담당 |
|---|---|---|---|---|---|
| 1 | 실제 API 응답 3건(오퍼레이션별, 담당자 이름·전화·이메일 마스킹, 서비스키 든 URL 제외) | 입찰공고 · 사전규격 · 발주계획 · 업종 마스터 4개 서비스의 실제 응답 스키마와 명세 일치 여부 | `docs/evidence/phase-0/external-deps.md` ①, `fixtures/recorded/<service>/<operation>-<n>.masked.json` | 있음(2026-10-19): A1~A9 통과, 마스킹 응답 14파일, [API 호출 증거](../evidence/phase-0/external-deps-api-20261019.md) | C1 ① |
| 2 | 첨부 3건 다운로드 결과(HTTP 상태 · 형식 · 크기 · 로그인 요구 여부) | g2b 첨부 자동 다운로드 가능 여부(16 미결정 16번) | `docs/evidence/phase-0/external-deps.md` ② | 있음(2026-10-19): B1~B4 통과, 3건 익명 GET 200(HWPX·PDF·HWPX) | C1 ② |
| 3 | 회사 GPU 추론 엔드포인트 `GET /v1/models` 응답(Kev · vLLM, 비밀 없음 확인), 레지스트리 대조, Kev 요청 10회 `latency_ms` p50 · p95와 HTTPS 왕복 p50 · p95, Qwen 1회 왕복, 회사 제공 GPU 정보(있으면) | 회사 GPU 추론 엔드포인트(HTTPS)에서 Qwen3.5-9B · Kev-9B@v1.0이 실제로 서빙되고 레지스트리와 일치. VRAM · 가중치는 회사 운영이라 직접 측정하지 않는다([[16-DECISIONS\|ADR-025]]) | `docs/evidence/phase-0/endpoint-check.md`(G1~G6 결과, 지연 표), `docs/evidence/phase-0/endpoint-models.json`, `docs/evidence/phase-0/external-deps.md` ③, 데모 당일 재확인 `docs/evidence/demo-day/<일시>/endpoint-models.json` | 없음 · 예정 | C1 ③ |
| 4 | 파서 후보 비교표(형식별 재현율 · 누락 · 라이선스) | 어떤 형식을 "지원"으로 표시할 수 있나 | `docs/evidence/phase-0/parser-benchmark.md`, `docs/evidence/phase-2/parse-success-rate.md` | 없음 · 예정 | C1 ④ · C3 |
| 5 | Qwen 실추출 인용 검증 통과율(필드별 EXACT · NORMALIZED · FUZZY · FAILED 비율) | 추출값이 원문에 근거한다 | `docs/evidence/phase-5/extraction-citations-<일시>.md` | 없음 · 예정 | C5 |
| 6 | Kev 응답 원문(wire) · `stateTrace` · `stateHash` 표본, 레지스트리 대조 결과(`registryMatch`) | Kev가 실제로 불렸고 어떤 state로 무엇을 답했는지 추적 가능 | `docs/evidence/phase-5/kev-sample-<일시>.json`, gateway `/health` 응답 저장본 | 없음 · 예정 | C5 |
| 7 | live E2E 실행 로그 1건(수집 → 첨부 → 파싱 → 추출 → 규칙 → 점수 → Kev → 저장. 요청 ID · `run_mode=LIVE` · 모델 · `promptHash` · `input_snapshot_hash` · 단계별 지연) | S-LIVE 장면이 실제 실행 결과다 | `docs/evidence/phase-5/live-e2e-<일시>.md`, 화면 캡처 `YYYYMMDD-phase5-bid-detail-loaded-1440.png` | 없음 · 예정 | C8 |
| 8 | 녹화 영상(실시간 조회가 불안정할 때, 같은 입력의 7번 로그 기반) | S-LIVE 대체. "녹화"라고 표시 | 저장소 밖, 경로는 `README.md`에 | 없음 · 예정 | C8 · C9 |
| 9 | 세 모드 기동 리허설 결과(`runMode` 일치·모델 식별자·Kev 레지스트리 대조), 엔드포인트 미접속 → `PARTIAL` → 재접속 확인 시간 | 실행 모드 표시와 장애 대응의 실제 상태. gateway `/health`는 Qwen 실추론 성공을 보증하지 않으며 모델 접속은 별도 확인 | `docs/evidence/demo-day/<일시>/run-modes.md`, `rehearsal-log.md` | 일부 있음(2026-10-20): [mock 1차 리허설](../evidence/demo-day/20261020-1009/checklist.md)·[모드 확인](../evidence/demo-day/20261020-1009/run-modes.md). gateway 정지·복구 통과. live·fixture와 실제 모델 엔드포인트 검증은 미실행 | C9 |

## 적지 않는 것

- 서비스키 값, 엔드포인트 인증 키(`QWEN_API_KEY`·`KEV_API_KEY`) 값, `Authorization` 헤더. 엔드포인트 URL(`https://acropolissg.com/sol-radar`)은 비밀이 아니다.
- 실제 RFP 원문 텍스트(첨부 저작권 미확인, 16 미결정 18번). 지표와 문서 id만.
- 공공 API 응답의 담당자 개인정보.

## 관련 문서

- [[11-TESTING|11 테스트]] — §3.3 외부 의존성 점검, §6 증거 규칙
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] — 증거 저장 절
- [[03-AI-PIPELINE|03 AI 파이프라인]] — §5.9 실추론 검증 절차, §11 레지스트리
- [[16-DECISIONS|16 ADR]] — 미결정 1 · 3 · 16 · 17 · 18번, ADR-025
- `docs/evidence/README.md`
