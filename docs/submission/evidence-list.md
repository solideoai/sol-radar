---
title: "실제 AI 검증 증거 목록"
status: draft
tags:
  - sol-radar
  - hackathon
  - submission
updated: 2026-10-27
---

# 실제 AI 검증 증거 목록

"실제 데이터·실제 모델로 돌았다"는 주장을 받칠 증거다. 2026-10-25 기준 1·2번(C1 ①②)은 있고, 3·7·9·10번은 일부만 있다(3번 회사 vLLM Qwen probe, 7번 규칙만 `PARTIAL`인 S-LIVE 사전 run과 10-24 운영 점검, 9번 `mock` 리허설 2회, 10번 운영 smoke). 나머지는 없음·예정이다. 오늘 진행하는 운영 run·녹화 결과는 〔10-25 결과 대기〕로 적어 두고, 결과가 나온 뒤에만 "있음"으로 바꾼다. 2026-10-27 메인 세션 확인: 운영 실모델 분석은 2026-10-24 가상 공고 FX-02 1건(66 WATCH, 대체 없음)이고, 실제 나라장터 공고 분석은 0건(본문이 비어 `409 ANALYSIS_SOURCE_MISSING`), 카카오 연결은 0건이다. 실공고 증거(7·8번)는 첨부 처리 구현(2026-10-27 착수, [[16-DECISIONS|ADR-054]]) 뒤에 만든다. 발표 일정은 공식 제출 2026-11-03·발표 2026-11-04다. 파일 경로는 [[11-TESTING|11 테스트]] §6과 [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] 증거 규칙을 따른다. 담당 작업 ID는 [수상 전략 계획](../plans/2026-10-18-hackathon-award-plan.md) §4의 C1·C5·C8이다. 증거가 생기면 상태를 "있음(날짜)"으로 바꾸고 `docs/evidence/README.md` 색인에도 넣는다.

| # | 증거 항목 | 무엇을 증명하나 | 예정 파일 경로 | 상태 | 담당 |
|---|---|---|---|---|---|
| 1 | 실제 API 응답 3건(오퍼레이션별, 담당자 이름·전화·이메일 마스킹, 서비스키 든 URL 제외) | 입찰공고 · 사전규격 · 발주계획 · 업종 마스터 4개 서비스의 실제 응답 스키마와 명세 일치 여부 | `docs/evidence/phase-0/external-deps.md` ①, `fixtures/recorded/<service>/<operation>-<n>.masked.json` | 있음(2026-10-19): A1~A9 통과, 마스킹 응답 14파일, [API 호출 증거](../evidence/phase-0/external-deps-api-20261019.md) | C1 ① |
| 2 | 첨부 3건 다운로드 결과(HTTP 상태 · 형식 · 크기 · 로그인 요구 여부) | g2b 첨부 3건의 익명 다운로드 가능 여부(제품 자동 다운로드·파서 구현 완료 증거는 아님) | `docs/evidence/phase-0/external-deps.md` ② | 있음(2026-10-19): B1~B4 통과, 3건 익명 GET 200(HWPX·PDF·HWPX) | C1 ② |
| 3 | 결정 모델 엔드포인트(`/sol-radar/kev` → `sol_decision`)와 회사 Qwen API(`/vllm/v1`)의 `GET /v1/models` 응답(비밀 없음 확인), 레지스트리 대조, 500/6,000토큰 state별 24문항 묶음 각 10회 `latency_ms` p50 · p95와 HTTPS 왕복 p50 · p95, Qwen 1회 왕복, 회사 제공 GPU 정보(있으면) | 결정 모델 Bosun v3.1 0.6B(`Hanno-Labs/bosun-v3.1-0.6b@5e78a37c`)가 회사 GPU 서버에서, 추출·설명 모델 Qwen3.8-Flash-Next(served id `Qwen3.8-Flash-Next-AWQ-INT4`)가 회사 운영 vLLM API에서 실제로 서빙되고 레지스트리와 일치. Qwen은 회사 운영이라 `/v1/models`의 `id`를 레지스트리 `run`과 대조만 한다. VRAM · 가중치는 회사 운영이라 직접 측정하지 않는다([[16-DECISIONS\|ADR-025]]·[[16-DECISIONS\|ADR-034]]) | `docs/evidence/phase-0/endpoint-check.md`(G1~G6 결과, 지연 표), `docs/evidence/phase-0/endpoint-models.json`, `docs/evidence/phase-0/external-deps.md` ③, 데모 당일 재확인 `docs/evidence/demo-day/<일시>/endpoint-models.json`, Qwen probe `docs/evidence/phase-5/qwen-probe-20261021-2343.json` | 일부(2026-10-21): 회사 vLLM Qwen probe 통과. `GET /v1/models` 200(served id `Qwen3.8-Flash-Next-AWQ-INT4`, 레지스트리 `run` 일치, 125 ms), guided JSON `chat/completions` 200(253 ms), 요청 각 1회, [증거](../evidence/phase-5/qwen-probe-20261021-2343.json). 결정 모델 `/v1/models`·지연 표·24문항 p50 · p95는 미확인 | C1 ③ |
| 4 | 파서 후보 비교표(형식별 재현율 · 누락 · 라이선스) | 어떤 형식을 "지원"으로 표시할 수 있나 | `docs/evidence/phase-0/parser-benchmark.md`, `docs/evidence/phase-2/parse-success-rate.md` | 없음 · 예정 | C1 ④ · C3 |
| 5 | Qwen 실추출 인용 검증 통과율(필드별 EXACT · NORMALIZED · FUZZY · FAILED 비율) | 추출값이 원문에 근거한다 | `docs/evidence/phase-5/extraction-citations-<일시>.md` | 없음 · 예정 | C5 |
| 6 | 결정 모델 응답 원문(Kev wire) · `stateTrace` · `stateHash` 표본, 레지스트리 대조 결과(`registryMatch`) | 결정 모델이 실제로 불렸고 어떤 state로 무엇을 답했는지 추적 가능 | `docs/evidence/phase-5/kev-sample-<일시>.json`, gateway `/health` 응답 저장본 | 없음 · 예정 | C5 |
| 7 | live E2E 실행 로그 1건(현재 수집 → 공고 본문·API 필드 추출 → 규칙 → 점수 → 결정 모델 → 저장. 첨부·파싱은 구현 뒤 별도 증거 확보. 요청 ID · `run_mode=LIVE` · 모델 · `promptHash` · `input_snapshot_hash` · 단계별 지연) | S-LIVE 장면이 실제 실행 결과다 | `docs/evidence/phase-5/live-e2e-<일시>.md`, 화면 캡처 `YYYYMMDD-phase5-bid-detail-loaded-1440.png` | 일부(2026-10-20): 갈래 "API 정상·GPU 불가" 사전 run. `live` 수집 실공고 86건 → `R26BK01774434` `PARTIAL`·`RULES_ONLY`(첨부·파싱·추출·결정 모델 없음), [기록](../evidence/demo-day/20261020-1434/run-modes.md), 캡처 `demo-day/20261020-1434/s-live-{list,detail}-{1440,1280}.png`. 2026-10-24 운영 점검은 로그인을 못 해 갈래 미판정([기록](../evidence/demo-day/20261024-slive-check/slive-check.md)). 10-25 S-LIVE·카카오 실행 절차서는 [절차서](../evidence/demo-day/20261024-slive-check/20261025-slive-kakao-runbook.md)(`docs/evidence/demo-day/20261024-slive-check/`). 운영 run과 실추론 live E2E는 〔10-25 결과 대기〕. 10-25에는 하지 못했고 첨부 처리 구현 뒤 실공고로 한다 | C8 |
| 8 | 녹화 영상(실시간 조회가 불안정할 때, 같은 입력의 7번 로그 기반) | S-LIVE 대체. "녹화"라고 표시 | 저장소 밖, 경로는 `README.md`에 | 없음 · 예정(10-25 녹화 〔10-25 결과 대기〕. 촬영은 첨부 처리 구현 뒤, 11-01 제안) | C8 · C9 |
| 9 | 세 모드 기동 리허설 결과(`runMode` 일치, `qwen.healthy`, `kev.registryMatch`), 엔드포인트 미접속 → `PARTIAL` → 재접속 확인(`GET /v1/models`) 시간 | 실행 모드 표시가 실제 상태와 같다 | `docs/evidence/demo-day/<일시>/run-modes.md`, `rehearsal-log.md` | 일부(2026-10-20): `mock`만 기동한 [C9 1차 기록](../evidence/demo-day/20261020-1009/run-modes.md)·[리허설 로그](../evidence/demo-day/rehearsal-log.md), C8 사전 run [기록](../evidence/demo-day/20261020-1434/run-modes.md), C9 2차 리허설(2026-10-21 11:45~12:09, `mock` S0~S7, 격리 로컬 Supabase, 실모델 항목은 B2 대기로 미시도) [체크리스트](../evidence/demo-day/20261021-1144/checklist.md)(`docs/evidence/demo-day/20261021-1144/`). `live`·`fixture` 기동과 엔드포인트 재접속 확인은 GPU 엔드포인트 뒤 | C9 |
| 10 | 운영 smoke(Vercel 운영 `https://www.solideos-radar.com`, 1440 · 1280) | 운영 경로(Vercel web + Supabase + 회사 Gateway)에서 화면 · 권한 · 분석 접수가 동작한다 | `docs/evidence/deployment/20261024-prod-smoke/`(`results.json`, 스크린샷) | 일부(2026-10-24, 9b): 대시보드 · 목록(1280 넘침 0) · FX-01 94 BID · 근거 서랍 · FX-03 68 NO-BID · 가정 재계산 WATCH · FX-02 분석 요청 202 · 결정 기록 · 다른 조직 404 · 비로그인 401 · CSRF 403 통과. FX-02 분석 완료(72 WATCH)는 회사 Worker가 job을 소비하지 않아 차단(결함 D1, [진단](../evidence/deployment/20261024-company-queue-diagnosis.md)). 비밀번호 로그인 · 다른 역할 403 · 알림 벨은 미확인. 10-25 재확인 〔10-25 결과 대기〕. 같은 날 뒤에 운영 실모델 분석 1건이 끝났다(FX-02 66 WATCH. 회사 런타임이 `live`라 mock 골든 72가 아니다, 메인 세션 2026-10-27 확인) | P0-2 · P0-3 |

## 적지 않는 것

- 서비스키 값, 엔드포인트 인증 키(`QWEN_API_KEY`·`KEV_API_KEY`) 값, `Authorization` 헤더. 엔드포인트 URL(`https://acropolissg.com/sol-radar`·`https://acropolissg.com/vllm/v1`)은 비밀이 아니다.
- 실제 RFP 원문 텍스트(첨부 저작권 미확인, 16 미결정 18번). 지표와 문서 id만.
- 공공 API 응답의 담당자 개인정보.

## 관련 문서

- [[11-TESTING|11 테스트]] — §3.3 외부 의존성 점검, §6 증거 규칙
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] — 증거 저장 절
- [[03-AI-PIPELINE|03 AI 파이프라인]] — §5.9 실추론 검증 절차, §11 레지스트리
- [[16-DECISIONS|16 ADR]] — 미결정 1 · 3 · 16 · 17 · 18 · 24번, ADR-025 · ADR-034
- `docs/evidence/README.md`
