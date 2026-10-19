# Scoped live UI correction review — f579a2a..cd4a91c

**Scoped spec verdict: PASS for the reviewed source correction.** The label/metadata separation and left-pane bounds correction preserve the approved chart contracts. The new summary-count pointer regression discovered during this review is also addressed in the follow-up.

**Scoped quality verdict: APPROVED at `cd4a91c673fcd411a31e8f86086a5bb429918fde`.** No remaining Critical, Important or Minor source issue found in these two files. Root QA may proceed with the authorized final verification and affected live checks. This is not actual whole-page axe GREEN, final Task4 acceptance, or merge/push/deployment approval.

## Scope and method

Reviewed the complete fixed `review-f579a2a..cc5c45b.diff`, then only its finding's `review-cc5c45b..cd4a91c.diff`, the brief/report, targeted source/test context, raw component/gate/byte receipts, and the original safe actual axe attachment. Final checkout HEAD is clean `cd4a91c...`, parent `cc5c45bdd8e6e27627e745d0f33f04aaf9918a4f`, original frozen base `f579a2a6b27fb0ab05650179aba6609a5fb07182`.

This continues one scoped review of the two-file runtime correction; no second broad branch/API/Auth/RLS review was performed. I did not run tests, build, runtime, DB, gates, or subagents, and did not write source/config. Only this ignored report was written. Original whole-branch and prior I1/M3 reports remain historical records.

## Reviewed correction and preserved contracts

- **Actual axe41 mismatch — source correction addressed.** The original safe `qa/day19-target/safe-people-pending25-f579a2a6b27f/axe-chart-1440.json` contains one serious `label-content-name-mismatch` violation with41 nodes, starting with `button[aria-label="AX사업본부"]`. The change handles departments/unknown summary as well as people cards. Visible counts/title/scoring metadata become siblings, connected with stable `aria-describedby` IDs (`web/components/people/org-chart.tsx:208`, `:349`, `:406`, `:426`). Button visible contents now agree with the exact accessible labels. Useful metadata remains visible and accessible; Avatar semantics are retained through the unchanged shared component. No axe rule/context exclusion, metadata aria-hidden workaround, new package or name-contract change is present.
- **Exact person action and whole-card operation preserved.** Person name remains the real native button with exact `${name} 상세 보기`, original `org-person-*` ID and original `onSelect(person,event.currentTarget)` trigger (`org-chart.tsx:344`). Its empty stretched pseudo-element and focus ring cover the relative visual card; `data-person-id` is on that card's li, while finder focus/highlight remains on the button. The tests physically click Avatar/title/scoring coordinates, verify the actual native button trigger, and cover Enter and Space → shared Drawer → Escape focus return. Existing44px Avatar,3/4 grid columns, full-card finder bounds and M3 expiry remain covered. No duplicate role-button/tab stop or shared Drawer/Avatar edit was introduced.
- **Department counts and hierarchy preserved.** Full-size native department buttons retain names, handlers, aria-current/expanded/controls. Counts are accessible positioned siblings with pointer-events-none, so the real row button still receives count-area input. Empty individual groups/divisions remain non-disclosures. Actual parent traversal, bundle state, count calculation, team ordering/selection, URL and finder logic are unchanged.
- **Left-pane bounds — scoped component defect confirmed and corrected.** `org-chart.tsx:180` changes only the aside max-height from viewport minus6rem to minus14rem, keeping300px width, sticky position and internal vertical overflow. With a realistic page-height header, long tree and short selected team, both widths originally measured top182/bottom1086,client904,document1110 for a1000px viewport; corrected metrics are top182/bottom958,client776,document1000,scrollHeight2093. Tests assert internal wheel scrolling while document scrollY stays fixed and the final tree row remains reachable. Actual composed-app measurements are still pending; component metrics are not presented as those results.

## New scoped finding discovered and addressed

**F1 — Unknown-summary count press lost its click in cc5c45b — ADDRESSED in cd4a91c.** `org-chart.tsx:212` stretched the smaller summary Button's pseudo-element across its relative h2, but shared `web/components/ui/button.tsx:8` applies an active translate. The active transform establishes a new containing block, shrinking the pseudo-element during a press. A physical down over the sibling count could therefore release outside the actual button and fail to toggle. This was a real new pointer-interaction regression, not a speculative concern or the historical axe mismatch.

I raised this specific source interaction, then the same UI owner reproduced it without a broad investigation. The preserved `live-ui-summary-press-red.log` reports2FAIL at1280/1440: label width99.14 versus heading283; point(404.88,465) outside the label; held active translate≈1px; pseudo shrank to97.14×38; held hit/release lost the button; aria-expanded stayed true.

The only follow-up product change is local `active:not-aria-[haspopup]:translate-none` on this summary Button. CSS translate:none preserves the intended containing block; a zero-valued translate would not. Shared Button and person card code remain unchanged. The new tests require a real delayed physical down/up on count text outside the label rectangle, actual held target continuity, release on the real button, collapse and reopen, and preserved exact name/description. GREEN at both widths records active=true,translate=none,pseudo283×40,held/release both button. This closes F1; no additional breakage found in its delta.

## Evidence inspected

Raw logs are under `.superpowers/sdd/2026-10-18-solideo-people-read/`:

- `live-ui-browser-red-independent.log`:7FAIL/24PASS; five missing accessible descriptions and two genuine pane-bound failures. These component failures supplement the separately preserved actual document-wide axe41 failure; they are not an axe run.
- `live-ui-browser-final-green.log`:31/31PASS, including real metadata clicks, native keyboard/Drawer return, pane wheel/bounds,44px/grid/finder/history/bundle cases and M3.
- `live-ui-summary-press-red.log`:2FAIL/31filtered; the two new press cases failed on the intended lost toggle. Filtering in this targeted reproduction is not a skipped final suite.
- `live-ui-summary-press-green.log`:full focused33/33PASS with no filtering, including both count presses/collapse/reopen at both widths and all prior31 guards.
- `live-ui-commit-gate.log` and `live-ui-summary-commit-gate.log`:normal new commits passed format, Next typegen/tsc, ESLint/guards,62files/998unit tests, both architecture rules and tokens/colors. No bypass is shown; these quick gates are not production builds/full root verify.
- `live-ui-byte-proof.log` and `live-ui-summary-byte-proof.log`:exact two-file ownership; all1081 other tracked paths identical to both frozen f579 and the respective parent; all OrgChart pre-render logic/effects unchanged; clean final checkout. Thus original200/photos/27/173,13known+29unknown data, API/Auth/SQL/packages/docs06/20, shared Drawer/Avatar and previous AppShell landmark correction are outside the changes. This is byte-scope evidence, not new live data/RLS verification.

## CannotVerify / retained final-QA boundaries

1. Obtain actual final-SHA default whole-document chart axe GREEN at1440/1280, with unchanged rules/context and original f579 failures retained. Source analysis and33 component passes do not prove whole-page axe0.
2. Measure actual composed-app pane top/bottom/client/scroll heights, viewport/document bounds and independent wheel scrolling at both widths, particularly the small selected team that exposed overflow. Retain actual full-card pointer/focus/finder,44px,3/4 columns and screenshot evidence. The fixed14rem reserve is supported by scoped component measurements and still needs that actual-app check.
3. Fresh full verify/production-build and affected live acceptance evidence remain QA-owned. The historical f579 detail120s/list1280next5s failures are not explained or fixed by this UI-only patch, and prior full regression/cursor receipts retain their own SHA/target provenance. This review does not demand unchanged Auth95 be repeated merely for these two UI files.
4. Final data/photo/normal-account/owned-resource cleanup and project/run separation must remain explicit in the final Task4 evidence audit. No shared DB, latest-main integration, G1–G10 completion, merge, push or deploy conclusion follows from this scoped approval.

## Declined to judge

- Unchanged API/security/scoring/data code and prior broad findings: outside this two-file correction review; no reopening of the completed broad pass.
- Final live acceptance and unrelated retained-fixture/date-precondition history: belong to QA's actual receipts/evidence audit, not this source verdict.

**Recommendation:** Proceed with the authorized final frozen-SHA verification and affected actual UI checks. No further product change is requested by this scoped review.
