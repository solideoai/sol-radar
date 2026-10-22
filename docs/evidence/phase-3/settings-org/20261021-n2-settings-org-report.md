---
title: "N2 설정 조직 탭 + N8 소스별 카드 — 검증 보고(2026-10-21)"
tags:
  - sol-radar
  - evidence
updated: 2026-10-21
---

# N2 설정 조직 탭 + N8 소스별 카드 — 검증 보고

배정: sol-radar-12 → sol-radar-fa. 브랜치 `feat/n2-org-settings`(base main `4e62170`).
계획은 [구현 계획](../../../plans/2026-10-21-n2-org-settings-plan.md), 화면 명세는 [디자인 스펙](../../../plans/2026-10-21-n2-org-settings-design.md)이다. N8 카드는 [N8 디자인 스펙](../../../plans/2026-10-20-n8-admin-ingestion-design.md) §4.4·§4.8 을 따른다.

## 결정 출처

- 확장 컷 병행(S5·N9·N2+N8·P0-8): 사용자 결정 2026-10-21(12 창), ADR-039. 조건: 덧붙이기만, 핵심 컷 우선, freeze 10-23 까지 green 이 아니면 데모에서 뺀다, 승률·확률·모바일·결제 금지.
- 디자인 D1~D16: 모두 추천 ①. 12 추천안(사용자 위임 2026-10-21).
- 업무 역할 변경 감사(미결정 26-5): 별도 커밋 `d57f5c7`. 사용자 결정(12 창, 2026-10-21): N2 에 넣는다.
- 3e 보안 검토 Medium(재초대 역할 변경 감사 누락): 사용자 결정(3e 세션, 2026-10-21) — N2 병합 전에 고친다. 아래 §5.
- N8 카드 실앱 스크린샷: 사용자 결정 2026-10-21 — 브라우저 시험으로 갈음한다.

## 1. 만든 것

- 화면 `/settings/organization`(ADMIN 전용, 아니면 권한 없음 안내): 구성원 표(업무 역할 선택 상자, 마지막 ADMIN 안내, 자기 강등 확인 뒤 대시보드로), 초대 폼(기본 VIEWER, 같은 이메일은 기한 7일 연장·역할 갱신), 대기 중인 초대(취소 뒤 초점 이동), 최근 변경 기록 20건.
- 서버 `web/server/organization/org-settings.{model,repo,service}.ts`. 권한은 RLS·DB 트리거가 정하고 서비스는 ADMIN 을 먼저 확인한다.
- 템플릿 설정 하위 메뉴(`[slug]/settings/settings-nav.tsx`)에 ADMIN 일 때만 "조직" 탭.
- 마이그레이션 `20261021000300_sol_role_change_audit.sql`(커밋 `d57f5c7`): `memberships.sol_role` 이 바뀌면 `audit_logs` 에 USER_ROLE_CHANGE.
- N8 `/admin/ingestion` 소스별 최근 수집 카드 2장(fixture·g2b): 실행 가능 모드, 마지막 성공·실패(원인 라벨·코드), 적재(신규·변경), 격리. 수집이 끝나면 "더 보기"로 행을 붙이지 않았을 때만 `router.refresh()` 로 카드를 다시 그린다.

## 2. 검증 결과

| 검사 | 결과 | 명령 |
|---|---|---|
| 전체 검증 | exit 0. 웹 시험 222파일 6913건, 빌드(`/settings/organization`·`/admin/ingestion`), lodestar, 토큰·색·DB 타입, AI 1478, decision 129 | `pnpm verify`(슬롯 안) |
| 조직 설정 브라우저 시험 | 17/17. 초대 단추 폭 시험은 `@lg:justify-start` 를 지우면 1440·1280 둘 다 실패(변형 확인) | `pnpm -C web exec vitest run --config vitest.browser.config.ts …/org-settings.browser.test.tsx` → [기록](20261021-org-settings-browser-test.txt) |
| 소스별 카드 브라우저 시험 | 16/16(단 960·1120·1216·1376px 2칸, 넘침 없음, 순서 고정, 빈 소스) | `…/source-cards.browser.test.tsx` |
| 조직·수집 단위 시험 | 2623/2623 | `pnpm -C web exec vitest run server/ingestion server/organization …` |
| DB 정책 시험 | 감사 트리거 1건 추가, 커밋 게이트에서 통과 | `scripts/database.test.mjs` |

## 3. 실앱 확인(격리 Supabase `sol-radar-fa-n2`, `AI_PROVIDER=mock`)

| 확인 | 결과 |
|---|---|
| 1440·1280 첫 화면 | 넘침 없음(문서 폭 = 창 폭 − 스크롤 막대). [1440](20261021-phase3-settings-org-loaded-1440.png) · [1280](20261021-phase3-settings-org-loaded-1280.png) |
| 역할 변경 | 저장·토스트·감사 기록(ANALYST → SALES → ANALYST) |
| 초대 | 새 초대·재초대(기한 연장, 역할 갱신)·이미 구성원 칸 오류. [채운 화면](20261021-phase3-settings-org-filled-1440.png) |
| 초대 취소 | 토스트, 마지막 행이라 카드 제목으로 초점 |
| 자기 강등 | ADMIN 둘일 때 확인 대화상자(처음 초점 [취소]) → 대시보드로, 사이드바에서 데이터 수집 관리가 사라짐. [대화상자](20261021-phase3-settings-org-self-demote-1440.png) |
| 권한 없음 | SALES 로 열면 안내와 [대시보드로]. 템플릿 설정 하위 메뉴에 "조직" 탭 없음. [화면](20261021-phase3-settings-org-forbidden-1440.png) |
| 콘솔 | 로딩 화면의 React key 경고를 고친 뒤 `/health/ready` 503(격리 환경에 Redis·worker 없음)만 남음 |

실앱에서 고친 것: 초대 단추가 남은 폭을 채우던 결함(`@lg:justify-start`, 시험 추가), 로딩 화면이 key 를 담은 객체를 펼치던 경고.

## 4. 하지 않은 것·남은 것

- N8 카드 실앱 스크린샷 없음(위 결정). 실앱에서 run 이 끝날 때 카드가 다시 그려지는지는 worker 가 없어 보지 못했다.
- `pnpm -C web test:e2e:auth` 미실행. 템플릿 설정 세 화면(계정·멤버·팀)은 하위 메뉴 탭 prop 만 더했다.
- 카드의 "최신"은 `finished_at` 순이고 실행 이력은 `started_at` 순이라 기준이 다르다.
- 정본(05·06·09) 반영은 병합 뒤 sol-radar-45.

## 5. 보안 검토 반영(3e, 2026-10-21)

- Medium: 마이그레이션 `20261021000610_invitation_sol_role_audit.sql`. 재초대로 `invitations.sol_role` 이 실제로 바뀌면 USER_INVITE 감사 한 행을 남긴다(`before.solRole` 이전 역할, `after` 는 insert 감사와 같은 모양, 행위자 `auth.uid()`, JWT 없는 관리 작업은 남기지 않음). 재초대는 막지 않는다. action 제약(`audit_logs_action_check`)은 바꾸지 않는다. 화면 "최근 변경 기록"은 재초대를 "초대 · 이메일 · 새 역할" 한 줄로 보인다.
- Low 1(`request_id` 는 부른 사람이 정하는 헤더 값): 마이그레이션 주석에 "추적에만 쓰고 행위자는 `actor_id` 로만 판단"을 적었다. 정본 09 반영은 45 몫.
- Low 2(초대 메일 속도 제한 없음): 해커톤 뒤 후속.
- 시험: DB 정책 "재초대 업무 역할 변경 감사(20261021000610)" 1건(역할 바꾼 재초대 1행, 같은 역할 0행, JWT 없음 0행, org-01 ADMIN 의 org-02 멤버십·초대 update 0행·감사 없음, org-01 ADMIN 만 읽음). 변형 5개 모두 잡힘. 모델 시험 +1(재초대 행).
