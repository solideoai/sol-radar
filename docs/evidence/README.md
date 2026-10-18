---
title: "증거 색인 (심사위원용)"
status: draft
tags:
  - sol-radar
  - test
  - hackathon
updated: 2026-10-18
---

# 증거 색인

주장마다 어디서 확인하고 어떤 파일이 증거인지 적는다. 형식과 저장 규칙은 [[11-TESTING|11 테스트]] §6이다. 아직 없는 파일은 "예정"으로 적고 통과한 것처럼 쓰지 않는다. 비밀값·서비스키·실제 RFP 원문·공공 API 응답의 담당자 개인정보는 이 폴더에 두지 않는다.

## 있는 증거 (2026-10-18 기준)

| 주장 | 어디서 확인 | 증거 파일 |
|---|---|---|
| worker가 `server-only` 도메인 코드를 불러 기동한다(`node --conditions=react-server --import tsx`) | [[16-DECISIONS\|16 ADR]] 미결정 9번 | `phase-0/worker-conditions.txt` |
| 가상 명부 200명·남녀 100/100·세 글자 이름·원본 이름 일치 0 | [[11-TESTING\|11 테스트]] §8 PPL-01·PPL-02 | `people/20261016-people-data.json`, `people/20261016-people-integration.md` |
| 정장 사진 200장 사람 승인·manifest READY 200·원본 SHA-256 1:1 | PPL-03 | `people/20261017-portraits-approval.json`, `people/20261017-portraits-integration.md`, `people/20261017-portraits-integration-qa.md` |
| 가입 신고 정보·인력 표 RLS 격리·가입 폼 필수 선택·보완 흐름 | PPL-04~PPL-06, [[11-TESTING\|11 테스트]] §9.1 | `people/20261016-adr021-people-integration.md`, `people/20261017-adr021-qa-report.md`, `people/screenshots/` |
| b3ef 인력 작업의 main 병합과 재검증 | [[PROGRESS\|진행 상황]] | `people/20261017-b3ef-main-merge.md` |
| 첫 화면이 1440·1280에서 넘침 없이 렌더되고 콘솔 오류 0 | [[06-UI-UX\|06 UI]] §1 | `landing/20261016-redesign-view-{1440,1280}.png`, `landing/20261016-redesign-full-{1440,1280}.png`, `landing/20261016-redesign-test-report.txt` |

## 예정 (Phase별, 파일명은 11 §6)

| 주장 | 어디서 확인 | 증거 파일 (예정) |
|---|---|---|
| Compose 5개 서비스 healthy, `/health/ready` ok, 실행 모드 모순 env 기동 거부 | [[11-TESTING\|11 테스트]] §4 Phase 0, V2-01 | `phase-0/compose-ps.txt`, `phase-0/health-ready.json`, `phase-0/run-mode-check.txt` |
| 실제 나라장터 응답·첨부 다운로드·회사 GPU 터널·파서 후보 점검 결과(막힌 항목은 막힘으로) | P0-0, [[11-TESTING\|11 테스트]] §3.3 | `phase-0/external-deps.md`, `phase-0/parser-benchmark.md` |
| 조직 간 데이터 격리(다른 조직 자원 404) | G5 | `phase-1/test-isolation.txt`, `demo-day/*/isolation-404.json` |
| 같은 공고 2회 수집에 중복 없음, 알림 정확히 1건 | G1·G2 | `phase-2/test-ingestion.txt`, `phase-6/test-notifications.txt` |
| 실제 공고를 `live`로 수집하고 형식별 파싱 성공률을 쟀다 | P0-2·P0-3 | `phase-2/ingest-run-live-<일시>.json`, `phase-2/parse-success-rate.md` |
| 같은 입력이면 같은 점수, Kev가 규칙을 뒤집지 못한다, 정보 부족 ≠ 미충족 | [[08-SCORING\|08 점수]] §6, G3, V2-05·V2-06 | `phase-4/goldens-report.txt` |
| AI 없이도 `PARTIAL`로 완결된다 | G6 | `phase-5/ai-fallback.txt`, `phase-5/e2e/partial.png` |
| 실추론(Qwen 인용 검증 통과율, Kev 응답 원문·`stateTrace`) | P0-4·P0-6 | `phase-5/` 실추론 로그 |
| 가상 데이터는 가상이라고 표시된다 | G8, V2-02 | `phase-3/e2e/*.png` |
| 모델 성능을 숫자로 잰다(E0·E1·E2, 한국어/영어 비교) | [[21-MODEL-TRAINING\|21 모델 학습]] §4 | `eval/` |
| 데모 당일 체크리스트와 세 모드 리허설 | [[11-TESTING\|11 테스트]] §5 | `demo-day/<일시>/checklist.md`, `demo-day/<일시>/run-modes.md`, `demo-day/rehearsal-log.md` |

## 관련 문서

- [[11-TESTING|11 테스트]] — 증거 산출물 규칙
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] — 스크린샷 파일명 규칙
- [[PROGRESS|진행 상황]]
