---
title: "Feature backlog after 2026-10-29 user request"
doc: "plan-feature-backlog-20261029"
status: draft
tags: [sol-radar, product, hackathon]
updated: 2026-10-30
---

# Feature backlog (2026-10-29 user request)

> [!todo] Proposal, not yet approved
> This document records eight features the user asked for on 2026-10-29, the current state of the code for each, and a proposed plan. Every "Recommended" choice below is a proposal. Nothing here is decided until the user picks an option in [Open decisions](#open-decisions). Decisions that change scope must also be written to [[16-DECISIONS|16 ADR]].

## Schedule constraint

- Screen freeze: 2026-11-01 (Sun). Filming: 2026-11-01 – 11-02. Official submission: 2026-11-03. Presentation: 2026-11-04 ([[12-ROADMAP|12 Roadmap]] "남은 일정 제안", [[16-DECISIONS|ADR-054]]).
- About 2.5 working days remain before the freeze. They overlap with the company notification Worker start-up (10-30 – 10-31) and the Kakao S0 receive test.
- Any new or changed screen must land before the freeze. Collection-only work (no screen change) can land after filming.
- All work stays additive: do not change the core-cut contracts (`ingest_save_revision`, analysis job, `analyze()` formula, goldens 94/72/68). Do not show probability, win-rate or "chance of winning" figures ([[16-DECISIONS|ADR-007]], ADR-037 condition 4).

## Original request

The user's list, translated from Korean:

1. Filtering (AI, AX, etc.)
2. Staffing for recommended bids: when staff are assigned to a recommended bid, show which team needs whom.
3. Clicking a person shows the projects they have worked on (add synthetic project history to the 200 synthetic people).
4. Also collect procurement plans (발주계획). Add them to the landing-page table later.
5. Bid price analysis and prediction.
6. Org chart: searching by name does not work. Put the button on the right and search on Enter.
7. Google Calendar integration.
8. In the staffing simulation, load recommended bids and compute, per team, where and whom is needed.

## Summary

| # | Feature | Current state | Proposed work | Size | When |
|---|---|---|---|---|---|
| 1 | Field filter | **Already exists** on `/bids` | Confirm what is missing | — | — |
| 6 | Org chart name search | **Done** (2026-10-29, `6883b73f`) | — | — | — |
| 3 | Person project history | **Done** (2026-10-29, `6622f487`, production DB `20261029001000`) | — | — | — |
| 2 + 8 | Team staffing for recommended bids | `/workforce` takes 1–3 manually chosen bids and lists candidates flat | Merge into one feature: load recommended bids, group need by role and team | 1 – 1.5 days | Before freeze |
| 7 | Google Calendar | `/calendar` already aggregates schedules | "Add to Google Calendar" link + `.ics` download per event | 0.5 day | Before freeze |
| 4 | Procurement plan collection | Registry entry approved, never called | Normalizer, mapping, Worker schedule, IT scope, company Worker rollout | 1 day code + rollout | After filming (recommended) |
| 5 | Bid price analysis / prediction | Conflicts with the product positioning; no award data collected | Drop from the hackathon | — | Not in hackathon (recommended) |

## Feature details

### 1. Field filter (AI, AX, ...)

- **Current state:** `/bids` already has eight fixed field keyword chips: `AI_AX`, `SI_SW`, `CLOUD`, `DATA`, `SECURITY`, `DIGITAL_TWIN`, `MAINTENANCE`, `ISP_ISMP` (`web/server/opportunities/keywords.ts:5`, [[16-DECISIONS|ADR-069]]). Several chips are OR-combined against the list view's `categories` and `tags`.
- **Proposed work:** None until the user says which screen they meant (for example the program notices list, the dashboard, the calendar or the staffing screen).

### 6. Org chart name search

> [!done] Done on 2026-10-29 (`6883b73f`, merged in `35b994ed`)

- **Cause found:** pressing Enter without picking an item only closed the list, and closing the list cleared the typed name (Base UI `Combobox` `value=null`).
- **Fix:** `OrgNameFinder` (`web/components/people/org-name-finder.tsx`) now uses `Autocomplete`, with a **Search** button on the right and Enter-to-search. One match jumps to the person's team. Several matches open a list. No match shows a notice.
- **Evidence:** 7 new browser tests (all 7 failed before the fix), screenshots at 1440 px and 1280 px in `docs/evidence/org-search/`. See [[PROGRESS|Progress]] 2026-10-29.

### 3. Person project history

> [!done] Done on 2026-10-29 (`6622f487`), production DB migration `20261029001000` applied, Vercel production deploy `c8b4a504`

- **Screen:** the person drawer (`web/components/people/person-drawer.tsx`) shows "수행 이력" (newest first: agency, domain, period, role, skills) and "자격증". The org chart and the people list share this drawer.
- **Data:** synthetic project history `synthetic-people/v2`: 3–5 projects per person, 14 synthetic agencies. The migration changes only `past_projects` and `capability_version`.
- **Score impact:** none. Scoring inputs (role, grade, skills, availability) and certifications are unchanged.
- **Evidence:** `docs/evidence/people/20261029-project-history/README.md`. The logged-in production screen and `test:e2e:auth` are not yet checked.

### 2 + 8. Team staffing for recommended bids (merged)

Items 2 and 8 describe the same feature, so they are planned as one.

- **Current state:**
  - `/workforce` (N7) accepts 1–3 bids chosen by hand (`web/server/workforce/workforce.model.ts` `workforceSelectionSchema`).
  - For each bid it reads the latest valid analysis snapshot and computes required FTE (`STAFFING` or `BUDGET_TIER`), available FTE, and a flat candidate list matched by required skill or role (`web/server/workforce/workforce.service.ts:33` `candidatesOf`).
  - It also reports overloads against current assignments and candidates shared between overlapping bids.
  - Results are not saved ([[16-DECISIONS|ADR-021]], ADR-042 condition 4).
- **Proposed work:**
  1. **Load recommended bids:** a button that preselects the top 3 recommended (`BID`) IT bids with a valid analysis, reusing the ADR-069 recommendation order.
  2. **Group by role, then team:** for each bid, list required roles from the extraction's `staffing` (and required skills). For each role, show which teams (departments) have matching people, who they are, and their available FTE in the bid period.
  3. **Team view:** a team-by-bid matrix that answers "which team must supply whom to which bid".
  4. Keep the existing overload and shared-candidate warnings.
  5. Keep it a pure calculation in the workforce service. No new table.
- **When roles are unknown:** real bids often have `staffing` UNKNOWN. Then the screen shows the budget-tier FTE and "역할 정보 없음" instead of guessing roles.
- **Saving assignments, a decision for the user:**
  - The `assignments` table exists (`supabase/migrations/20261019000005_bid_reviews_assignments.sql`) but has only a `select` policy. Seed data writes it.
  - Analysis reads it to compute staff availability (`web/server/analysis/analysis.repo.ts`, `web/server/workforce/workforce.repo.ts`). Saving assignments from the UI would therefore change future scores, including the FX-02 re-analysis that must show 43 during filming.
  - Saving also reverses ADR-021 ("N7 candidates are not saved"). "Saving and confirming staffing" is a post-hackathon Phase 8 item in [[12-ROADMAP|12 Roadmap]].
  - Recommended: show a "staffing proposal" only, with no save, for the hackathon.
- **Size:** 1 – 1.5 days. Write a short spec first because it spans the service, the screen and the recommendation query.

### 7. Google Calendar integration

- **Current state:** `/calendar` already collects deadlines from my watchlist, the organization's open bid projects, IT-scope real bids, and the raw G2B schedule fields: bid begin, qualification due, joint agreement due, site briefing and opening (`web/server/calendar/calendar.model.ts`).
- **Proposed work (recommended):**
  1. Per event, an "Add to Google Calendar" link using the Google Calendar event template URL (title, KST start/end, agency, source link).
  2. A `.ics` download of the current calendar view, served by an authenticated Route Handler.
  3. This needs no OAuth, no Google API key and no stored tokens.
- **Not recommended before the freeze:** a full two-way sync with the Google Calendar API. It needs a Google OAuth client and consent-screen verification for a sensitive calendar scope. It also needs per-user token storage and refresh, a new table with RLS, and a security review under [[09-SECURITY|09 Security]].
- **Not recommended before the freeze:** a subscribable ICS feed URL. It needs a secret per-user token in the URL, which is a new public endpoint.
- **Size:** 0.5 day.

### 4. Procurement plan (발주계획) collection

- **Current state:**
  - `infra/sources/registry.yaml` has `g2b-order-plan` (나라장터 발주계획현황서비스, service 15129462, `getOrderPlanSttusListServc`) with `approvalStatus: APPROVED`.
  - Its `fieldMapping` is empty, so `callableSource` never calls it ([[07-DATA-PIPELINE|07 Data pipeline]] §1.3).
  - Recorded masked responses exist under `fixtures/recorded/15129462/`.
  - The stage-link screen (P0-8) and the PLAN-stage rule already exist: every requirement becomes `NEEDS_REVIEW` with `STAGE_NOT_APPLICABLE`, and the recommendation is WATCH (`web/server/scoring/qualification.ts:30`).
  - 07 §1.3 already notes that the user plans to collect pre-spec and plan notices later.
- **Proposed work:**
  1. Fill `fieldMapping` and add a normalizer for plan rows into `NormalizedBid` with `stage=PLAN`, following `normalize-g2b.ts`. Use the recorded responses as test input.
  2. Add a Worker schedule on the existing 3-hour KST cron. Order it after the main G2B run and respect the daily quota of 1000.
  3. Apply IT scope ([[16-DECISIONS|ADR-069]]) so non-IT plans stay hidden.
  4. Link plans to later notices through `planRef` (`orderPlanUntyNo`), which the stage-link code already reads.
  5. Keep the save RPC unchanged (`ingest_save_revision`). Do not auto-analyze new plans.
  6. **Landing table:** add the "발주계획 · 사전규격 연결" row back only after production collection runs (D9 in `polaris/specs/done/2026-10-29-landing-competitor-table.md`). This is deferred, as the user asked.
- **Rollout (needs approval):** recreate the company ingest Worker. Whether `G2B_ORDER_PLAN_SERVICE_KEY` is set on the company Worker is **unconfirmed**. Do not restart the ingest Worker during filming.
- **Size:** 1 day of code, plus the company rollout.

### 5. Bid price analysis and prediction

- **Conflict with the design:**
  - [[18-HACKATHON|18 Hackathon]] positions SOL RADAR against competitors whose main analysis is the bid price ("얼마에 쓸까"). It states that SOL RADAR does not do bid price analysis (`docs/18-HACKATHON.md:78`).
  - Automatic bidding and win-rate prediction are out of scope ([[16-DECISIONS|ADR-007]]).
  - Award and contract data are not collected. Their collection is a post-hackathon roadmap item.
  - Any price prediction made before that would have no data behind it.
- **Recommended:** drop it from the hackathon and say "out of scope" in the deck and Q&A, consistent with ADR-007.
- **If the user wants it after the hackathon:**
  1. Collect award results first (a new registry source).
  2. Define the target, for example the bid-to-base-price ratio distribution by agency and category.
  3. Backtest.
  4. Expose it only after the backtest passes ([[01-PRD|01 PRD]] FR-12).
  5. Record a new ADR.

## Proposed order

1. Before the freeze, in parallel worktrees, one worker per area, no shared files:
   - 2 + 8 – staffing (`web/server/workforce`, `web/app/(app)/(work)/workforce`)
   - 7 – calendar export (`web/server/calendar`, `web/app/(app)/(work)/calendar`)
2. Work in each worktree passes `pnpm verify:changed`. Screens are checked at 1440 px and 1280 px. The main session reviews each diff before merging.
3. Full `pnpm verify` once at integration ([[17-CLAUDE-IMPLEMENTATION|17 Implementation rules]] hackathon verification policy).
4. After filming: item 4 code and company rollout, with approval.
5. Not in the hackathon: item 5.

## Open decisions

The first option of each decision is the recommended one.

> [!done] Decided on 2026-10-30: option 1 for every decision
> The user chose option 1 for D1, D2, D3, D5 and D6. D6 still needs the user to name the screen they meant. Implementation plans: [[2026-10-30-team-staffing|team staffing]] (items 2 + 8) and [[2026-10-30-calendar-export|calendar export]] (item 7).

| ID | Decision | Option 1 (recommended) | Option 2 |
|---|---|---|---|
| D1 | Item 5 bid price | Drop from the hackathon; state "out of scope" | Change ADR-007/18 and build it (needs award data first, not feasible before the freeze) |
| D2 | Items 2 + 8 saving | Staffing proposal only, no save | Save to `assignments` (reverses ADR-021, changes analysis input and the filmed FX-02 score) |
| D3 | Item 7 method | Event link + `.ics` download | Google OAuth two-way sync (not feasible before the freeze) |
| D5 | Item 4 timing | Code and rollout after filming | Code and company Worker rollout before the freeze |
| D6 | Item 1 | Already done on `/bids`; confirm which screen was meant | — |

## 관련 문서

- [[12-ROADMAP|12 Roadmap]] — remaining schedule and post-hackathon items
- [[16-DECISIONS|16 ADR]] — ADR-007, ADR-021, ADR-042, ADR-069
- [[18-HACKATHON|18 Hackathon]] — positioning and scope
- [[07-DATA-PIPELINE|07 Data pipeline]] — source status (§1.3)
- [[PROGRESS|Progress]]
