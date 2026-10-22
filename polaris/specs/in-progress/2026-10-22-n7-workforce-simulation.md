---
title: "N7 인력 배치 시뮬레이션 조회"
doc: "spec-n7-workforce-20261022"
status: in-progress
tags:
  - sol-radar
  - ui
  - scoring
updated: 2026-10-22
---

# N7 — 인력 배치 시뮬레이션 조회

2026-10-22 승인된 [실행 계획](../../../docs/plans/2026-10-22-dashboard-missing-pages-plan.md) Task 4의 구현 범위다. [화면 명세](../../../docs/plans/2026-10-22-dashboard-pages-ui-spec.md)의 N7절이 레이아웃·상태·카피·접근성 기준이다. 저장·자동/수동 배정 확정·새 점수 저장·모델 호출은 없다. 미션 파일은 새로 만들지 않는다.

## 사용자와 계약

조직 전원 ADMIN·SALES·ANALYST·VIEWER가 `/workforce`에서 공고1~3건을 선택해 읽는다. `GET /api/v1/workforce/simulation?bidIds=<UUID,...>`는 서로 다른1~3 UUID를 검증한다. orgId/userId는 세션에서 정하며 요청 필터로 받지 않는다. 잘못된 입력400·미인증401·타 조직 자원404는 기존 봉투를 따른다.

`web/server/workforce/{workforce.model,workforce.repo,workforce.service,index}.ts`의 `simulateWorkforce(orgId,bidIds,deps,now)`는 읽기 전용 repo를 쓴다. now는 서버가 요청당 한 번 만든다. 응답은 공고별 analysisId·snapshotAsOf·period·requiredFte·availableFte·missingReason·후보, 별도 currentAssignmentsAsOf·충돌 구간을 갖는다. 공고 제목·DEMO와 필요 인력/기간 출처를 표시할 정보도 제공한다. 세부 이름은 구현 DTO에 맞추되 snapshot/current 기준을 합치지 않는다.

## 분석 당시 가용성

1. 최신 COMPLETED/PARTIAL의 검증된 `analysisInputSchema` 스냅샷을 선택한다. team·수행 기간·기준일(today)을 그대로 써 기존 `staffAvailability`·`availableFte`·`defaultProjectPeriod`를 재사용한다. 계산식을 복제·변경하지 않는다.
2. 최신 시도만 RUNNING/FAILED면 최근 유효 완료 결과를 쓰며 분석시각과 최신 시도 상태를 밝힌다. 완료 스냅샷이 없거나 검증 불가면 `분석 필요`, FTE는 null/`—`, 공고 상세 링크다. 임의로 현재 인력으로 과거 결과를 대체하지 않는다.
3. UNKNOWN 필요 인력은 기존 예산 구간 추정·missing 정책을 따른다. BUDGET_TIER·기본 기간 출처를 밝힌다. 정보 부족을 0명·미충족으로 바꾸지 않는다. FTE는 실인원과 구분한다.
4. 후보는 스냅샷 점수 대상 인력에 한정하고 역할·기술 근거를 쓴다. 현행 가상 인력은200명이며 27명·고정20FTE 상수를 복원하지 않는다. 요구조건이 없으면 `후보 적합성 확인 필요`다.
5. 후보 표시에는 업무상 필요한 이름·부서·직무·기술·가용성·DEMO만 쓴다. 연락처·성별은 내리지 않는다. 후보 선택/배정/저장 컨트롤은 없다.

## 현재 배정의 기간 충돌

현재 assignments를 한 기준 시각으로 읽고 직원·겹치는 기간별 기존 배정 과부하와 선택 공고 간 공유 후보를 분리해 표시한다. 과부하는 기존 allocation과 가용성 근거가 있어야 한다. 공유 후보는 같은 사람을 두 공고에 확정 배정했다는 뜻이 아니며 부족 확정으로 표현하지 않는다. 후보를 임의 allocation으로 만들어 배정 충돌을 계산하지 않는다.

기간은 기존 엔진의 반열린 구간 `[시작,종료)`다. 단일 공고도 현재 배정 조회 기준을 별도 표시할 수 있으나 과거 snapshot FTE를 덮어쓰지 않는다. 공고별 snapshotAsOf와 전체 currentAssignmentsAsOf를 항상 구분한다. 입력/배정 누락이면 사유를 밝히고 충돌0을 안전 확정으로 표현하지 않는다.

## 완료 기준과 검증

1. 공고 선택·URL복원·1~3건 한도·분석 필요·추정/정보 부족·후보·충돌 결과가 실제 읽기로 동작한다.
2. 서비스 시험은 스냅샷 FTE일치, 현재 배정 변경 후 과거 FTE불변, 실제 겹침1건, 비대상 후보제외, 쓰기 호출없음을 검증한다. 계약 시험은 UUID/건수·세션 조직격리를 확인한다. 기존 골든을 재사용한다.
3. 1440·1280에서 3공고 카드·긴 제목·후보·기간 표를 읽고 페이지 가로 넘침이 없다. 키보드 선택·초점·기준시각·추정사유를 확인한다.
4. 신규 핵심 시험·`pnpm verify:changed`; 전체 verify·변경 흐름 E2E는 통합에서 수행한다. 삭제된 전수 시험은 복원하지 않는다.

## 관련 문서

- [승인 계획](../../../docs/plans/2026-10-22-dashboard-missing-pages-plan.md)
- [화면 명세](../../../docs/plans/2026-10-22-dashboard-pages-ui-spec.md)
- [점수 정본](../../../docs/08-SCORING.md)
- [보안 정본](../../../docs/09-SECURITY.md)
