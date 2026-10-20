---
title: "현행 코드 기준 문서 정정"
status: review
tags:
  - sol-radar
  - ops
  - test
updated: 2026-10-20
---

# 현행 코드 기준 문서 정정

기준은 main `301f2a5ebd35bb0177b1f7d50506c2158748bb0e`, 작업 브랜치는 `docs/current-code-reconcile`이다. 실제 정본은 `docs/`이며 `.claude/docs`는 없다. superpowers의 worktree 격리·독립 영역 병렬 조사·교차 리뷰·완료 전 검증 절차를 적용했다. 코드나 설계 정책을 바꾸는 작업이 아니라, 현행 구현과 저장된 증거로 확인되는 문서 오류를 정정했다.

## 수정과 근거

| 영역 | 정정 | 확인한 근거 |
|---|---|---|
| README·제출 문서 | 이미 main에 있는 C6 화면·업무 API·C7 결정 기록/알림을 미구현으로 적은 상태를 갱신. mock 리허설 증거를 추가하되 실모델·최종 제출 완료로 표시하지 않음 | `web/app/(app)/(work)/`, `web/app/api/v1/`, `web/server/notifications/`, [C9 1차 기록](../demo-day/20261020-1009/checklist.md) |
| 실행 모드·정직성 표 | 모든 모드의 자동 mock 대체 금지. infra·web env 정합성, worker/gateway 재생성 및 호스트 web 재기동을 명시 | `infra/run-modes.json`, `infra/compose.yaml`, `web/app/_lib/run-mode.ts`, `web/server/bids/` |
| 배포·수집 | Compose에 web 서비스가 없고 NOTIFY 선택 env는 이미 전달됨. worker의 NOTICE·입찰공고 키 연결과 후속 소스·보조 조회·Redis quota 집계를 구분 | `infra/compose.yaml`, `web/worker/main.ts`, `web/worker/ingest-queue.ts`, `web/server/ingestion/quota.ts` |
| 파이프라인 | documents 생산/복구와 미구현 소비자를 구분. 추출은 analysis 안에서 호출. 실제 파서·Qdrant 검색·임베딩 연결은 후속 설계로 표시 | `web/worker/main.ts`, `web/server/analysis/analysis.service.ts`, `services/ai/src/sol_ai/parse.py`, `adapters/qwen.py` |
| 알림·관측성 | 현행 IN_APP/SENT 삽입·outbox 상태 비교 갱신, 카카오 mock/공고 이벤트 소비/metrics·관리 화면 미구현 상태를 명시 | `web/server/notifications/outbox.{repo,service,model}.ts`, `web/app/`, `services/ai/src/sol_ai/app.py` |
| DB·API·계약 | 프로필 총 3행과 org-01 요약 2행, 실제 seed 연결과 시험 위치, 첨부 초기 PENDING/null 상태, HTTP UUID 키/worker 키 경계, 503 분류, 실패 인용 ref 보존·nullable/생략 경계 정정 | `scripts/demo-reset.mjs`, `scripts/demo/plan.mjs`, `scripts/demo-reset.test.mjs`, `20261019000002`·`20261019000009` 마이그레이션, `web/server/bids/bids.service.ts`, `normalized-bid.model.ts`, `sol_ai/citation.py` |
| AI 계약 | FastAPI 기본 422 봉투, Qwen 본문 항상 포함·첨부 글자 수 근사 예산, questionSet 검사와 미구현 stateTemplate 검사를 구분 | `services/ai/src/sol_ai/{app,contracts,registry}.py`, `adapters/{qwen,local_setup}.py` |
| 평가·훈련 문서 | 실제 `sol_eval` 서브명령·출력 디렉터리·별도 manifest, 미구현 평가/메모리 probe 명령 구분, 존재하는 가상 기업 6개·녹음 실측·요일 오기 정정 | `services/ai/eval/sol_eval/__main__.py`, `services/ai/eval/README.md`, `fixtures/eval/companies/`, [녹음 증거](../eval/recording-20261020.md) |
| 검증·데모 절차 | C6 spec의 `e2e:work` 실행 경로, 없는 admin 상태 API 대신 현재 gateway 상태 확인, Qwen 모델 식별자와 실제 추론 성공 구분. 핵심 컷에 없는 최근 변경 목록 단언 제거·자격 근거 버튼 3개/전체 인용 8건 구분 | `web/playwright.{auth,work}.config.ts`, `web/server/bids/dashboard.model.ts`, `sol_ai/app.py`, [리허설 관찰](../demo-day/20261020-1009/checklist.md) |
| 당시 기록과 현황 | ADR-033 E10의 당시 초안 표기와 후속 확정 구현 `89188d2`를 구분. 삭제된 Vercel 스크립트는 링크 대신 삭제된 경로 텍스트로 보존 | `services/ai/kev/question-sets/v0.2.json`, git log, `docs/boilerplate/first-deployment.md`의 보류 콜아웃 |

## 검증

- 세 영역을 서로 다른 검토자가 교차 확인했다. Important 지적 1건(과거 C1 기록으로 당일 API 잔량을 확인하게 하는 문구)을 당일 서비스별 기록·확인 가능한 잔량 기준으로 고치고 재검토했다. 미확인 잔량은 미검증으로 기록하고 live 장면에서 제외한다. 남은 Important/Critical 지적은 없다.
- README·번호 문서·제출 문서·boilerplate·이 보고서 47파일에서 로컬 링크와 위키링크 2,310개를 검사해 끊어진 파일 참조 0건을 확인했다. 삭제된 스크립트 링크 2개를 정정했다. 수정 문서의 날짜·코드 블록도 확인했다. 외부 URL의 현재 내용·앵커는 이번 검사 대상이 아니다.
- `services/ai`에서 `uv run --frozen --no-sync python -m sol_eval --help`와 `uv run --frozen --no-sync python -m sol_eval labels check ../../fixtures/eval/labels/fixture.v0.1.jsonl`을 실제 실행해 둘 다 exit 0을 확인했다. [도움말](20261020-cli-help.txt)의 4개 서브명령이 문서와 일치하고 [라벨 검사](20261020-cli-labels.txt)는 items 19·labels 89·problems 0이다. 모두 CONSTRUCTED/RULE 라벨이며 인간 검수나 실모델 평가 결과가 아니다. DB·네트워크·모델 호출 없이 로컬 fixture를 검사했다.
- 사용자 지정 `verify-slot.sh`로 감싼 전체 `pnpm verify`가 exit 0으로 끝났다. 루트 723/723·웹 183파일 5,738/5,738·AI 1,369/1,369와 프로덕션 빌드, 서식·타입·린트·구조·토큰·색·DB 타입 검사를 통과했다. AI 의존성의 기존 Starlette 사용 중단 예정 경고 1건은 남는다. [전체 검증 로그](20261020-verify.txt)는 줄바꿈·줄 끝 공백·파일 끝 빈 줄만 정규화했다.

## 보존한 범위

ADR의 결정·요구 설계·과거 실행 SHA와 실패 기록·당시 계획은 보존했다. 미구현을 완료로 바꾸거나 데이터셋 도구 smoke를 모델 평가로 바꾸지 않았다. 다른 세션의 main 미커밋 변경과 제출 슬라이드 구성안은 옮기거나 수정하지 않았다. 실제 env 파일·공유 DB·외부 API·모델·GPU·기동 상태를 읽거나 바꾸지 않았으며, push·배포·main 직접 커밋/병합도 하지 않았다.
