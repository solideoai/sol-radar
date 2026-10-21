---
title: "N2 설정 조직 탭·N8 소스별 카드 — 구현 계획"
status: draft
tags:
  - sol-radar
  - plan
updated: 2026-10-21
---

# N2 설정 조직 탭(ADMIN)·N8 소스별 카드 — 구현 계획

> [!note] 상태
> 작업 세션 sol-radar-fa, 배정 sol-radar-12(2026-10-21). 확장 컷을 핵심 컷과 병행하는 사용자 결정(2026-10-21, 12 창)의 조건을 따른다:
> 덧붙이기만 한다, 작업자가 겹치면 핵심 컷이 먼저, freeze 10-23까지 green이 아니면 데모에서 뺀다, 승률·확률·모바일·결제 금지.
> 브랜치 `feat/n2-org-settings`(base main `4e62170`), worktree `sol-radar-worktrees/n2-org-settings`.

## 1. 범위

정본: [[06-UI-UX|06]] §5.8 ①·§5.10, [[05-API-SPEC|05]] §2(`/admin/users*` 미구현 행), [[04-DATABASE|04]] §3.1·§3.6, [[09-SECURITY|09]] RBAC·감사,
[사이드바 설계](2026-10-16-sidebar-ia-design.md) §2.4·N2·N8·D11, [N8 디자인 스펙](2026-10-20-n8-admin-ingestion-design.md) §4.4.

| 할 것 | 하지 않는 것 |
|---|---|
| N2 조직 탭: 구성원 목록(이름·이메일·업무 역할·합류일), 업무 역할(`sol_role`) 변경, 초대(이메일 + 업무 역할), 대기 중 초대 취소, 최근 변경 기록(감사) | 개인 탭 새로 만들기(템플릿 `/{slug}/settings` 계정 화면을 그대로 쓴다, 06 §4.1 "설정 예"), 구성원 내보내기(템플릿 멤버 화면에 남는다), `/admin/users*` Route Handler |
| 역할 변경 감사: `audit_logs` 에 새 action 과 `memberships.sol_role` update 트리거(09 "미구현", 16 미결정 26-5. §2-5 확인 필요) | 템플릿 `activities` 바꾸기, `org_role` 정책 |
| N8 ① 소스별 카드 2장(N8 스펙 §4.4 그대로) | `/admin/sources` API(registry 승인·호출량), 실행 이력 표·서랍·대화상자 변경 |
| N8 사이드바 줄: 이미 `released`·`roles: ["ADMIN"]`(main `9e6d8e2`). 확인만 | 대시보드 파일(54 담당) |

## 2. 결정 (추천안으로 진행, 사용자 위임)

1. **조직 탭 주소는 `/settings/organization`(업무 틀 `(work)`, 추천)**. 기존 `/settings`(템플릿 계정 화면으로 이동)는 그대로 둔다.
   - 대안 ②: `/settings` 를 업무 틀 안의 새 화면으로 바꾸고 개인 탭도 새로 그린다. 템플릿 경로·`e2e-auth` 도우미(`/settings` 이동 기대)를 바꿔야 해서 "덧붙이기만"에 어긋난다.
   - 대안 ③: 템플릿 `/{slug}/settings/members` 를 `sol_role` 기준으로 고친다. 템플릿 계약을 바꾼다.
2. 탭 이동: 새 화면 위에 링크 메뉴 `계정`(`/settings`)·`조직`(지금). 템플릿 `SettingsNav` 에는 ADMIN 에게만 `조직` 링크를 하나 덧붙인다. 탭은 링크 + `aria-current`(design-system 하위 메뉴 규칙).
3. 권한: 화면은 `requireWork` 뒤 `role !== "ADMIN"` 이면 데이터를 읽지 않고 403 안내(N8 `IngestionForbidden` 와 같은 꼴). 서버 함수도 ADMIN 을 다시 확인하고, 최종 판정은 RLS(`20261019000001`)와 `protect_last_sol_admin`(`20261019000014`)이다.
4. 쓰기는 서버 함수(`"use server"`) → `@/server/organization` → repo(anon 키 + RLS). 05 의 `/admin/users*` 는 계속 미구현으로 둔다(화면만 쓰는 쓰기라 서버 함수가 맞다, architecture 스킬).
5. **역할 변경 감사를 넣는다(추천, 사용자 확인 필요)**. [[16-DECISIONS|16]] 미결정 26-5 는 2026-10-20 "해커톤 뒤(데모 흐름 밖)"로 미뤘지만,
   N2 완료 기준(사이드바 설계 N2 "역할 변경 감사 기록")과 06 §5.10 이 이 화면에 감사를 요구한다. 마이그레이션 하나와 트리거 하나라 덧붙이기다.
   감사는 별도 커밋으로 두어, 사용자가 26-5 미룸을 유지하면 그 커밋만 빼고 화면의 "최근 변경 기록"은 `USER_INVITE` 만 보인다.
   action 이름은 `USER_ROLE_CHANGE`. `before_after` = `{before:{solRole}, after:{solRole}, userId}`, `target_type` `membership`, `target_id` 대상 사용자 id. 행위자는 `auth.uid()`(service role·seed 는 null).
6. 최근 변경 기록은 조직의 `USER_ROLE_CHANGE`·`USER_INVITE` 최근 20건만 읽기 전용으로 보인다(RLS: 그 조직 ADMIN).
7. N8 카드는 서버 컴포넌트가 수집 도메인을 읽는다. 소스마다 최신 `SUCCEEDED`·`PARTIAL` 1건, 최신 `FAILED` 1건과 그 run 의 첫 중단 원인 오류. 새 공개 API 없음(N8 스펙 D3).

## 3. 단계

| 단계 | 고칠 파일 | 완료 기준 |
|---|---|---|
| 0 디자인 | web-designer 스펙 `docs/plans/2026-10-21-n2-org-settings-design.md` | 조직 탭 1440·1280 배치, 상태(빈·로딩·오류·403·마지막 ADMIN 거절), 문구, 부품 매핑 |
| 1 DB | `supabase/migrations/20261021000300_sol_role_change_audit.sql`, `scripts/database.test.mjs`, `web/lib/database.types.ts`(바뀌면) | ADMIN 의 역할 변경 → 감사 1행, 같은 값 update 는 0행, 비ADMIN 은 변경 거절·감사 못 읽음, 다른 조직 0행 |
| 2 서버 | `web/server/organization/`(model·repo·service·index + 시험) | 구성원·초대·감사 읽기, 역할 변경·초대·취소. 예상 실패는 결과 값(마지막 ADMIN·권한 없음·잘못된 입력) |
| 3 화면 | `web/app/(app)/(work)/settings/organization/`(page·loading·error·actions·부품), 템플릿 `SettingsNav` 링크 1개 | 1440·1280 넘침 0, 403, 브라우저 시험 |
| 4 N8 카드 | `web/server/ingestion/`(읽기 함수 + 시험), `web/app/(app)/(work)/admin/ingestion/`(카드 부품, page·loading) | N8 스펙 §4.4 그대로, 빈 상태, 브라우저 시험 |
| 5 검증 | — | 슬롯 안 `pnpm verify`·`pnpm -C web test:browser`, 격리 Supabase 실앱 1440·1280 스크린샷 → `docs/evidence/phase-3/settings-org/` |

## 4. 위험

- 감사 트리거가 seed·`pnpm demo:reset` 의 역할 설정에 행을 남길 수 있다. `auth.uid()` 가 null 인 관리 작업은 남기지 않는다(트리거 조건).
- `(app)/settings`(이동)와 `(app)/(work)/settings/organization` 이 같은 첫 마디를 쓴다. 빌드로 경로 충돌이 없는지 먼저 확인한다.
- freeze 10-23 전에 green 이 아니면 브랜치를 병합하지 않는다.

## 관련 문서

- [[06-UI-UX|06 UI]]
- [[16-DECISIONS|16 결정]]
- [[PROGRESS|진행 상황]]
