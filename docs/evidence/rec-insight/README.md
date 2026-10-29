# 추천 분석(ADR-066) 증거

스펙 `polaris/specs/in-progress/2026-10-29-recommendation-insight.md`, 계획 `docs/plans/2026-10-29-recommendation-insight.md`. 통합 브랜치 `feat/rec-insight`.

| 파일 | 내용 | 기준 커밋 |
|---|---|---|
| `df-<상태>-<폭>.png` (14장) | 부품 브라우저 시험 화면: empty·pending·delayed·done-model·done-template·failed·readonly, 1440·1280 | `edb99a1e` |
| [e2e-20261029.md](e2e-20261029.md) | 격리 로컬 스택(mock)에서 끝까지 확인 a~g 통과, 결함 없음 | `83003280` |
| `e2e-<상태>-<폭>.png` (6장) | 실제 앱 화면: empty·done·failed, 1440·1280 | `83003280` |

## 보안 리뷰 반영(2026-10-29)

security-auditor 리뷰 뒤 고친 것. 각 수정은 시험을 먼저 실패시킨 뒤 구현했다.

| 지적 | 수정 | 커밋 |
|---|---|---|
| 중-1 직접 insert 로 속도 제한·모델 설명 재사용을 건너뜀 | 제외 제약 `recommendation_insights_pending_or_model_once`(모델 설명이 있는 run 에 PENDING 금지, 23P01), 있던 PENDING 다시 넣기도 속도 제한 | 0f `8f008ae2` |
| 중-2 인젝션 의심 run 도 Qwen 에 감 | Worker 가 `injectionSuspected` 를 보내고 공고 인용을 뺌(ac `bd94962b`), gateway 는 이 값이나 guard 가 걸리면 모델을 부르지 않고 TEMPLATE(`INJECTION_SUSPECTED`), 숨은 문자·금지어 추가·판정 취지 표현 검사(09 `f8f5dd16`), 화면 안내 문구(df `85401d1c`) | 위 셋 |
| 하-3 mock 판별이 `fixture` 하나 | gateway mock 의 insight `model` 을 `mock` 으로, 화면 판별도 `mock` | 09 `f8f5dd16`·df `85401d1c` |
| 하-4 relay 202 의 pollUrl 을 요청 경로와 대조하지 않음 | `insightAcceptedFor(targetPath)` 로 같은 경로만 받음 | 0f `8f008ae2` |
| 실패 job 이 남아 같은 jobId 다시 넣기가 무시됨 | `removeOnFail: true` | 0f `8f008ae2` |

남은 위험은 스펙 §8 에 있다(목록 기반 검사, 한글 수사·단위 변환 숫자, 출력 속 URL, 실 vLLM enum guided 확인).
