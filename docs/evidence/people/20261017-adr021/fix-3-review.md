# Task8 fixround3 scoped re-review

Reviewed FIX_BASE `e4654386a85e52e84d960787a9aeb4bb0653995e` → final HEAD `21c8b9785cc04fcd1d99eddd92e75cbe157bcedb`. `git rev-parse HEAD` matched; supplied `review-e465438..21c8b97.diff` was 8,808 bytes, four files, one commit. Read that package once, then checked the changed files and directly relevant surrounding implementation. Binding scope: the final formal dispatch and rulings in `task-8-fix-3-brief.md`, these three findings, and breakage introduced by their fixes.

## Per-finding verdicts

1. **T9-AUTH-SELECTOR-1 / T9-F1 — ADDRESSED.** `web/e2e-auth/settings-account.write.spec.ts:269` scopes the exact organization-name visibility assertion to the banner after the approved existing sidebar-toggle interaction. The sole-owner alert, enabled denial dialog, unchanged settings URL, account survival, dashboard heading, absent organization switcher, and both-account cleanup remain intact (`:257`, `:273`). No first/nth, skip, or weakened global-count assertion was added. `AppTopBar` renders the current name in this banner and shows it when collapsed (`web/components/app-shell.tsx:262`, `:273`, `:278`), so this selects the intended current-organization display rather than the duplicate sidebar text.
2. **T9-AUTH-SELECTOR-2 / T9-F2 — ADDRESSED.** `web/e2e-auth/team-settings-isolation.write.spec.ts:94` scopes both immediate and post-reload exact renamed-name checks to that banner (`:96`, `:102`), using the approved collapse once. Trimmed input, toast, main description, reloaded input, unchanged pathname and fixture cleanup remain. The fixture clears cookies before login (`:30`), the provider defaults open and persists toggles in `sidebar_state` (`web/components/ui/sidebar.tsx:54`, `:83`), and the server layout reads that cookie (`web/app/(app)/[slug]/layout.tsx:65`), supporting the collapsed display before and after reload. Product labels, roles and sidebar behavior are unchanged.
3. **T9-RETRY-FOCUS / T9-F3 — ADDRESSED.** `web/app/auth/organization-state/state-retry.tsx:11` retains pending disablement and adds supported Base UI `focusableWhenDisabled` plus local aria-disabled visual/pointer treatment. Installed Button/useButton/useFocusableWhenDisabled code confirms native disabled is replaced with aria-disabled for this option, disabled clicks/activation are blocked, and Tab remains available. Progress wording, polite live region and existing transition/refresh remain; no focus effect, timeout or navigation policy was added. Final real-Chromium tests use a deferred response (`state-retry.browser.test.tsx:29`) and assert actual pending/completed focus and aria-disabled for normal/error states, repeated Enter/Space/programmatic-click duplicate prevention (`:43`), and keyboard exit plus destination focus after late completion and retry unmount (`:70`). The exit uses production AccountLink with the established next/link mock; it prevents actual browser navigation and explicitly renders/focuses the simulated destination. This is meaningful component-level coverage, not live Next navigation proof.

## New breakage

**None** found within this scoped diff (Critical: none; Important: none; Minor: none).

## Out-of-scope observations

None.

## Actual checks inspected and run

- Inspected retained independent QA `task-9-evidence/auth.log:114` onward: the two exact strict-locator failures and **93 passed / 2 failed**. Inspected `manual-retry-focus-detail.json`: `activeTag: BODY`, `retryFocused: false`.
- Inspected actual `task-8-evidence/fix-3-focus-red.log`: **2 failed / 1 passed**, both same-state completion failures explicitly showing BODY focus after the retry button was enabled. This is behavior RED, distinct from the retained invalid `toBeFocused` matcher attempt.
- Inspected `fix-3-focus-green.log`: affected **12/12 passed**; `fix-3-focus-final.log`: final harness **3/3 passed**, no warnings/errors in that output. The earlier 12-pass run predates only the link test-harness correction; it is not represented as a fresh final combined run.
- Inspected retained `fix-3-browser-matcher-error.log`, `fix-3-commit-gate.log`, `fix-3-link-import-error.log`, and `fix-3-link-mock-error.log`: invalid matcher, raw-anchor lint rejection, missing process import, and Link interop failures remain honestly recorded. The intermediate `fix-3-commit-gate-final.log` passed ordinary tests despite that browser harness failure; the report clearly distinguishes this from final browser GREEN and the subsequent amended commit.
- Inspected `fix-3-commit-gate-amended.log`: normal gate passed formatting, route typegen/TypeScript, lint/guards, **865/865 web tests across 49 files**, architecture and token/color checks, recording final commit `21c8b97` after final browser GREEN. `fix-3-types.log` is empty; the amended hook supplies affirmative typecheck output. `fix-3-auth-collection.log` lists **95 tests in 19 files** and establishes collection only.
- Reviewer ran only read-only source/evidence inspection, HEAD/package-size checks and `git status --short` (empty). No tests were rerun: no specific unanswered code concern warranted additional focused execution. No broad diff/log, redundant suites, helpers/subagents, live/server/Auth/seed/DB/container operation, or source/test/config/index/HEAD mutation occurred. Only this report was written.

## Scoped final verdict

**PASS for fixround3 scoped code review: all three findings ADDRESSED; no new scoped breakage found.** Independent QA still owns the new build, actual-stack same-state focus GREEN, and actual reruns of the two failed Auth tests. Collection and component browser results do not establish that live GREEN. This verdict does not approve a release or claim full Task8/ADR completion.
