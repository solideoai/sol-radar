---
title: "최종 시드 보존 수정 구현 보고"
status: reviewed
tags:
  - sol-radar
  - evidence
updated: 2026-10-17
---

# Final review fix report — I1 and M1

Status: implementation committed; source frozen/QUIET. Independent fresh full verification and actual isolated-target seed preservation QA remain pending with the controller.

## Identity and authorized scope

- Workspace: `/Users/leegwanghui/.codex/worktrees/b3ef/sol-radar`.
- Base: `406549b4982b4612db0b653c0f1721b0d83f3d6d`.
- Final commit: `ca719cfff0040e00ff8a3eac98558861d9cbc394` (`fix: 공유 시드 팀 초기화 전 회원 소유권 확인`).
- Exactly five tracked files changed: `scripts/db-seed.mjs`, `scripts/db-seed.test.mjs`, and comment-only edits in `web/app/auth/sign-up/page.tsx`, `web/app/auth/login/page.tsx`, `web/app/(app)/[slug]/settings/team/page.tsx`.
- Tracked checkout clean after commit. No helpers, reviewers, or subagents spawned. Main and photo worktrees were not written. No shared DB, actual Supabase/Auth service, migrations, merges, push, or deployment executed.

## I1 implementation and preservation boundary

The resolved seed team's memberships are read through the existing HTTP client with `asService`, selecting `user_id` and filtering by the resolved `org_id`. Their IDs are checked against the five accounts returned by the existing verified account creation/update flow. Any other membership throws the generic Korean message `시드 계정 외 회원이 있는 팀의 초기화를 거부합니다.`

This check runs before the existing narrow accepted-invitee membership DELETE, the team task/invitation DELETEs, and all later team writes. It does not remove memberships to force acceptance. A seed-only fixture team retains its prior normal reset behavior. The refusal does not include other users' names, emails, or IDs. Existing client transport/origin/error handling is retained.

The canonical organization IDs, five Auth identities, 200-person roster, portraits, catalogs, scoring inputs, SQL, and other application behavior were not changed. The new preflight is scoped to the resolved template team; existing catalog/people upserts and account/profile preparation remain in their original sequence.

## Regression coverage

The existing stateful HTTP fixture now runs both its original seed-only case and a shared-team case. The shared case starts with an accepted seed invitee membership, an additional nonseed membership, that user's task with persisted fields, and an unrelated pending invitation with persisted fields.

The refusal case asserts no organization/membership/task/invitation writes affecting this workflow occur before refusal, compares full membership/task/invitation fixture objects against a structured snapshot, checks Auth/organization identity preservation, rejects silent success, and checks refusal privacy. Canonical people organization upserts are allowed and excluded from the resolved-team mutation assertion.

The original normal assertions remain: two successive seeds restore the unaccepted invitation, preserve all other memberships including other organizations, and keep a promoted invitee-owner membership while the invitation validation refuses it. Added normal checks prove the service-role ownership read precedes resetting on both runs, the team has 11 fixture tasks, and Auth/organization identities stay stable. The membership fixture adapter accepts the exact two valid read shapes and asserts service credentials for the new ownership read versus member credentials for the existing member lookup.

## M1

Three comments now describe profile-only signup bootstrap and routing through the current business organization or explicit organization state. These web files have no executable changes. Relevant installed Next.js `page.md` and `authentication.md` guidance was read before the comment edits.

## Commands and fresh evidence

All commands below ran from the stated b3ef workspace.

1. RED: `node --test scripts/db-seed.test.mjs` before production changes, exit 1, 13 tests / 12 pass / 1 fail / 0 skipped. The failing regression records accepted-invitee membership DELETE, full team tasks DELETE, and full team invitations DELETE followed by writes. Original tests passed. Raw output: `final-fix-red.log`.
2. The initial mutation assertion also counted unrelated canonical people organization upserts, and the task double still swallowed task writes. Corrected the fixture/assertion before the fix to exclude those unrelated upserts and model task writes. Repeated the same RED command against unchanged production, exit 1, 13 tests / 12 pass / 1 fail / 0 skipped. Failure again explicitly shows the destructive team DELETEs. This is the definitive RED proof: `final-fix-red-corrected.log`. Both raw outputs are preserved.
3. Formatting: `pnpm exec prettier --write scripts/db-seed.test.mjs` during RED preparation; final formatting command `pnpm exec prettier --write scripts/db-seed.mjs scripts/db-seed.test.mjs 'web/app/auth/sign-up/page.tsx' 'web/app/auth/login/page.tsx' 'web/app/(app)/[slug]/settings/team/page.tsx'`, exit 0. No new JSON/MJS evidence files were created; all changed MJS files were formatted before the commit.
4. GREEN: `node --test scripts/db-seed.test.mjs`, exit 0, 13 tests / 13 pass / 0 fail / 0 skipped, duration 169.354959 ms. Raw output: `final-fix-green.log`.
5. `git diff --cached --check`, exit 0.
6. Normal commit, without bypass: `git commit -m 'fix: 공유 시드 팀 초기화 전 회원 소유권 확인'`, exit 0. Complete normal-hook output: `final-fix-commit-hooks.log`. Policy gate passed; web `verify:quick` passed including formatting, types, lint, lint guards, 50 test files / 879 tests, structure (0 errors/0 warnings), tokens/colors. Root formatting passed; normal gate root `pnpm test` passed 350 tests / 27 suites / 0 failures / 0 skipped. The root test runner reports duration 1,078,194.55375 ms (about 17m58s); overall hook elapsed time was not separately instrumented. No unrelated performance investigation was performed.
7. Read-only final identity/status checks: `git status --short` empty; `git rev-parse HEAD` returned the final commit above.

All four raw logs and this report are in `.superpowers/sdd/2026-10-17-approved-portraits-integration/`. Existing older audit/log artifacts were not edited.

## Limits and handoff

No fresh full `pnpm verify`, actual two-run Supabase seed, nonseed shared-team live preservation check, browser suite, or Auth E2E was run by this implementer. Normal hooks necessarily ran their configured root and web quick suites once. Independent QA owns the prepared isolated target and will run the fresh full verification plus actual normal seed/idempotence and nonseed preservation refusal scenarios against this committed source. Earlier live-QA attribution must remain attached to its old revision until that work finishes.

No implementation concern remains within the bounded I1/M1 fix from the focused proof. This report does not claim current live QA or final merge readiness. No further source writes or tests will be performed by this worker after this commit; controller can hand off the frozen source now.
