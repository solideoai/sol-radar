---
title: "가상 직원 등급·수행 이력 직급 정합 (2026-10-30)"
tags: [sol-radar, evidence, people]
updated: 2026-10-30
---

# 가상 직원 등급·수행 이력 직급 정합 (2026-10-30)

[인물 수행 이력](../20261029-project-history/README.md) 리뷰 후속이다. 브랜치 `fix/people-review-followups`(기준 main `a9d302b2`). 사용자 결정(2026-10-30): "등급·이력 함께" — 직급을 기준으로 기술 등급과 수행 이력을 같이 맞춘다.

## 고친 이유

v2 까지는 기술 등급이 직급과 상관없이 사번 나머지(`number % 4`)로 정해졌다. 그래서 인턴 1명이 특급이었고, 팀장 21명 가운데 12명이 초급·중급, 수석 34명 가운데 7명이 초급이었다. 팀장 21명 가운데 14명은 수행 이력에 PL·PM 역할이 한 건도 없었다.

## 바뀐 것

- 생성기 `scripts/people/capabilities.mjs`를 `synthetic-people/v3`로 올렸다. 직급표 `TITLE_CAREERS`가 등급 후보·이력 건수·최근 PL/PM 건수를 정한다. 경력 시작 시기·프로젝트 기간은 지금처럼 등급(`CAREERS`)이 정한다.

  | 직급 | 등급 | 이력 건수 | 최근 PL/PM |
  |---|---|---|---|
  | 본부장(그룹장·이사 이상 같음) | 특급 1명 | 5건 | 2건(최근 PM) |
  | 팀장(소장 같음) | 고급 10·특급 11 | 4건 11·5건 10 | 2건(특급은 최근 PM). PM·PL 직무 3명은 모든 이력이 본인 직무 |
  | 수석 | 고급 17·특급 17 | 4건 20·5건 14 | 고급 1건, 특급 2건. PM·PL 직무 9명은 본인 직무 |
  | 책임 | 중급 56·고급 54 | 3건 53·4건 57 | 고급 1건 |
  | 담당 | 초급 33 | 2건 14·3건 19 | 없음 |
  | 인턴 | 초급 1명 | 1건 | 없음 |

  전체 등급은 초급 34·중급 56·고급 81·특급 29명이다. 이력 건수는 1건 1·2건 14·3건 72·4건 88·5건 25명이다.
- `fixtures/people/solideo.people.json`: v2 대비 `grade` 156명, `pastProjects` 182명, `capabilityVersion` 200명만 바뀌었다. 이름·메일·부서·직급·사진·직무·스킬·가용성·자격은 그대로다(키별 비교 스크립트로 확인).
- 마이그레이션 `20261030001000_align_demo_grade_history.sql`: 고정 데모 조직(`org-01`)의 데모 직원(`is_demo`, `capability_source = 'SYNTHETIC'`) 가운데 **직급 코드가 fixture 와 같은 행만** `grade`·`past_projects`·`capability_version`을 바꾼다. 운영에서 직급을 바꾼 직원은 v2로 남는다. 행을 만들지 않고, 다시 돌려도 결과가 같다.
- 후속 마이그레이션 `20261030001100_align_retitled_demo_people.sql`: 적용 전 운영 읽기(2026-10-30)에서 200명 가운데 직급이 fixture 와 다른 직원은 SOL-P0065 한 명이었다(운영 그룹장 `SOL-J006`, fixture 수석 `SOL-J009`). `001000`은 이 직원을 건너뛰므로, 운영 직급(그룹장) 기준 v3 값(특급·5건·최근 PM)을 따로 넣는다. 운영 직급이 그룹장일 때만 바뀌고, fixture 직급인 로컬·시드 DB에서는 아무 행도 바꾸지 않는다.
- `scripts/people/check.mjs`·`web/e2e-auth/support/people-read-cases.ts`: 직급을 넘기고 `synthetic-people/v3`를 기대한다.

## 점수 영향 없음

- 분석은 `team_member_scoring`에서 `member_id, role, grade, skills, availability`를 읽는다(`web/server/analysis/analysis.repo.ts:70`).
- `grade`는 입력 모델로 옮겨질 뿐 계산하는 곳이 없다. `web/server` 전체에서 `grade`를 읽는 곳은 저장 모델(`analysis-store.model.ts:274`), 점수 입력 모델(`scoring.model.ts:49`, `analysis-input.model.ts`), 인물 서랍 표시(`person-drawer.tsx`)뿐이다. 규칙 엔진 요소·인력 시뮬레이션·결정 모델 입력(`services/ai`의 `staffing[].grade`는 공고 요구 등급이지 직원 등급이 아니다)은 직원 등급을 읽지 않는다.
- 새 분석의 입력 스냅샷에는 바뀐 등급이 들어가므로 `input_snapshot_hash`는 달라진다. 점수 값은 같다. 이미 저장된 분석 스냅샷은 바뀌지 않는다.
- 시험으로도 묶었다. v3 생성기의 직무·스킬·가용성·자격은 200명 모두 v1(`20261021000600`)과 같고, 마이그레이션 적용 전후로 이 네 열은 한 행도 바뀌지 않는다.

## 검증

| 검사 | 결과 |
|---|---|
| `node --test scripts/people/*.test.mjs` | 12/12 통과. 후속 `001100` 시험: 시드(fixture 직급)에서는 0행, 운영처럼 SOL-P0065 가 그룹장이면 그 1행만 그룹장 기준 값으로 바뀌고 다시 적용해도 같음(직급 조건 제거 변형은 실패). 그 전 11/11 통과. 새 시험: 직급별 등급·건수·리드(인턴·담당은 리드 없음, 팀장·수석·본부장은 리드 있음), v3 마이그레이션 PGlite(다른 조직·비데모·비SYNTHETIC·직급 바뀐 직원 3명 제외 197행만 바뀜, 계산 입력 4열 불변, 되돌리면 200행, 다시 적용해도 같음) |
| 변형 확인 | 등급을 사번 나머지로 되돌림 → 2건 실패. 리드 0건 → 2건 실패. 마이그레이션의 직급 조건 제거 → 실패. 출처 조건 제거 → 실패. 모두 원복 |
| `pnpm people:check:fixtures` | `{"ok":true}` |
| 조직도 이름 찾기 한글 조합 입력 | `org-name-finder.browser.test.tsx` 9/9 통과. CDP 로 마지막 글자를 조합하는 중의 Enter(keyCode 229, `isComposing`) → `compositionend` → Enter(13) → submit 순서를 만든다(진단 시험으로 이 순서를 확인). 조합 중 keydown 에서도 검색하게 바꾼 변형은 2건 실패로 잡힘 |

## 운영 반영

사용자 승인 뒤에 한다. 결과는 아래에 적는다.
