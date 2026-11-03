---
title: "업무 화면 기술 정보 글자 빼기 검증 (모델·버전·실행 모드·KST·영문 코드)"
status: done
tags: [sol-radar, ui, verification]
updated: 2026-11-03
---

# 업무 화면 기술 정보 글자 빼기 (2026-11-03)

사용자 요청: "사용자 입장에서 필요없는 정보들이 너무 많아. KST 이런 단어도 그렇고 모델명을 뭐 썼는지 그런 거랑 몇버전인지 그런 정보들." 전 화면 검토 보고(6묶음) 뒤 사용자가 "1"(1·2·3번 묶음: 모델·버전·실행 모드·KST·영문 코드)을 골랐다. 결정은 [[16-DECISIONS|ADR-080]], 화면 계약은 [[06-UI-UX|06 화면]] "화면 글자에서 뺀 기술 정보"다. 브랜치 `feat/plain-screen-text`(origin/main `23416ed8`에서 시작), 운영 반영 전.

## 바꾼 것

| 묶음 | 화면 | 수정 |
|---|---|---|
| 모델·버전·실행 모드 | 공고 상세 | 머리의 "· revision N", 분석 요약 띠의 "분석 상세 정보"(실행 모드·AI·알고리즘·프로필 revision), 점수 분해의 "점수 계산 기준", 결정 모델의 "모델 상세 정보"·`recommendationBasis` 줄, 분석 이력 표의 "분석 실행 모드" 열을 지웠다. "Mock 응답(데모 데이터)"는 남겼다 |
| | 추천 분석 | "생성 정보"(모델 이름)를 지웠다. 판단 이유 저장 글의 "Bosun"은 화면에서 "결정 모델"로 읽는다(구역 첫 문장·팝업) |
| | 분석 결과 비교 | 행별 "분석 상세 정보", 선택 분석의 "비교 기준" 표, "추가 필터"(실행 모드)를 지웠다. 기준이 다르면 "비교 기준이 다릅니다(공고 내용·분석 방식)" 한 줄만 둔다 |
| | 입찰 프로젝트·인력 배치 | "알고리즘 …", "분석 aaaaaaaa · 공고 revision N" 줄을 지웠다 |
| KST·UTC | 상세·변경 이력·대시보드·발주 현황·입찰 일정·인력 배치·상단바·수집 관리 | 시각 뒤 "KST", UTC 원값 툴팁을 지웠다 |
| 수집 번호 | 변경 이력 | "rN" → "N번째 수집", "revision 목록" → "수집 기록". 단계 이력의 "r1" 링크 → "변경 이력" |
| | 회사 역량 | "rev N ·" 를 지우고 변경 이력은 "N번째" |
| 영문 코드 | 결정 패널 | 검토 플래그는 배지 이름만, 결정 이력 "(SALES)" → "(영업)", "ADMIN·SALES 역할만" → "관리자·영업 역할만" |
| | 근거 서랍 | `EXACT` 등 → "원문과 일치"·"원문과 일치(띄어쓰기·기호 차이)"·"원문과 비슷함"·"원문에서 찾지 못함", 문자 범위·첨부 오류 코드 줄 삭제, "수집 … KST" → "수집 …" |
| | 자격 사유 | "회사 프로필 등록 SW_BUSINESS 보유(HELD)" → "회사 프로필에 보유로 등록됨"(저장 문장은 그대로, `qualification-reason.ts`) |
| | 권한 안내 | 입찰 프로젝트·수집 관리·회사 역량·조직 설정의 역할 코드 → 관리자·영업·분석·임원·열람(`web/server/shared/sol-role-label.ts`) |
| | 그 밖 | 출처 키 `g2b-bid-notice` → "나라장터 입찰공고", "(상태: PARTIAL)" → "(상태: 부분 완료)", "Early Opportunity 포함" → "입찰공고 전 단계 포함", 분석 이력·비교의 실패 코드 → "분석에 실패했습니다", `QWEN_UNAVAILABLE` 라벨 → "AI 서버 미접속" |

남긴 것: "Mock 응답(데모 데이터)" 고지, 실패 배너의 접힌 "오류 상세", 조직 설정 화면의 역할 코드, 데이터 수집 관리 화면의 실행 모드·오류 코드, 첫 화면 문구, 사람이 쓴 결정 사유·공고 원문(예: 부처 공고 제목의 "알고리즘"). 데이터·API·DB·권한·라우팅은 그대로다.

## 화면 글자 비교

격리 로컬 스택(mock, DEMO 공고)의 실제 앱에 영업 계정으로 로그인해 업무 화면 25곳의 글자(접힌 `details`를 모두 펼침)를 모았다. 기술 글자 패턴(`KST`·`UTC`·`Qwen`·`Bosun`·`sol-v`·`알고리즘`·`실행 모드`·`질문 세트`·`공급자`·`revision`·`rN`·`HELD`·`EXACT`·`RULES_ONLY`·`PARTIAL`·역할 코드·`g2b-bid-notice`·`Early Opportunity`)이 걸린 줄 수(첫 화면·로그인·수집 관리 제외):

| 상태 | 걸린 줄 | 걸린 화면 |
|---|---|---|
| 수정 전(main `980da9da`) | 121 | 분석 결과 비교 74, 공고 상세 5곳 34, 변경 이력 5, 그 밖 8곳 각 1(부처 공고 제목 1 포함) |
| 수정 후 | 2 | 부처 공고 제목의 "알고리즘"(공고 원문), 변경 이력 글자 파일 첫 줄의 주소 경로(화면 글자 아님) |

## 캡처

- 공고 상세 FX-01 전체: [수정 전](before-full-detail-0001-1440.png) · [수정 후](after-full-detail-0001-1440.png), FX-03 전체: [수정 전](before-full-detail-0003-1440.png) · [수정 후](after-full-detail-0003-1440.png)
- 분석 결과 비교 전체: [수정 전](before-full-analysis-1440.png) · [수정 후](after-full-analysis-1440.png)
- 변경 이력 전체: [수정 전](before-full-revisions-0001-1440.png) · [수정 후](after-full-revisions-0001-1440.png)
- 추천 분석 팝업: [수정 전](before-insight-dialog-1440.png) · [수정 후](after-insight-dialog-1440.png), 근거 서랍 [수정 후](after-evidence-drawer-1440.png)
- 첫 화면 390·1440(수정 후): 대시보드·공고 목록·FX-01·FX-03·변경 이력·분석 결과 비교·회사 역량·발주 현황·인력 배치·입찰 일정·조직 설정(`after-<화면>-<폭>.png`)

페이지 가로 넘침(`scrollWidth - clientWidth`): 위 11개 화면을 360·390·768·1280·1440px에서 재어 모두 0([측정값](overflow.json)).

## 검증

- `pnpm verify:changed`: 통과(서식·타입·린트·웹 148파일 1,232시험·lodestar·토큰·색). 첫 실행은 서식 9파일로 실패해 `prettier --write` 뒤 다시 통과.
- 관련 Chromium 브라우저 시험 13파일 127개: 첫 실행 통과. 바뀐 글자를 단언하도록 고친 시험은 analysis-comparison·bid-detail-origin·workforce-view·market-view·procurement·decision·opportunities-filters·recommendation-insight(지운 글자가 없음을 함께 단언).
- 판단 이유의 "Bosun" 바꿔 읽기 시험 1개 추가: 바꾸기를 끈 코드로 실패를 확인한 뒤 되돌려 통과(insight 브라우저 시험 2파일 27개).
- `qualification-reason.test.ts`에 `(HELD)`·`NOT_HELD`·면허제한 문장 3개 단언 추가(단위 시험에 포함).
- 로그인 E2E(`web/e2e-auth`) `run-mode-badge`·`fx01-flow.write`·`admin-ingestion` 은 새 글자에 맞춰 고쳤고 타입 검사만 통과했다. 실행하지 않았다(데모 재시드·Compose worker가 필요한 work·ingestion 설정).

## 하지 않은 것

- 운영 반영(main push = Vercel 배포)은 하지 않았다. 화면 동결(2026-11-03) 뒤의 변경이고 촬영 화면이 바뀌므로 반영은 사람이 정한다.
- 검토 보고 4번(반복 고지·내부 숫자), 5번(일반 화면의 운영자 정보), 6번(DEMO 중복)은 손대지 않았다.
- gateway 대체 문장(`services/ai/src/sol_ai/insight.py` `BASIS_TEXT`)의 "Bosun"은 원천을 고치지 않았다(고치면 회사 AI gateway 재생성이 필요하다).
- 장표 그림(`docs/submission/slides/assets/`)과 slides-spec 의 옛 캡처 설명은 옛 화면 그대로다.
