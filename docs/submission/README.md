---
title: "제출물 색인"
status: draft
tags:
  - sol-radar
  - hackathon
  - submission
updated: 2026-10-25
---

# 제출물 색인

공식 제출 마감 **2026-10-27**(2026-10-18 사용자 입력), 완료 목표 **2026-10-26**([[16-DECISIONS|ADR-042]], 2026-10-21 사용자 결정. 10-27은 발표자료·발표 연습). 공식 심사 기준은 [[18-HACKATHON|18 해커톤]] §4(실용성 30 · 사업적 창의성 25 · 완성도 25 · 확장 가능성 20)다. 이 폴더는 제출물 **초안 구조**이고, 구현·측정 전인 항목은 상태 열에 그대로 적는다. 파일이 있다는 것만으로 완료로 보지 않고, "제출 형식 충족 확인" 열이 확인됨이 될 때 완료다.

현재 첨부 다운로드·파싱과 Qwen 설명 생성은 미구현이며, 설명은 템플릿이다. 회사 vLLM Qwen 엔드포인트 probe는 통과했지만(2026-10-21) 앱 경로 실추론은 미확인이다. 실모델 분석 완료는 S-LIVE 운영 run 증거(〔10-25 결과 대기〕)를 확보한 뒤에만 주장한다. 상세 상태는 [[18-HACKATHON|18]] §7과 `evidence-list.md`를 따른다.

## 18 §10 체크리스트 ↔ 파일

| 18 §10 항목 | 파일 경로 | 상태 | 심사 기준 | 제출 형식 충족 확인 |
|---|---|---|---|---|
| 저장소 링크(README가 00 인덱스 역할, 기동 절차는 10) | 루트 `README.md`, [[00-README\|00 인덱스]], [[10-DEPLOYMENT\|10 배포]] | 갱신(2026-10-25): 현재 상태·정직성 표 요약·Vercel 운영 주소·ADR-049 배포·`mock` 기동 요약 | 완성도·확장성 | 미확인(제출 형식 미입력) |
| 아키텍처 다이어그램 1장 | `docs/submission/architecture.md` | 갱신(2026-10-25): ADR-049 운영 배포 그림·로컬 Compose 대체 경로·데이터 흐름(Mermaid 3개) | 확장성·실용성 | 미확인 |
| 데모 영상 3분(백업용) | `docs/submission/video-storyboard.md`(스토리보드). 덱 삽입 클립 5개 + 카카오 10초(실제 공고 수신 녹화, `slides-spec.md` 부록 A). 영상 파일 없음 | 초안(촬영 전, 클립 녹화 〔10-25 결과 대기〕) | 완성도 | 미확인 |
| 발표 슬라이드 | 정본은 `docs/submission/slides-spec.md`(제작 명세, 18장·20분). 덱 파일 `docs/submission/deck/sol-radar-deck.pptx`(git 제외, 별도 제출). `slides-outline.md`는 캡처 매핑만 쓴다 | 덱 초안 있음, 정정 중 | 네 기준 전부 | 미확인 |
| `docs/evidence/` 테스트·E2E·기동 로그 | `docs/evidence/README.md`(색인), `docs/submission/evidence-list.md`(AI 검증 증거 목록) | 있음: `phase-0`(C0 통합 기동·C1 ①②)·`phase-1`(C2 정책 시험·seed)·`phase-2`(C3)·`phase-3`(C6 화면·N8)·`phase-4`(C4 골든)·`phase-5`(C5 mock·`PARTIAL`, 2026-10-21 Qwen probe)·`phase-6`(C7 알림)·`demo-day`(C9 1차·2차 리허설, C8 사전 run, 10-24 S-LIVE 운영 점검·10-25 S-LIVE·카카오 절차서)·`deployment`(10-22 회사 runtime 구현, 10-24 운영 smoke·분석 정체 진단)·`first-bundle`(10-22 운영 첫 배포)·`navigation`(P1)·`s5`·`program-notices`·`p08`·`kakao-notify`·`eval`(X6a)·`fx01`·`people`·`people-email`·`landing`·`competitors`. 예정: 앱 경로 실추론 로그 〔10-25 결과 대기〕 | 완성도 | 미확인 |
| 외부 의존성 점검 결과·평가 리포트 요약 | `docs/evidence/phase-0/external-deps.md`(①② 통과, ④ 미착수)·`external-deps-api-20261019.md`, ③ 회사 vLLM Qwen probe `docs/evidence/phase-5/qwen-probe-20261021-2343.json`, `docs/evidence/competitors/2026-10-19-competitors.md`(X3), `docs/evidence/eval/`(X6a 평가셋), `docs/submission/experiment-tables.md`(빈 표) | 일부(C1 ①②·③ Qwen probe·X3 있음. Bosun 엔드포인트 확인·C1 ④·X1 리포트 없음. E1'~E4는 회사 GPU 미가용으로 미측정) | 실용성·창의성 | 미확인 |
| 정직성 표(§7)를 슬라이드와 README에 동일하게 포함 | [[18-HACKATHON\|18 해커톤]] §7, 루트 `README.md` "실제인 것과 mock인 것 (요약)", `slides-spec.md`, `limitations.md` | README 요약 반영(2026-10-25). 덱 반영은 덱 정정 작업 몫이라 미확인 | 완성도 | 미확인 |
| 공식 심사 기준 확인 후 §4 갱신 | [[18-HACKATHON\|18 해커톤]] §4 | 완료(2026-10-18) | — | 확인됨 |

## 이 폴더의 파일

| 파일 | 내용 | 채워지는 시점 |
|---|---|---|
| `slides-spec.md` | 발표 덱 제작 명세(18장·20분·영상 클립 5개 + 카카오 10초). 발표 조건·수치 출처표 | 정본. 덱 정정은 이 문서 기준 |
| `deck/sol-radar-deck.pptx` | 발표 덱 파일(git 제외, 별도 제출) | 초안 있음, 정정 중 |
| `slides-outline.md` | 초기 12장 구성안. 지금은 캡처 매핑만 쓴다(`slides-spec.md`가 대체) | 캡처 매핑 |
| `video-storyboard.md` | 3분 영상 컷 표, 실행 모드 표시, 녹화 대체 여부 | 구조 지금, 촬영은 C8·C9 뒤 |
| `architecture.md` | 시스템 아키텍처·데이터 흐름 Mermaid, 실행 모드 표 | 지금(02·03 기준) |
| `evidence-list.md` | 실제 AI 검증 증거 목록과 예정 경로 | 1·2번 있음(C1 ①②, 2026-10-19). 3번 Qwen probe 일부(2026-10-21). 7·9번 일부. 운영 smoke 행 추가(FX-02 분석 완료 차단, 재확인 〔10-25 결과 대기〕). 2026-10-25 갱신 |
| `experiment-tables.md` | E0·E1'·E2·E3 비교 표, E1'·E4 비교 표, 임팩트 예비 실험 표(빈 틀) | X1·X2·B5 뒤 |
| `limitations.md` | 한계·미완성·실행 모드 구분, 외부 의존성 컷 4갈래 발표 문장, E4 문장 | 지금, 10-20 저녁 컷 뒤 1갈래로 확정(일정 근거 ADR-034 17번), E4 는 B5(10-26 오전 오프라인 채점, 2026-10-24 개정) 뒤 |

## 제출 형식 확인 (미입력)

제출 형식(파일 종류·분량·제출 경로)은 아직 받지 못했다. 받는 즉시 이 절에 적고 위 표의 "제출 형식 충족 확인" 열을 채운다. 해커톤 이름·발표일도 미입력이다([[18-HACKATHON|18 해커톤]] 머리 콜아웃).

발표 조건은 2026-10-21 사용자 입력으로 받았다: 사내 해커톤, 심사위원은 사장·부사장·CFO와 AI 심사위원, 30분 중 발표 20분·Q&A 10분, 시연은 녹화 영상을 덱에 삽입, AI 심사위원은 덱(또는 서비스)을 마크다운으로 변환한 파일로 채점. 정본은 `slides-spec.md` 머리의 "발표 조건"이다.

## 관련 문서

- [[18-HACKATHON|18 해커톤]] — §4 심사 기준, §6 데모 시간표, §7 정직성 표, §10 체크리스트
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
- [[11-TESTING|11 테스트]] — §6 증거 규칙
- [수상 전략·핵심 컷 계획](../plans/2026-10-18-hackathon-award-plan.md)
