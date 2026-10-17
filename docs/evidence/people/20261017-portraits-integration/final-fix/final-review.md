---
title: "인력 전체 브랜치 최초 리뷰"
status: reviewed
tags:
  - sol-radar
  - evidence
updated: 2026-10-17
---

# Final whole-branch review

**Range:** `f6700e122936bf4d47a72cdfd8e003a9fe940515` → `406549b4982b4612db0b653c0f1721b0d83f3d6d` (39 commits).  
**Verdict:** **With fixes** — one Important finding and one Minor finding. No Critical finding. The Important finding should be resolved before asking for approval of merge preparation.

## Review basis and coverage

Reviewed the supplied full-context package, the binding final-review brief, original people plan/spec changes and approved ADR-021 extensions, the current portrait integration plan, current integration report, independent QA report, selected evidence index, and applicable controller rulings. This is a review of the approved people work, not an assertion that the entire SOL RADAR design is implemented.

The production pass covered all unique changed application/server modules, four append-only migrations, deterministic workbook/allocation/name/fixture tooling, portrait lifecycle/gallery tooling, seed/local-target tooling, and changed test configuration. Tests were reviewed by coverage inventory and targeted assertion inspection, including populated migration rollback/backfill, RLS/privilege checks, real authentication/repository identity binding, every existing business-action guard, current organization transitions, live signup/confirmation/persistence scenarios, portrait binding/fallback checks, and capacity calculations. Repetitive generated JSON and binary assets were assessed through their schemas, binding checks, and recorded independent hash/HTTP/decode evidence; I did not manually repeat 200 metadata entries or re-judge approved faces. Imported general ADR-020 design material was treated as reference context, not as newly implemented production functionality.

One outside-hunk inspection addressed a concrete security question: whether the new v1 guard and downstream profile repository could select different identities when a malformed Authorization header accompanies a cookie. `web/server/auth/auth.service.ts:49` and `web/server/supabase/client.ts:79` confirm that bearer-only authentication rejects a missing/malformed bearer before the repository runs; a valid bearer also supplies the downstream client/claims. The new route tests exercise cookie A versus bearer B and invalid-header rejection using the real auth/service/repository layers. No finding resulted. Line-number reads for the findings below only localized already reviewed code.

No test suite was rerun, no shared DB was accessed, and no source/index/HEAD mutation was made. The only reviewer write is this ignored review artifact. Final read-only inspection found a clean tracked checkout at the stated HEAD.

## Strengths

- **Authorization is separated from declaration.** Public signup options expose only company/version and ID/label pairs. Profile writes derive identity from the verified request, reject injected authority fields, validate the fixed catalog, and retain RLS. The cookie mutation header, strict Authorization precedence, no-store envelopes, and generic unexpected-error responses are consistently implemented.
- **Business entry points are covered beyond layouts.** Page and Server Action boundaries recheck completeness and the sole actual business organization. Wrong or historical personal slugs cannot choose an organization; zero/multiple memberships get explicit state handling. Account cleanup, received invitations, and existing platform administration retain their deliberate exceptions.
- **Migration preservation has meaningful checks.** Operational people and scoring inputs use the same identifiers and composite organization FKs. Backfill includes `created_at`, compares both directions before dropping columns, and is tested against both a populated legacy schema and conflicting partial backfill. New tables are locked down immediately. Hierarchy checks cover both employee placement and parent-kind changes.
- **Fixture and approval integrity are explicit.** Allocation has deterministic integer remainder handling. Source personnel stay in memory, while diagnostics contain safe cell/ID information. Generation rejects roster drift. Human approval binds all 200 exact portraits; prior AI/PENDING evidence remains historical. The reusable avatar uses a strict fixed-path helper and an accessible neutral fallback.
- **Evidence boundaries are unusually clear.** The reports distinguish the passing fixed-window 94/72/68 examples from full pipeline goldens, valid hierarchy constraints from unresolved source parents, and actual test failures from QA-adapter/screenshot failures. They do not claim unimplemented screens are integrated.

## Issues

### Critical

None found.

### Important

**I1 — Reseeding can erase unrelated data in a seed team shared with a non-seed account.**

- **Location:** `scripts/db-seed.mjs:320` and `scripts/db-seed.mjs:321` (existing-team resolution starts at line 295); coverage gap in `scripts/db-seed.test.mjs:220` onward.
- **Trigger:** A local `seed-team` already includes a non-seed user and contains that user's task or an unrelated pending invitation. Running normal `pnpm db:seed` / authenticated E2E now reuses that organization and issues service-role DELETEs for *every* task and invitation with its `org_id`.
- **Impact:** Membership and organization IDs survive, but unrelated users' work/invitations are deleted. The former `removePreviousSeed` explicitly excluded organizations shared with non-seed users before its destructive reset. This change removes that preservation boundary while the new comment promises to update only seed-owned tasks/invitations. Local-only target validation prevents a remote target, but does not establish ownership of rows in that local target.
- **Evidence:** The diff shows deletion predicates limited only by `org_id`, using `asService`. Current tests preserve memberships but allow all task DELETE calls and start with no unrelated invitation, so they cannot detect this loss. The controller confirmed that its prior ruling only authorizes the exact seed-invitee/member membership restoration and is explicitly not broad reset authorization. Current isolated QA did not contain this shared-team scenario; its PASS is not contradicted.
- **Fix:** Restore a fail-closed ownership preflight for an existing team shared with non-seed users, before mutating that team's data, or identify and reset only positively owned fixture rows. Do not infer that all rows are disposable from the `seed-team` slug alone. Add a regression with a non-seed member, that member's task, and an unrelated invitation; verify preservation or an explicit refusal without team mutation, while retaining stable account/org IDs and the normal two-run seed behavior. No shared DB execution is needed to reproduce this control-flow issue.

### Minor

**M1 — Several adjacent comments still describe the removed personal-organization flow.**

- **Locations:** `web/app/auth/sign-up/page.tsx:19`, `web/app/auth/login/page.tsx:32`, and `web/app/(app)/[slug]/settings/team/page.tsx:23`.
- **Issue:** The comments say signup creates a personal organization or that login/deletion returns there. The final implementation intentionally creates only the profile and resolves a current business organization/state.
- **Impact/fix:** These comments mislead future maintenance of the exact policy this branch changes. Update them to the profile-only bootstrap and canonical current-organization entry behavior. This is documentation polish and does not block independently of I1.

## Plan alignment and validation

The approved data, signup, ADR-021 compatibility, and portrait integration work is substantially aligned. It preserves the fixed 200-person roster, 38 TEAM public choices/12 titles, 48 department nodes, 27 scoring rows/7 assignments, fixed capacity example, historical accounts, and approved asset identities. It does not create mobile/payment scope, unreleased organization/person product routes, or avatar writes to real user profiles. The additional standalone account route and retirement of legacy team creation are justified compatibility changes recorded in the controller rulings. I1 is a preservation regression in the seed adaptation, not a request to expand product scope.

Validation relied on the independent report at actual runtime HEAD `a05217a05f0fb9adb3553c02978f0e2d531e9610`: full `pnpm verify` (349 root, 879 web, production build and guards), normal Auth E2E 95/95 without retries/skips, browser 106/106, and 200 Next GET/hash/Chromium decode checks. Only docs/evidence changed afterward. The controller's final read-only confirmation additionally reports matching selected artifact/protected hashes and unchanged production source. These are inherited, attributed results, not reviewer-run tests. They provide strong coverage of the scoped implementation but do not exercise I1.

## Declined to judge — explicit decisions for controller adjudication

- **G1–G10 and full scoring pipeline/score_runs immutability:** required implementations/tests are absent and explicitly outside this completed slice; retain UNVERIFIED, including full G5 despite passing generic RLS.
- **Organization chart, operational employee list, and employee detail product UI:** no released routes exist; helper/assets readiness is not product-screen integration.
- **Complete three-level source organization tree:** 25 TEAM and four GROUP parents lack authoritative evidence. The 13 evidenced TEAM→DIVISION links and unresolved reasons are preserved; inventing links would violate the contract.
- **External OAuth provider connectivity:** the provider round trip was not run. Callback logic and OAuth-like incomplete profile state coverage do not prove external provider setup.
- **Full public E2E at the final runtime revision:** not executed in current QA; historical public-suite results stay attached to their original revision.
- **Shared/production DB upgrade or seed application:** no target snapshot/backup/deployment sequencing approval exists. Isolated populated-upgrade and RLS evidence do not establish safety of an unseen shared database.
- **Full N1 slugless shell, N2 sol_role/ADMIN policy conversion, and direct legacy organization-creation policy retirement:** deliberately deferred by the approved compatibility scope; old RLS capabilities are not represented as full ADR-021 completion. This verdict covers the application entry points actually changed.
- **Fresh subjective visual uniqueness/quality review and future 200-avatar page performance:** the user already approved these exact PNGs, and no list screen is released. Byte integrity/decoding are established; no replacement, optimization, or new face judgment is authorized or needed here.
- **Actual merge/push/deployment:** not authorized. Known main conflicts in `docs/11-TESTING.md` and `docs/PROGRESS.md` need the documented combined resolution after approval; no SQL-file conflict is reported.

## Readiness

**Ready to merge? With fixes.** Address I1 in the scheduled fix wave and perform a scoped independent re-review with the focused preservation regression and required normal gates. M1 can be corrected in the same wave. No other Critical/Important issue was found in the approved people implementation. After that, it is suitable for a concrete user-approved merge-preparation step, while the explicit UNVERIFIED items and separate shared-DB approval remain intact.
