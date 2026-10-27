---
title: "N5 조직 분석 이력과 결과 비교"
doc: "spec-n5-analysis-20261022"
status: done
tags:
  - sol-radar
  - ui
  - api
updated: 2026-10-27
---

# N5 — 조직 분석 이력과 결과 비교

> 상태: **완료**(2026-10-27 확인, `in-progress/`에서 옮김). 근거: main `546a997d`(2026-10-22 "대시보드 업무 화면 네 개 구현", [통합 기록](../../../docs/evidence/navigation/20261022-implementation.md)).

2026-10-22 승인된 [실행 계획](../../../docs/plans/2026-10-22-dashboard-missing-pages-plan.md) Task 2의 구현 범위다. [화면 명세](../../../docs/plans/2026-10-22-dashboard-pages-ui-spec.md)의 N5절이 레이아웃·상태·카피·접근성 기준이다. 새 분석 실행·모델 호출·분석 변경·별도 비교 API는 범위 밖이다. 미션 파일은 새로 만들지 않는다.

## 사용자와 결과

ADMIN·SALES·ANALYST·VIEWER가 `/analysis`에서 자기 조직 모든 공고의 저장 분석 이력을 읽고 2~4건을 비교한다. 현재 세션의 orgId만 사용한다. 다른 조직 분석 단건은 일반 404이며 이력에 나타나지 않는다. 미인증·업무 조직 미설정은 기존 업무 가드를 따른다.

## 계약

- 신규 `GET /api/v1/analyses`: `AnalysisHistoryQuery = {bidId,status,recommendation,runMode,cursor,limit}`. 선택 필터 기본 null, limit 기본20·1~100. `created_at desc,id desc` keyset, HMAC 커서는 조직·필터 지문에 묶는다. 다른 범위 커서는 거부한다.
- 응답 `Page<AnalysisHistoryItem>`. 항목은 기존 AnalysisView의 id·bidId·revision·profileRevision·status·runMode·solScore·recommendation·errorCode·reviewFlags·queuedAt·finishedAt·model.algorithmVersion에 bidTitle·isDemo를 더한 요약이다. 스냅샷·대형 모델 분포는 목록에 싣지 않는다.
- 도메인 함수 `listAnalysisHistory(orgId,query,deps)`는 기존 ServiceResult/Page 규약을 따른다. `web/server/bids/analysis-history.{model,repo,service}.ts`, 도메인 배럴, 업무 page와 route를 쓴다. 요청의 orgId/userId는 지원하지 않는다.
- 비교는 기존 `GET /api/v1/analyses/:id`를 선택당 한 번, 최대4번 호출한다. `compare=id1,id2` URL로 선택 복원, 중복 제거, 5번째 선택 차단. 직접 URL4건 초과는 안내하고 재선택하며 임의 부분 결과를 만들지 않는다. 필터 변경은 커서를 지우고 선택은 유지한다.

## 비교 의미

저장 SOL Score·5요소(points/maxPoints·정보 부족 사유)·자격3상태/사유·revision·프로필revision·알고리즘버전·실행모드·분석시각·실패사유·reviewFlags를 표시한다. 기준 차이는 경고한다. 점수 재계산·버전 보정·성공 순위화는 하지 않는다. 기존 SOL Score 고지문을 쓴다.

PARTIAL은 남은 규칙 결과와 실패/대체 사유를 보여 준다. FAILED/QUEUED/RUNNING의 없는 값은 `—`와 상태로 표시하며 0점을 만들지 않는다. 저장 요소가 missing 정책으로 보수적 점수를 갖는 경우에는 그 값과 정보 부족 사유를 함께 보여 준다. 실패한 단건만 오류·재시도하며 성공 열은 유지한다.

## 완료 기준과 검증

1. 조직 이력에 여러 공고가 나오고 status/runMode/공고/권고 필터·더 보기가 실제 데이터로 작동한다.
2. 필터/조직 커서 재사용은 거부되고 타 조직 단건은404다.
3. 4건 선택·URL복원·선택 해제·PARTIAL/FAILED·한 열 재시도가 동작한다.
4. 1440·1280에서 페이지 넘침 없이 4열 비교와 긴 제목·사유를 읽을 수 있다. 색 없이 상태·키보드 선택·초점이 전달된다.
5. 신규 핵심 서비스·계약 시험과 `pnpm verify:changed`; 통합 때 전체 verify·변경 흐름 E2E를 실행한다. 삭제된 전수 시험은 복원하지 않는다.

## 관련 문서

- [승인 계획](../../../docs/plans/2026-10-22-dashboard-missing-pages-plan.md)
- [화면 명세](../../../docs/plans/2026-10-22-dashboard-pages-ui-spec.md)
- [API 정본](../../../docs/05-API-SPEC.md)
- [보안 정본](../../../docs/09-SECURITY.md)
