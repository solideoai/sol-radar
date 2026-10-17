---
title: "최종 수정 범위 재검토"
status: reviewed
tags:
  - sol-radar
  - evidence
updated: 2026-10-17
---

**I1 — Reseeding can erase unrelated data in a seed team shared with a non-seed account — ADDRESSED.** `scripts/db-seed.mjs:315` reads the resolved team's memberships with the existing service-role client; `scripts/db-seed.mjs:320` derives the allowed IDs from the five verified seed accounts. `scripts/db-seed.mjs:321` rejects any other membership before the accepted-invitee membership DELETE at line 325, task/invitation DELETEs at lines 330–331, and subsequent team writes. The check does not delete or filter memberships to manufacture ownership. The refusal at line 322 is generic Korean and contains no other user's identity. Existing account/profile preparation and canonical people upserts remain in their authorized original sequence.

**M1 — Several adjacent comments still describe the removed personal-organization flow — ADDRESSED.** `web/app/auth/sign-up/page.tsx:19` now describes profile-only signup bootstrap; `web/app/auth/login/page.tsx:32` describes profile completion and current business-organization/state routing; `web/app/(app)/[slug]/settings/team/page.tsx:23` describes routing through the common entry point after deletion. All three changes are comments only.

### New Breakage in the Fix Diff

None found. The ten production lines add the bounded membership ownership preflight. Seed-only teams retain their existing reset path. The stateful regression retains the original two-run invitation/membership assertions and promoted-owner preservation assertions while adding actual task-state handling and the shared-team refusal case. No executable web behavior changed.

### Checks and Evidence Reviewed

- Scope check: read the supplied `review-406549b..ca719cf.diff` once, covering only `406549b4982b4612db0b653c0f1721b0d83f3d6d` → `ca719cfff0040e00ff8a3eac98558861d9cbc394`, five files. Read the exact I1/M1 findings, binding fix brief, implementer report, and relevant numbered source context. This was one scoped re-review, not a new whole-branch review.
- Regression inspection: `scripts/db-seed.test.mjs:247` creates the nonseed membership, persisted task, and unrelated pending invitation alongside an accepted seed-invitee membership. Lines 360–381 assert no team mutation, full fixture preservation, explicit refusal, and privacy. Lines 391–417 retain two-run behavior, assert preflight-before-reset ordering, retain 11 team tasks, preserve account/org identity, and retain the promoted-owner rejection and membership preservation assertions. The query adapter at lines 302–315 distinguishes the service ownership read from the ordinary member read and verifies credentials.
- Report/output cross-check: `final-fix-report.md` names `node --test scripts/db-seed.test.mjs` for both RED and GREEN. Read `final-fix-red-corrected.log`: 13 tests, 12 passed, 1 failed; its failure records the accepted-invitee membership DELETE and broad task/invitation DELETEs. Read `final-fix-green.log`: 13 tests, 13 passed, 0 failed/skipped. These outputs agree with the added regression and fix.
- Normal-hook output check: `final-fix-commit-hooks.log` records the policy gate, web formatting/types/lint/guards, 50 web test files and 879 passing tests, structure with 0 errors/0 warnings, tokens/colors, root formatting, and 350 root tests with 0 failures/skips. The log ends with the normal commit gate passing and commit `ca719cf`.
- Independent actual-CLI evidence check: `final-fix-qa-evidence/shared-team-refusal-proof.json` identifies the final commit, actual CLI exit 1, explicit failure, no fixture email/ID in CLI output, exact identity/team/membership/task/invitation tuple preservation, and preservation of the nonseed membership/task and unrelated pending invitation. `normal-seed-stability.json` records stable Auth/email, organization, operational, scoring, department, and title identities across normal seed runs. `fixture-cleanup-proof.json` records restored Auth/org identities and the fixed 200 people/27 scoring rows. These are attributed independent QA results, not reviewer-run checks.
- Review execution check: no suite reruns, live service calls, subagents, source writes, index writes, HEAD changes, or branch changes. The sole reviewer write is this requested review artifact. Fresh full `pnpm verify` is controller-owned and still pending for purposes of this report; no fresh full-verification PASS is claimed.

### Out-of-Scope Observations

None. Previously recorded deferred/UNVERIFIED scope is unchanged and was not reopened.

### Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.** I1 and M1 are closed by this fix. Final overall readiness remains subject to the separately running fresh full verification and controller integration decision.
