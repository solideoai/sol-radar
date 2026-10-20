---
title: "제출물 색인"
status: draft
tags:
  - sol-radar
  - hackathon
  - submission
updated: 2026-10-20
---

# 제출물 색인

제출 마감 **2026-10-27**. 공식 심사 기준은 [[18-HACKATHON|18 해커톤]] §4(실용성 30 · 사업적 창의성 25 · 완성도 25 · 확장 가능성 20)다. 이 폴더는 제출물 **초안 구조**이고, 구현·측정 전인 항목은 상태 열에 그대로 적는다. 파일이 있다는 것만으로 완료로 보지 않고, "제출 형식 충족 확인" 열이 확인됨이 될 때 완료다.

## 18 §10 체크리스트 ↔ 파일

| 18 §10 항목 | 파일 경로 | 상태 | 심사 기준 | 제출 형식 충족 확인 |
|---|---|---|---|---|
| 저장소 링크(README가 00 인덱스 역할, 기동 절차는 10) | 루트 `README.md`, [[00-README\|00 인덱스]], [[10-DEPLOYMENT\|10 배포]] | 작성 중(루트 README에 정직성 표 미포함) | 완성도·확장성 | 미확인(제출 형식 미입력) |
| 아키텍처 다이어그램 1장 | `docs/submission/architecture.md` | 초안(Mermaid 2개) | 확장성·실용성 | 미확인 |
| 데모 영상 3분(백업용) | `docs/submission/video-storyboard.md`(스토리보드). 영상 파일 없음 | 초안(촬영 전) | 완성도 | 미확인 |
| 발표 슬라이드 | `docs/submission/slides-outline.md`(구성안). 슬라이드 파일 없음 | 초안 | 네 기준 전부 | 미확인 |
| `docs/evidence/` 테스트·E2E·기동 로그 | `docs/evidence/README.md`(색인), `docs/submission/evidence-list.md`(AI 검증 증거 목록) | 있음: `phase-0`(C0 통합 기동·C1 ①②)·`phase-1`(C2 정책 시험·seed)·`phase-2`(C3)·`phase-4`(C4 골든)·`phase-5`(C5 mock·`PARTIAL`)·`people`·`landing`·`competitors`. 추가됨(2026-10-20): `phase-3`(C6 화면·E2E)·`phase-6`(알림 시험)·`demo-day`(mock 1차 리허설)·`eval`(녹음·원형·데이터셋 도구 확인). 실추론·모델 성능 평가 로그는 예정 | 완성도 | 미확인 |
| 외부 의존성 점검 결과·평가 리포트 요약 | `docs/evidence/phase-0/external-deps.md`(①② 통과, ③ 엔드포인트 대기, ④ 미착수)·`external-deps-api-20261019.md`, `docs/evidence/competitors/2026-10-19-competitors.md`(X3), `docs/evidence/eval/`(녹음·분할·데이터셋 도구 증거 있음, 모델 평가 리포트는 예정), `docs/submission/experiment-tables.md`(빈 표) | 일부(C1 ①②·X3 있음. C1 ③④·X1 평가 리포트는 예정) | 실용성·창의성 | 미확인 |
| 정직성 표(§7)를 슬라이드와 README에 동일하게 포함 | [[18-HACKATHON\|18 해커톤]] §7, `slides-outline.md` 11장, `limitations.md` | 초안(슬라이드·README 반영 전) | 완성도 | 미확인 |
| 공식 심사 기준 확인 후 §4 갱신 | [[18-HACKATHON\|18 해커톤]] §4 | 완료(2026-10-18) | — | 확인됨 |

## 이 폴더의 파일

| 파일 | 내용 | 채워지는 시점 |
|---|---|---|
| `slides-outline.md` | 슬라이드 12장 구성(11 주제 + 정직성 표), 장마다 데이터 상태 | 화면 캡처는 C6·mock 리허설 증거에서 선택 가능. 슬라이드 편집은 별도이며 수치는 X1·X2·X3 결과 기준 |
| `video-storyboard.md` | 3분 영상 컷 표, 실행 모드 표시, 녹화 대체 여부 | 구조 지금, 촬영은 C8·C9 뒤 |
| `architecture.md` | 시스템 아키텍처·데이터 흐름 Mermaid, 실행 모드 표 | 지금(02·03 기준) |
| `evidence-list.md` | 실제 AI 검증 증거 목록과 예정 경로 | 1·2번 있음(C1 ①②), 9번은 mock 리허설 일부 있음(2026-10-20). 실모델·live 증거는 예정 |
| `experiment-tables.md` | E0~E3 비교 표, 임팩트 예비 실험 표(빈 틀) | X1·X2 뒤 |
| `limitations.md` | 한계·미완성·실행 모드 구분, 외부 의존성 컷 4갈래 발표 문장, E4 문장 | 지금, 10-20 저녁 컷 뒤 1갈래로 확정(ADR-027), E4 는 X6e 뒤 |

## 제출 형식 확인 (미입력)

제출 형식(파일 종류·분량·제출 경로·발표 시간)은 아직 받지 못했다. 받는 즉시 이 절에 적고 위 표의 "제출 형식 충족 확인" 열을 채운다. 해커톤 이름·주최·발표일도 미입력이다([[18-HACKATHON|18 해커톤]] 머리 콜아웃).

## 관련 문서

- [[18-HACKATHON|18 해커톤]] — §4 심사 기준, §6 데모 시간표, §7 정직성 표, §10 체크리스트
- [[19-DEMO-SCENARIO|19 데모 시나리오]]
- [[11-TESTING|11 테스트]] — §6 증거 규칙
- [수상 전략·핵심 컷 계획](../plans/2026-10-18-hackathon-award-plan.md)
