---
title: "대시보드 네 화면 구현·통합 검증"
status: complete
updated: 2026-10-22
---

# 대시보드 네 화면 구현·통합 검증

사용자의 계획 실행·분배 지시에 따라 `main@c9bc496`에서 격리한 `feat/dashboard-pages-20261022`에서 작업했다. 원래 main과 기존 N3/N6 작업 폴더는 수정하지 않았다. 대기 중 외부 세션은 orca CLI가 없어 접근하지 못했고 네이티브 서브에이전트로 N3·N6·화면 설계/N5·N7을 분배했다. 검증·리뷰 빈도는 ADR-046을 적용했다.

- N3: 현재 사업기회 표/필터·본인 관심 목록·원본 공고 ID·D-3/D-1 worker 알림.
- N5: 조직 분석 이력·서명 커서·2~4건 비교·부분/실패·열별 재시도.
- N6: 5열 보드·BID 생성/재개·담당자/마감·체크리스트·상태/수동 결과·대시보드 슬롯5.
- N7: 저장된 분석 입력의 FTE·점수 대상 후보, 현재 배정의 과부하·공유 후보·별도 기준 시각. 저장/모델 호출 없음.

## 구현 중 발견·수정

1. N5 이력 repo가 DB `MOCK`를 화면 enum `mock`으로 변환하지 않아 실제 행 조회가 실패했다. 필터는 대문자, 응답은 소문자로 변환하고 실제 DB 행 형태의 repo 회귀시험을 RED→GREEN으로 확인했다.
2. DB 검증기의 UNION이 `pg_catalog.name`으로 함수 서명을 63바이트로 잘랐다. 관계 이름을 text로 명시하고 긴 위험 함수 서명을 온전히 검출하는 회귀시험을 RED→GREEN으로 확인했다. 권한 검사와 가드레일은 유지한다.
3. 실제 axe 검사에서 N5 필터 라벨 ID의 공백 때문에 분석 상태·실행 모드 버튼의 접근성 이름이 사라졌다. React `useId()`로 공백 없는 ID를 만들고 같은 ID로 연결했다. 기존 통합 E2E의 axe 실패를 회귀 근거로 남겼다.
4. 기존 로그인 E2E는 공공조달 UI 병합 전의 표·필터·대시보드 이름/구조를 참조했다. 현재 표 caption·DEMO 위치·데이터 구분·우선 검토 목록에 맞췄으며, 골든94점·조직 격리·저장 검증은 유지했다. 기본 목록은 NOTICE 15건(예정 사업 4건 제외)이므로 취소 필터는 14/15건, 전체 DEMO 검사는 `includeEarly=true`로 19건을 확인한다. 새 시험의 빈 상태 문구·비교 영역 선택자도 실제 계약에 맞췄다.
5. 격리 테스트 환경에서 private Storage 버킷 미생성과 host/Docker의 Supabase URL 차이로 readiness가 실패했다. 로컬 버킷 2개를 준비하고 worker 안에 로컬 TCP 연결을 두어 웹과 같은 URL을 사용했다. 제품의 readiness 범위 검사와 로컬 DB 안전 가드는 그대로 유지한다.

## 검증

- 개발 변경 범위 `pnpm verify:changed`: exit0, 웹441건 및 타입·린트·계층·생성물/DB 검사 통과. 이후 unused prop을 제거했다.
- Chromium 부품: 관심 토글·현재 대시보드/공고·4열 비교, 3파일6건 통과.
- 격리 실제 Supabase/PostgreSQL: 41개 마이그레이션 적용, RLS·화면 권한·뷰·함수 검사 통과. `sol-radar-dashboard-43f8`, API59981/DB59982로 공용 로컬과 분리했다.
- 실제 PostgreSQL 마감 알림: 담당자 겸 관심 등록자 포함 최초2건, 재호출0건, 대상자2명·앱 내부 링크2건. 시험 데이터는 트랜잭션 rollback.
- mock Compose: redis·qdrant·AI gateway·worker healthy. 가상 인력200명·공고19건, 사전 분석18/18 완료.
- 최종 전체 `pnpm verify`: exit0. 루트191·웹441·AI101·결정57, 타입·린트·계층·생성물·프로덕션 Next 빌드 통과. 접근성 수정까지 포함한 코드에서 다시 확인했다.
- 최종 `pnpm -C web test:e2e:work`: **17/17 통과**, 읽기 선행 프로젝트 유지. 관심 등록/해제·4건 비교(PARTIAL/FAILED)·BID 프로젝트 생성/체크리스트/상태/수동 결과/재조회·VIEWER 읽기 전용·인력 3건 조회·조직 격리를 실제 로그인 세션으로 검증했다. 종료 후 로컬 데모 기준선도 복구했다.
- axe 14회 검사, 위반 0건. 1440/1280 화면 확인 및 새 화면의 페이지 가로 넘침 없음. 공고 표만 설계대로 내부 가로 스크롤한다. 인력 FTE·현재 충돌 구간은 추가 읽기 전용 화면 캡처로 확인했다.
- 원본 N3 2개·N6 1개 마이그레이션 `cmp` 일치. 최종 E2E 코드의 타입·린트 검사는 전체 verify에 포함했다.

## 독립 리뷰

동일 구현자가 아닌 리뷰 담당 한 명이 N3/N5/N6/N7을 함께 확인했다. N5 변환 결함 수정·회귀시험 재확인 후 미해결 중요 결함 없음. 최종 verify/E2E/시각 결과를 조건으로 승인했고 해당 검증도 통과했다. 이후 실제 axe에서 발견한 필터 이름 결함은 위 수정·최종 재검증 기록으로 확인한다. 클라우드 배포·모바일·결제·자동 배정·모델 변경은 제외했으며 이번 승인 범위와 일치한다.

## 화면 증거

각 링크는 1280px이며 같은 폴더에 1440px도 있다.

- [관심 공고](20261022-validation/screenshots/20261022-phase3-p1-watchlist-loaded-1280.png)
- [분석 4건 비교](20261022-validation/screenshots/20261022-phase3-p1-analysis-four-loaded-1280.png)
- [프로젝트 보드](20261022-validation/screenshots/20261022-phase3-p1-project-board-loaded-1280.png) · [체크리스트·수동 결과](20261022-validation/screenshots/20261022-phase3-p1-project-detail-loaded-1280.png)
- [인력 가용성](20261022-validation/screenshots/20261022-phase3-p1-workforce-fte-loaded-1280.png) · [현재 배정·공유 후보](20261022-validation/screenshots/20261022-phase3-p1-workforce-conflicts-loaded-1280.png)

기존 `phase-3` 공용 증거를 덮어쓰지 않도록 이번 실행 결과를 이 폴더에 보관했다. [E2E 출력](20261022-validation/e2e-work.txt), [axe 결과](20261022-validation/axe-report.json), [메뉴 12개 상태](20261022-validation/menu-status.json).

## 적용 경계

로컬 격리 환경에만 DB를 적용했다. 클라우드 마이그레이션·main 병합·push·운영 배포·실모델 호출은 실행하지 않았다. 원본 3개 마이그레이션은 기존 브랜치와 같은 파일명/바이트를 유지한다. 새 보정은 `20261023000300_watched_opportunities.sql`·`20261023000400_atomic_bid_project_patch.sql`이다.

검증 출력: [전체 verify](20261022-validation/verify.txt), [변경 범위](20261022-validation/verify-changed.txt), [Chromium 부품](20261022-validation/browser-core.txt), [실제 DB](20261022-validation/db-current.txt), [접근성 실패 재현](20261022-validation/e2e-accessibility-FAIL.txt).

계획: [구현 계획](../../plans/2026-10-22-dashboard-missing-pages-plan.md), [UI 설계](../../plans/2026-10-22-dashboard-pages-ui-spec.md).
