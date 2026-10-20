---
title: "증거 색인 (심사위원용)"
status: draft
tags:
  - sol-radar
  - test
  - hackathon
updated: 2026-10-20
---

# 증거 색인

주장마다 어디서 확인하고 어떤 파일이 증거인지 적는다. 형식과 저장 규칙은 [[11-TESTING|11 테스트]] §6이다. 아직 없는 파일은 "예정"으로 적고 통과한 것처럼 쓰지 않는다. 비밀값·서비스키·실제 RFP 원문·공공 API 응답의 담당자 개인정보는 이 폴더에 두지 않는다.

색인은 파일 이름과 한 줄 설명만 적는다. 통과·실패 판정과 숫자는 각 파일 안에 있다.

## 있는 증거 (2026-10-20 기준, 이 저장소 트리)

### `phase-0/` — 실행 환경 통합 기동(C0)·외부 의존성(C1)

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `c0-integration-20261019.md` | C0 통합 기동 검증 10항목 표(격리 Compose 프로젝트) | [[11-TESTING\|11 테스트]] §4 Phase 0, V2-01 |
| `compose-config.txt`·`compose-up.txt`·`compose-ps.txt`·`post-smoke-state.txt`·`cleanup.txt` | Compose 설정·기동·서비스 상태·smoke 뒤 상태·정리 출력 | 같은 곳 |
| `gateway-health.json`·`gateway-health.log.txt`·`gateway-endpoints.txt` | gateway `/health` 응답·로그, Phase 0 시점 `/extract`·`/kev` 미구현 확인 | 같은 곳 |
| `health-ready.json`·`health-ready.log.txt`·`health-ready-baseline.json`·`health-ready-degraded.json`·`health-ready-recovered.json` | web `/health/ready` 응답(정상·gateway 정지 `degraded`·복구 `ok`) | [[16-DECISIONS\|16 ADR]] 미결정 9번 |
| `run-mode-check.txt` | 실행 모드 모순 env 기동 거부(exit 78) | [[10-DEPLOYMENT\|10 배포]] |
| `network-check.txt`·`port-volume-check.txt` | 서비스 간 네트워크, 호스트 포트·볼륨 충돌 검사 | 같은 곳 |
| `smoke.txt` | `infra/smoke.sh` 5단계 출력 | 같은 곳 |
| `fixture-check.txt` | `pnpm bids:check`와 fixture 파일 수 | [[07-DATA-PIPELINE\|07 수집]] §6.5 |
| `worker-conditions.txt`·`worker-logs.txt`·`worker-stop.txt` | worker `--conditions=react-server` 기동·로그·`docker compose stop worker` 정상 종료 | [[16-DECISIONS\|16 ADR]] 미결정 9번 |
| `web-build.txt`·`test-report.txt` | `pnpm -C web build`·`pnpm verify` 전체 출력 | [[11-TESTING\|11 테스트]] §2 |
| `task8-gaps-20261019.md`·`task8-gaps-cleanup.txt` | Phase 0 Task 8 보완 검증(AI 장애 리허설·worker 종료·verify)과 정리 | [[11-TESTING\|11 테스트]] §4 Phase 0 |
| `external-deps.md` | P0-0 외부 의존성 체크리스트(①② 통과, ③ 회사 GPU 추론 엔드포인트 대기, ④ 파서 비교 미착수) | [[12-ROADMAP\|12 로드맵]] Phase 0, [[16-DECISIONS\|16 ADR]] 미결정 1·16·17번 |
| `external-deps-api-20261019.md` | C1 ① 공공 API 4종 실제 호출·② 첨부 3건 다운로드 기록(마스킹 응답 14건은 `fixtures/recorded/`) | [[16-DECISIONS\|16 ADR]] 미결정 1·16번, `submission/evidence-list.md` 1·2번 |

### `phase-1/` — DB·RLS·seed(C2)

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `test-db.txt` | `pnpm test:db` 정책 시험 출력(PGlite) | [[11-TESTING\|11 테스트]] §4 Phase 1, [[16-DECISIONS\|16 ADR]] 미결정 15번 |
| `test-db-FAIL.txt` | 같은 시험의 수정 전 실패 출력(ADR-026 정책 1건, 빨간불 확인용) | 같은 곳 |
| `demo-reset.txt`·`seed-summary.json` | 격리 Supabase에서 `pnpm demo:reset` 2회 실행 로그와 요약 | [[04-DATABASE\|04 DB]] seed |
| `people-availability.txt` | 인력 배정 7건을 `team_member_scoring.availability`로 접는 seed 시험 | [[08-SCORING\|08 점수]] §6.1 |
| `migrate.log` | 클라우드 Supabase `pnpm db:push` 29개 적용 로그(2026-10-20, 호스트·키 없음) | [[10-DEPLOYMENT\|10 배포]] `db:push`, [[PROGRESS\|진행 상황]] Phase 1 |
| `demo-reset-cloud-20261020.json` | 클라우드 `pnpm demo:reset` 요약(기동 절차 12) | [[10-DEPLOYMENT\|10 배포]] 기동 절차 |

### `phase-2/` — 수집(C3)

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `test-ingestion.txt` | 수집 도메인·worker·저장 RPC·`demo:reset` 시험 출력(미구현 범위를 끝에 명시) | G1·G2, [[07-DATA-PIPELINE\|07 수집]] |

### `phase-4/` — 규칙 엔진·골든(C4)

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `goldens-report.txt` | `web/server/scoring` 시험 출력(worked example 94/72/68·골든·독립 변형 확인) | [[08-SCORING\|08 점수]] §6, G3, V2-05·V2-06 |

### `phase-5/` — AI gateway mock·분석 클라이언트(C5)

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `test-ai.txt` | `services/ai` pytest 전체 출력(`AI_PROVIDER=mock`만, 외부 호출 차단) | [[11-TESTING\|11 테스트]] G4·G6·G9 |
| `ai-fallback.txt` | gateway 클라이언트·circuit breaker·`PARTIAL` 대체 시험(가짜 fetch) | G6, [[03-AI-PIPELINE\|03 AI 파이프라인]] §8 |
| `kev-fixtures-engine-scores.md` | mock Kev fixture 20건의 규칙 엔진 근거 | [[07-DATA-PIPELINE\|07 수집]] fixture 절 |
| `preanalyze-cloud-20261020.md` | 클라우드 기동 절차 12~14(`demo:reset`·`check:env`·`/health/ready` ok·`demo:preanalyze` 18/18)와 worker 분석 로그 | [[10-DEPLOYMENT\|10 배포]] 기동 절차, [[11-TESTING\|11 테스트]] §4 Phase 0 `checks.db` |

### `phase-3/` — 화면 4개·Route Handler(C6)

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `c6-a-test-report.txt`·`c6-b-test-report.txt` | C6 두 레인의 시험 출력 | [[11-TESTING\|11 테스트]] §4 Phase 3 |
| `axe-report.json` | 접근성 검사 결과(위반 0) | 같은 곳 |
| `isolation-404.json` | 다른 조직 자원 404(G5) | [[11-TESTING\|11 테스트]] G5 |
| `e2e/` | 대시보드·목록·상세·알림 1440·1280 스크린샷 | [[06-UI-UX\|06 UI]] |

### `phase-6/` — 결정 기록·인앱 알림(C7)

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `test-notifications.txt` | 알림 도메인·outbox·worker 시험 출력 | [[11-TESTING\|11 테스트]] §4 Phase 6, [[13-NOTIFICATIONS\|13 알림]] |

### `demo-day/` — 데모 리허설(C9)

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `rehearsal-log.md` | 리허설 회차 표(날짜·범위·커밋·소요·실패 단계) | [[11-TESTING\|11 테스트]] §5, [[19-DEMO-SCENARIO\|19 데모 시나리오]] §6 |
| `20261020-1009/checklist.md`·`run-modes.md` | C9 1차 리허설 S0~S7 0~18번 판정표(`mock` 전체, ✅ 13 / ❌ 5)와 세 모드 기록 | 같은 곳 |
| `20261020-1009/*.txt` | 각 단계 명령 출력(compose ps·smoke·seed·preanalyze·health·gateway·API·격리 404·S6 장애 주입·S4 결정·정리) | 같은 곳 |
| `20261020-1009/screenshots/` | 1440 기본·1280 목록·상세 스크린샷 | 같은 곳 |

### `people/` — 가상 인력·가입·조직도(ADR-019·021)

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `20261016-people-data.json`·`20261016-people-integration.md` | 가상 명부 200명 생성·원본 대조·통합 검증 | [[11-TESTING\|11 테스트]] §8 PPL-01·02 |
| `20261016-docs-check.json`·`20261016-docs-review.md`·`20261016-docs-verify.txt`·`20261016-docs-verify-sandbox.txt` | ADR-019 설계 문서 검증 | [[16-DECISIONS\|16 ADR]] ADR-019 |
| `20261016-plans-check.json`·`20261016-plans-verify.txt` | 인력 구현 계획 3건 검증 | `plans/2026-10-16-solideo-people-*.md` |
| `20261016-portraits-review.json` | 정장 사진 200장 AI 검수 이력 | PPL-03 |
| `20261017-portraits-approval.json` | 사진 200장 사람 최종 승인 기록(manifest READY 200) | PPL-03 |
| `20261017-portraits-integration-task1.md`·`20261017-portraits-integration.md`·`20261017-portraits-integration-qa.md`·`20261017-portraits-integration/` | 승인 사진 통합·독립 QA(폴더에 로그·JSON·최종 수정 증거) | PPL-03 |
| `20261016-adr021-people-integration.md`·`20261017-adr021-qa-report.md`·`20261017-adr021/` | ADR-021 가입 신고 정보·인력 표 분리·RLS 격리 QA(폴더에 1440·1280 화면·로그) | PPL-04~06, [[11-TESTING\|11 테스트]] §9.1 |
| `20261017-b3ef-main-merge.md`·`20261017-b3ef-main-merge/` | b3ef → main 병합(`42a4ead`)과 재검증(폴더에 QA 로그·화면) | [[PROGRESS\|진행 상황]] |
| `20261019-people-read.md`·`20261019-people-read/` | `/people`·`/org-chart` 구현·검증(`screens/` 1440·1280, `evidence.zip`) | [[PROGRESS\|진행 상황]] ADR-021 N4a |
| `screenshots/` | 가입·정보 보완 화면 1440·1280 | PPL-04 |

### `landing/` — 첫 화면

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `20261016-landing-loaded-{1440,1280}.png`·`test-report.txt` | 첫 랜딩 교체 전체 화면과 `pnpm verify`·E2E 출력 | [[06-UI-UX\|06 UI]] §1 |
| `20261016-landing-reveal-{mid,scrolled}-{1440,1280}.png` | 스크롤 등장 효과 중간·끝 화면 | 같은 곳 |
| `20261016-redesign-{view,full}-{1440,1280}.png`·`20261016-redesign-test-report.txt` | 재설계 첫 화면·전체 화면과 시험 출력 | 같은 곳 |

### `competitors/` — 경쟁 서비스 조사(X3)

| 파일 | 무엇 | 어디서 확인 |
|---|---|---|
| `2026-10-19-competitors.md` | 국내 공공입찰 정보 서비스 공개 페이지 조사 | [[18-HACKATHON\|18 해커톤]] §3.2.1 |

## 예정 (Phase별, 파일명은 11 §6)

| 주장 | 어디서 확인 | 증거 파일 (예정) |
|---|---|---|
| 회사 GPU 추론 엔드포인트(HTTPS `/v1/models` 레지스트리 대조·지연 실측, [[16-DECISIONS\|ADR-025]])·파서 후보 점검 결과(막힌 항목은 막힘으로) | P0-0 ③④, [[11-TESTING\|11 테스트]] §3.3 | `phase-0/endpoint-check.md`, `phase-0/endpoint-models.json`, `phase-0/parser-benchmark.md`, `phase-0/external-deps.md` ③④ 갱신 |
| 조직 간 데이터 격리(다른 조직 자원 404) | G5 | `phase-1/test-isolation.txt`, `demo-day/*/isolation-404.json` |
| 알림 정확히 1건 | G2 | `phase-6/test-notifications.txt` |
| 실제 공고를 `live`로 수집하고 형식별 파싱 성공률을 쟀다 | P0-2·P0-3 | `phase-2/ingest-run-live-<일시>.json`, `phase-2/parse-success-rate.md` |
| AI 없이도 `PARTIAL`로 완결된다(화면) | G6 | `phase-5/e2e/partial.png` |
| 실추론(Qwen 인용 검증 통과율, Kev 응답 원문·`stateTrace`) | P0-4·P0-6 | `phase-5/` 실추론 로그 |
| 가상 데이터는 가상이라고 표시된다 | G8, V2-02 | `phase-3/e2e/*.png` |
| 모델 성능을 숫자로 잰다(E0·E1·E2, 한국어/영어 비교) | [[21-MODEL-TRAINING\|21 모델 학습]] §4 | `eval/` |
| Kev-9B LoRA 가 회사 GPU(A40 46,068 MiB, 물리 GPU 1)에서 학습된다(F1)·E4 비교 | [[21-MODEL-TRAINING\|21 모델 학습]] §5.2, [[22-FINETUNE-RUNBOOK\|22]] §4.2 | `kev-train-feasibility.md`(§0 서버 환경 확인 2026-10-20 기록됨. F1 표는 미실행), `eval/e4-<일시>.md` |
| 데모 당일 체크리스트와 세 모드 리허설 | [[11-TESTING\|11 테스트]] §5 | `demo-day/<일시>/checklist.md`, `demo-day/<일시>/run-modes.md`, `demo-day/rehearsal-log.md` |

## 관련 문서

- [[11-TESTING|11 테스트]] — 증거 산출물 규칙
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] — 스크린샷 파일명 규칙
- [[PROGRESS|진행 상황]]
