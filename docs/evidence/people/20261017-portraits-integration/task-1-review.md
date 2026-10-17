---
title: "승인 사진 통합 Task1 독립 리뷰"
status: reviewed
tags:
  - sol-radar
  - evidence
updated: 2026-10-17
---

# Task 1 SPEC + QUALITY review

## Spec Compliance

- ✅ Current integration Task 1 implementation is compliant. Both exact packages were assessed: b3ef `f695ef4fe80beac4059c38fda74dffd7b77e2a85..a05217a05f0fb9adb3553c02978f0e2d531e9610`, and original asset Task 2 `cc070c910313290d3c1391dfae08d7651aa8b60e..8ba281060d1cb27c6e3cb06da22b5d4ab3ca801e`. Shared manifest/approval/AI evidence and 200 PNGs were evaluated together; unique docs/helper/component/tests were reviewed separately.
- ❌ One Minor documentation issue remains in original asset Task 2's final checkout: its current progress still claims approval pending and READY0 (9663 `docs/PROGRESS.md:47`, `:51`). This does not invalidate the approved assets or b3ef integration gate; see M1.
- Approval explicitly distinguishes human APPROVED from the manifest READY API contract and historical AI/PENDING evidence: `docs/evidence/people/20261017-portraits-approval.json:3`, `:7`, `:9`, `:22`, `:2224`; `fixtures/people/solideo.portraits.json:9`. Recorded time is identified as record creation time, without inventing the user message timestamp (`approval.json:8`). User approval of these exact 200 photographs is supplied authority, not inferred from machine PASS.
- The reusable helper returns fixed public PNG URLs only for exact SOL-P0001–SOL-P0200 IDs, including a length guard against a trailing newline (`web/lib/demo-portrait.ts:1`). The client component uses existing Avatar/Image/Fallback plus a neutral existing icon and accessible names, with no user avatar_url or product-route integration (`web/components/people/person-avatar.tsx:3`, `:13`).
- Meaningful mapping and invalid-ID behavior is covered (`web/lib/demo-portrait.test.ts:5`, `:12`); browser checks cover an actual PNG, missing/out-of-range IDs and native decode failure (`web/components/people/person-avatar.browser.test.tsx:20`, `:30`, `:41`). The error test substitutes transport bytes and waits for an actual image error; it does not replace Avatar behavior.
- Snapshot/roster/catalog/actual-byte identity, 200 unique hashes, no orphan assets, READY human hash bindings and prior AI review preservation are enforced in `scripts/people/approved-portraits.test.mjs:17`, `:70`. The PLANNED fixture correction keeps every original rejection assertion and isolates the test from the newly READY repository fixtures (`scripts/demo-people.test.mjs:236`). No validator or gate weakening appears in either package.
- Current b3ef documentation accurately limits completion to approved static assets/helper/Avatar and targeted checks; full verification, live HTTP/Auth, unreleased screens and complete G1–G10 are explicitly outstanding (`docs/PROGRESS.md:113`, `:115`; `docs/evidence/people/20261017-portraits-integration-task1.md:32`). No new screens, menu, DB/signup implementation or migrations appear in this change.

### Cannot verify from these diffs

- Fresh full `pnpm verify`, actual Next GET status/MIME/SHA for all 200 URLs, isolated live Auth/RLS/signup regression and merge readiness remain independent QA/controller work (`docs/plans/2026-10-17-approved-portraits-integration.md:55`). This gate is not evidence those have passed.
- Complete G1–G10/scoring pipeline, organization chart/detail consumers and overall product completion are cross-task or unimplemented; retain their documented unverified state (`docs/evidence/people/20261017-portraits-integration-task1.md:32`).
- Invocation history proving `markPortraitReady` was called rather than equivalent JSON editing, historical individual imagegen calls/display/inspection, pre-write external audit immutability and all protected main/history hashes cannot be established from final diffs alone. Reports describe these steps and preserve approval/AI history; controller should retain the already collected preflight/freeze/tool records. This review did not recreate approval, regenerate images, rerun historical generation or broaden into a whole-branch audit.
- Source-workbook comparison contents are deliberately unavailable to the reviewer. The supplied release log records `sourceComparison: passed`, errors0; it was not rerun or used to print source personal information (`release.log:5`).

## Strengths

- Simple implementation: seven-line pure path helper and 26-line existing-UI composition, with explicit unknown-ID and error fallbacks (`web/lib/demo-portrait.ts:1`; `web/components/people/person-avatar.tsx:13`).
- Approval binds exact people/catalog labels and byte hashes while preserving prior AI reviews and historical PENDING honestly (`scripts/people/approved-portraits.test.mjs:17`, `:70`; `docs/evidence/people/20261017-portraits-approval.json:22`, `:2224`).
- Hook failure was preserved and corrected by constructing a valid PLANNED test input, without discarding rejection assertions (`scripts/demo-people.test.mjs:236`; `planned-fixture-red.log:13`; `planned-fixture-green.log:1`). Final mandatory hook success is visible, not merely claimed (`commit-gate.log:36`, `:471`, `:473`, `:474`).

## Issues

### Critical (Must Fix)

None found within this task.

### Important (Should Fix)

None found within this task. Independent QA remains required before wider integration claims.

### Minor (Nice to Have)

**M1 — Original asset checkout's current progress contradicts its final READY200 manifest.** In `/Users/leegwanghui/.codex/worktrees/9663/sol-radar/docs/PROGRESS.md:47`, human approval/READY/release remains unchecked; `:51` states all photographs are still GENERATED, human approval is awaited, READY0 and release fails. That final checkout also contains human APPROVED and READY200 (`docs/evidence/people/20261017-portraits-approval.json:3`; `fixtures/people/solideo.portraits.json:9`). The historical dated AI evidence must remain unchanged, but an undated current-progress paragraph should not send a future reader back to approval that already occurred. Add a bounded follow-up note or update only the current photo status, link the separate approval and b3ef release evidence, and avoid claiming a fresh 9663 release/full verify that was not run there. The old Task 2 checklist at `docs/plans/2026-10-16-solideo-people-portraits.md:73` can likewise be annotated with the follow-up boundary rather than indiscriminately checked. Current b3ef progress already communicates the true status and is unaffected.

## Evidence inspected and focused check

- Read both packaged diffs; structured inspection counted all 200 manifest entries (READY200, human PASS200, MALE100/FEMALE100), all approval/AI snapshots and their schema/history. Shared approval, AI and manifest reconstructed bytes are identical between packages. No separate tracked-source reread was needed for a cut-off function.
- Inspected original Task 2 brief/report including its appended approval follow-up. The historical generation-stage `NEEDS_CONTEXT` and AI PENDING record remain appropriately preserved; M1 concerns the current progress prose, not those historical records.
- Inspected reported RED/GREEN logs: helper assertion RED1/GREEN14 (`helper-red-assertion.log:10`, `helper-green.log:6`); Avatar RED4/GREEN4 (`avatar-red.log:88`, `avatar-green.log:6`); PLANNED fixture RED/GREEN (`planned-fixture-red.log:15`, `planned-fixture-green.log:4`). Inspected release success (`release.log:5`), type generation/type-check success (`type-check.log:3`, `:6`) and final normal hook web879/root349 PASS (`commit-gate.log:36`, `:471`, `:473`, `:474`). No remaining warning/error noise was found in the final outputs inspected; expected RED/first-hook failures are retained as evidence.
- One named focused risk check: imported files could drift from the approved binding or differ between worktrees. A read-only Python check recomputed all 200 PNG SHA-256 values in both b3ef and 9663; checked actual roster/name/gender/catalog labels/paths against the complete approval snapshot; checked manifest human READY/hash and prior AI review/hash identity; checked PNG signature/1254×1254 dimensions, exact directory contents and shared manifest/approval/AI bytes. Result: 200 unique hashes, 444,095,216 bytes, snapshot `19cbd9408e9672273db9405073dde5f9133d7715fa40041e51b91c824e8ff0e1`, zero anomalies. No test suite reruns, source/index/HEAD mutations or subagents.

## Assessment

**Task quality: Approved, with Minor M1.** The current integration gate is clean for independent QA to proceed against the frozen b3ef source. The component/helper are bounded and the approval binding is sound; correct the separate original asset checkout's progress text without changing approved assets or overstating cross-task validation.
