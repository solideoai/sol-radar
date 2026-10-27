---
title: "제출물 색인"
status: draft
tags:
  - sol-radar
  - hackathon
  - submission
updated: 2026-10-27
---

# 제출물 색인

공식 제출은 **2026-11-03(화)**, 발표는 **2026-11-04(수)**다([[16-DECISIONS|ADR-054]]). 발표는 덱 20분에 녹화 클립을 넣는 형식이다. Q&A 는 10분이다. 남은 날의 세부 일정은 [[12-ROADMAP|12 로드맵]]의 남은 일정 제안 표를 따른다. 공식 심사 기준은 [[18-HACKATHON|18 해커톤]] §4(실용성 30 · 사업적 창의성 25 · 완성도 25 · 확장 가능성 20)다. 이 폴더는 제출물 **초안 구조**다. 구현 · 측정 전인 항목은 상태 열에 그대로 적는다. 파일이 있다는 것만으로 완료로 보지 않는다. "제출 형식 충족 확인" 열이 확인됨이 될 때 완료다.

첨부 처리(다운로드 · 파서 · documents worker) 코드는 main 에 있고, 격리 스택에서 HWP · PDF · HWPX 3건 처리를 확인했다(`docs/evidence/attachment-pipeline/20261027-isolated-run.md`). 회사 서버 반영은 아직이다. Qwen 설명 생성은 미구현이고 설명은 템플릿이다. 운영 앱 경로의 실모델 분석은 2026-10-24 1건뿐이다. 가상 공고 FX-02 가 66점 WATCH 를 받았다(`Qwen3.8-Flash-Next-AWQ-INT4` + `bosun-v3.1-0.6b`, 대체 없음). 66 이 골든 72 와 다른 까닭은 당시 마감이 가까워 일정 계수가 낮았기 때문으로 본다(추정, `docs/evidence/demo-deadline/20261027/README.md` S4 절). 골든 72 는 `mock` 시험 기준이다. 실제 나라장터 공고 분석은 0건이다(본문이 비어 `409 ANALYSIS_SOURCE_MISSING`). 실공고 분석은 회사 반영 뒤 S-LIVE 증거를 얻은 뒤에만 주장한다. 상세 상태는 [[18-HACKATHON|18]] §7 과 `evidence-list.md` 를 따른다.

## 18 §10 체크리스트 ↔ 파일

| 18 §10 항목 | 파일 경로 | 상태 | 심사 기준 | 제출 형식 충족 확인 |
|---|---|---|---|---|
| 저장소 링크(README가 00 인덱스 역할, 기동 절차는 10) | 루트 `README.md`, [[00-README\|00 인덱스]], [[10-DEPLOYMENT\|10 배포]] | 있음: 마감 · 발표일, 현재 상태, 정직성 표 요약, Vercel 운영 주소 · ADR-049 배포, `mock` 기동 요약 | 완성도 · 확장성 | 미확인(제출 형식 미입력) |
| 아키텍처 다이어그램 1장 | `docs/submission/architecture.md` | 있음: ADR-049 운영 배포 그림, 3시간 정기 수집, 첨부 처리(코드 있음 · 회사 반영 전), 로컬 Compose 대체 경로, 데이터 흐름(Mermaid 3개) | 확장성 · 실용성 | 미확인 |
| 데모 영상 3분(백업용) | `docs/submission/slides-spec.md` 부록 A(덱 삽입 클립 5개 + 카카오 10초, A.4 3분 백업 영상 컷 표). 영상 파일 없음 | 촬영 전. 촬영 일정은 [[12-ROADMAP\|12 로드맵]] 남은 일정 제안 표. 카카오 10초는 녹화 전이다(운영 카카오 연결 0건) | 완성도 | 미확인 |
| 발표 슬라이드 | 정본은 `docs/submission/slides-spec.md`(제작 명세, 18장 · 20분, 부록 D 캡처 매핑). 덱 파일 `docs/submission/deck/sol-radar-deck.pptx`(git 제외, 별도 제출) | 덱 초안은 이 명세보다 옛 내용이다. 이 명세 기준으로 다시 만든다 | 네 기준 전부 | 미확인 |
| `docs/evidence/` 테스트 · E2E · 기동 로그 | [`docs/evidence/README.md`](../evidence/README.md)(증거 색인), `docs/submission/evidence-list.md`(AI 검증 증거 목록) | 있음. 폴더 목록은 증거 색인을 본다. 10-24 운영 실모델 분석 1건(FX-02 66 WATCH)은 따로 남긴 증거 파일이 없고 `docs/evidence/demo-deadline/20261027/prod-run.md` 조회 결과에만 있다. 실공고 live E2E 는 회사 반영 뒤 | 완성도 | 미확인 |
| 외부 의존성 점검 결과 · 평가 리포트 요약 | `docs/evidence/phase-0/external-deps.md` · `external-deps-api-20261019.md`(①②), ③ 회사 vLLM Qwen probe `docs/evidence/phase-5/qwen-probe-20261021-2343.json`, ④ 파서 `docs/evidence/parser/20261027-parser-check.md`, `docs/evidence/competitors/2026-10-19-competitors.md`(X3), `docs/evidence/eval/`(X6a 평가셋), `docs/submission/experiment-tables.md`(빈 표) | 일부. ①② · ③ Qwen probe · ④ 파서 선택과 실표본 · X3 는 있다. Bosun 엔드포인트 점검 리포트 · X1 리포트는 없다. E1'~E4 는 미측정이다. X6 회사 GPU 학습 실행 여부는 미결정이다 | 실용성 · 창의성 | 미확인 |
| 정직성 표(§7)를 슬라이드와 README에 동일하게 포함 | [[18-HACKATHON\|18 해커톤]] §7, 루트 `README.md` "실제인 것과 mock인 것 (요약)", `slides-spec.md` 슬라이드 17, `limitations.md` | README 요약은 있다. 덱 반영은 덱을 다시 만들 때 확인한다 | 완성도 | 미확인 |
| 공식 심사 기준 확인 후 §4 갱신 | [[18-HACKATHON\|18 해커톤]] §4 | 완료(2026-10-18) | — | 확인됨 |

## 이 폴더의 파일

| 파일 | 내용 | 채워지는 시점 |
|---|---|---|
| `slides-spec.md` | 발표 덱 제작 명세(18장 · 20분). 발표 조건, 부록 A 촬영 계획(클립 5개 · 카카오 10초 · 3분 백업 영상), 부록 B Q&A, 부록 C 수치 출처표, 부록 D 캡처 매핑 | 정본. 덱은 이 문서 기준으로 만든다. 클립 · 캡처는 촬영 뒤 |
| `deck/sol-radar-deck.pptx` | 발표 덱 파일(git 제외, 별도 제출) | 옛 초안. 다시 만든다 |
| `architecture.md` | 시스템 아키텍처 · 데이터 흐름 Mermaid, 실행 모드 표 | 지금(02 · 03 기준) |
| `evidence-list.md` | 실제 AI 검증 증거 목록과 예정 경로 | 1 · 2번 있음. 3 · 4 · 7 · 9 · 10 · 11번 일부. 실공고 분석 증거는 회사 반영 뒤 |
| `experiment-tables.md` | E0 · E1' · E2 · E3 비교 표, E1' · E4 비교 표, 임팩트 예비 실험 표(빈 틀) | X1 · X2 · X6 실행 여부 결정 뒤(미결정) |
| `limitations.md` | 한계 · 미완성 · 실행 모드 구분, 외부 의존성 컷 4갈래 발표 문장, E4 문장 | 지금. S-LIVE 갈래는 회사 반영 뒤 실공고 결과로 고른다. E4 는 X6 실행 여부 결정 뒤 |

## 제출 형식 확인 (미입력)

제출 형식(파일 종류 · 분량 · 제출 경로)은 아직 받지 못했다. 받는 즉시 이 절에 적고 위 표의 "제출 형식 충족 확인" 열을 채운다. 해커톤 이름도 미입력이다([[18-HACKATHON|18 해커톤]] 머리 콜아웃).

발표 조건은 2026-10-21 사용자 입력이다. 사내 해커톤이고, 심사위원은 사장 · 부사장 · CFO 와 AI 심사위원이다. 30분 중 발표 20분 · Q&A 10분이다. 시연은 녹화 영상을 덱에 넣는다. AI 심사위원은 덱(또는 서비스)을 마크다운으로 바꾼 파일로 채점한다. 2026-10-27 결정으로 발표 시연 경로는 운영 사이트의 DEMO 출처(D1)다(ADR-054). 클립 촬영 경로는 [[19-DEMO-SCENARIO|19 데모 시나리오]] §4 가 정본이고, 발표 조건의 정본은 `slides-spec.md` 머리의 "발표 조건"이다.

## 관련 문서

- [[18-HACKATHON|18 해커톤]] — §4 심사 기준, §7 정직성 표, §10 체크리스트
- [[19-DEMO-SCENARIO|19 데모 시나리오]] — 장면별 촬영 경로
- [[16-DECISIONS|16 ADR]] — ADR-054(제출 11-03 · 발표 11-04, 발표 D1, 첨부 처리)
- [[12-ROADMAP|12 로드맵]] — 남은 일정 제안 표, 외부 의존성 컷 규칙
- [[11-TESTING|11 테스트]] — §6 증거 규칙
