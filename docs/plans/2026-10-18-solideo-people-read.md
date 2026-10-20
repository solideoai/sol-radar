---
title: "조직·인력 조회 구현 계획 (Solideo people read)"
doc: "plan-people-read"
status: final
tags:
  - sol-radar
  - plan
  - people
updated: 2026-10-19
---

# Solideo people read Implementation Plan

> [!success] 보관 (2026-10-19)
> 이 설계안은 정본에 반영됐다(근거: PR #6 `98101e8` 원격 main 병합, 로컬 main 병합 `7641ee4`(2026-10-19), [[PROGRESS|진행 상황]] ADR-021 절 N4a 행·"조직·인력 조회와 독립 조직도 구현·검증" 절, 증거 `evidence/people/20261019-people-read.md`). 수정하지 않고 보관한다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. User approved all implementation and tests on 2026-10-18; no main merge/sharedDB/push/deploy.

**Goal:** 조직·인력200명 조회·계층·상세와4업무역할을 현재 main89b2b5e 기반 격리브랜치에 구현한다.
**Architecture:** 기존auth/organization/RLS를보존하며sol_role과별도businessaccess를추가한다. people도메인이조회·집계·HMAC페이지·DTO를공유하고 /people scoped UI가이를사용한다.
**Tech Stack:** existing Next16/React19, Supabase/RLS/PGlite, Zod, Tailwind/shadcn BaseUI, Vitest/Playwright; no new packages.
**Spec:** polaris/specs/in-progress/2026-10-18-solideo-people-read.md; UI polaris/specs/in-progress/2026-10-18-solideo-people-ui.md. User's five-stage requirements are binding.

## Global Constraints

- Employee200/portrait200 and approvedSHA; IDs/names/team/title;6DIV4GROUP38TEAM/target200;27scoring173others/20FTE/golden94/72/68 input bytes preserved.
-13confirmededges81people;29unknown(25TEAM119people+4GROUP); naturalDIV roots distinct; no inference/moves/savedaggregates.
- Readonlypeoplefeature only, noP1/ops/fullN1N2/edits/sharedDB/mainmerge/push/deploy/otherworktreewrites.
- New5b0c feat/people-read only. Preserve main89b2b5e .claude/settings.json existinguncommittedbytes. Allguards remain; SQLappend-only/typesgenerated. Existing12SQL/corefixtures/scoringmodel/photo bytesimmutable.
- Desktop1280+;1440/1280;existingtokens/components; no dependencies. Servicecode server-only/barrels, anon+session RLS, service_roleonlyexternalownedseed/tests.
- Existingrole/authorizationpolicyandAuth5seedIDs preserved. sol_role defaultVIEWER independentofowner/member; noautoADMIN, no autoorg01joining.

## Review Focus

- Nullparent distinguishesDIV root vsGROUP/TEAMunknown; all200 unique evenwhenonly81haveknownancestors.
- Cursor filters/org/limit/tampering/expiry, anddirectpaginationURL prev/back/forward must stay coherent.
- Database UUID vsSOLcode/titlelabel; Avatar missingnull vsvalidcode anddecodefallback.
- Cookie/Bearer/profile/suspended/0-or-multiplebusiness membership: no externalqueryorg authority orroleescalation.
- Rapid drawer person changes/close/fetchfailure, missingdetail andreturnfocustootherremovedrow.

### Task 1: Independent business roles and context

**Files:** Create supabase/migrations/20261018000001_people_business_roles.sql; web/server/organization/business-access.model.ts, business-access.repo.ts, business-access.service.ts andadjacenttests. Modify organization/index.ts; scripts/database.test.mjs (andonlynecessarysupport tests), web/lib/database.types.ts via pnpm db:types. No db-seed/fixtures/oldSQL/auth/settings policy rewrites.
**Interfaces:** Consumes existinggetCurrentOrganization()/CurrentOrg. Produces SolRole enum4, getMyBusinessAccess() result describedinspec, readonlymembershipsol_role. Existingorganizationinterfaces remaincompatible. Runtimeinvalidroleforbidden.
- [ ] Step1 Write failing DBtest forsol_rolecolumn/defaultVIEWER/fourroles/invalidrole/deniedselfpromotion, plus servicecontexttests0/1/2 androlelookuponlycurrentorg. Runfocused tests RED andrecord.
- [ ] Step2 Appendmigrationandcontexthelper+rolemodel/repo. ExistingSELECTpolicies mayremainbecauseallfourrolesread; testRLSallroles/otherorg/anonymous andoldowner/memberpreservation. No newemployeegrants.
- [ ] Step3 pnpm db:types; runfocusedgreen, organization/auth/service tests and pnpm test:db, webtype/lint. Saveactualcommands/output.
- [ ] Step4 Format onlychangedcode via projectprettier; commitnormalhooks(feat: 조직 인력 조회 업무 역할 기반 추가), selfreview/report. Do notrunfullverifybuildyet.

### Task 2: People domain and authenticated read API

**Files:** Create web/server/people/people.model.ts, people.repo.ts, people.service.ts, people.cursor.ts, index.ts andmodel/repo/service/cursortests; web/app/api/v1/{departments,job-titles,team-members}/route.ts, team-members/[id]/route.ts androutetests. Modify v1/_lib/http.ts onlynecessaryerrorcodes/guard; web/.env.example cursorplaceholder; docs/05-API-SPEC.md additivecontracts; noothercanonicalADRchanges.
**Interfaces:** Consumes Task1 getMyBusinessAccess+SolRole andexistingrequireCompleteUser. Produces DTO/queriedPage+metadata/HMAC signedpagination, getDepartments/listTeamMembers/getTeamMember/getJobTitles/getPeopleDirectory services, pure safe models/types exportedforUI. Interface exact signaturesandquery/resultshape mustberecordedintaskreportforTask3.
- [ ] Step1 TDD fixtures200/27/173, kind6/4/38,81+119/29, duplicateIDrollup, nullscoring, safephotos/codeUUID, queryfilters/unknown/foreignfilters, roleaccess andcursorvalid/tamper/org/filter/expiry. RunRED actualassertions.
- [ ] Step2 Implement minimalrepos/services/routeswithuserRLS andsameguard SSR/API. SignedcursorAPI_CURSOR_SECRET32+,24hTTL,sortingpersonCode/id,defaultlimit20/max100. NullableportraitURLandno-contactDTO. Additionaljob-titleGETandDepartment.code documented.
- [ ] Step3 Testallscopedroutes inclcookies/Bearer401/403/404/0/1/2+, profiledisabled/incomplete, readonlyno-writes; model200pagewalkunique andbadcursor. Focusedtests+type/lintgreen. No live sharedDB.
- [ ] Step4 Normalhookcommit(feat: 조직 인력 조회 API 추가), selfreview/reportincludingexactUIinterfaces. Controller taskreview.

### Task 3: Ordered employee list, organization chart, PersonDrawer

**Files:** Create web/app/(app)/people/{page,layout,loading,error}.tsx andsupportmodules/tests asneeded; web/components/people/{people-directory,people-filters,people-table,org-chart,person-drawer}.tsx withbrowser/modeltests; modify PersonAvataranditsbrowsertests, app-shellandnavtests toaddonlypeople. NofullN1move; docs06/11/PROGRESS scopedimplementationevidence afterrealQA.
**Interfaces:** Consumes UI-design andTask2exported DTO/services/authreadAPI. Produces scoped/people, view=list|tree,filterURLstate/page20 anddrawer; sameAPI/DTOwithno runtimecrossdomainclientimports.
- [ ] Step1 TDD list/filter/URLquery/page; implement userstage3 andverifyfocusedunit/browser. FirstURLorgdatafailsmustnotshowfixed200.
- [ ] Step2 TDD orgchartall200unique/naturalrootsvsunknown4groups25teams/81+119/directDIVteams/duplicateIDcounts; implement userstage4 onlyafterlistverification. All200fromfulldirectorynotpage20. ShowmembercountsderivednotDBsaved.
- [ ] Step3 TDD drawer27scoringvs173null,personCodeimages/null/decodeinitials,staleasync/close/errors/retry/keyboardreturnfocus; implementstage5. UseexistingSheet/Avatar/tokenclasses.
- [ ] Step4 ScopeoutP1andfullN1; routeguards inpageaswellaslayout; legacyapp/authpreserved;1440/1280tests;type/lintgreen. Normalhookcommit(feat: 조직 인력 조회 화면 추가), selfreview/report. Controllerreview.

### Task 3A: Approved standalone organization explorer (supersedes Task3 view tabs)

User2026-10-18 approved design §5/7/AppendixA. Task1–3 and their c178 evidence remain historical; do not redo them.
**Files:** owned people UI/unit/browser tests and `/people` route composition; new `/org-chart` page/layout/loading/error; minimal optional AppPage content width; AppShell footer NetworkIcon link only; this plan and both in-progress read/UI specs. QA owns the three E2E source files. No API/domain/migration/package/data/docs06/docs20 changes.
**Interfaces:** Same guarded `getPeopleDirectory(peopleAccess)` cached per request; current org server authority unchanged. `/people` ignores all view query values, preserving real filters/cursor validation. `/org-chart` full directory drives natural roots, unknown sections, selected team and shared Drawer.
- [ ] Step1 TDD list-only view and actual-count/code ordering; update list/page and model; focused unit/browser green.
- [ ] Step2 TDD two-column explorer, default14, team URL/history/fallback, title/name ordering,200 unique across team selections, combobox max8/keyboard/card focus/no Drawer; implement using installed native primitives and Next16 history integration.
- [ ] Step3 Add scoped layout/error/loading and data-derived header; preserve recoverable AppShell on expected catalog errors; footer separator/link only. Shared Drawer test uses cancellation-tolerant settlement plus actual480px/bounds polling.
- [ ] Step4 Measure expanded-sidebar1440/1280 grids4/3 and no overflow, shared Drawer/fallback, focused unit/browser/type/lint; project Prettier changed code only. Normal hooked commit with process-local VITEST_MAX_WORKERS=2. Preserve RED and failures externally; report exact SHA/locators. No full verify/liveDB (independent QA after review).

### Task 4: Independent real integration and regression QA

**Files:** Independent QA mayadd scoped web/e2e-auth/people.read.spec.ts /people.write.spec.ts onlyforephemeraltestsetup, ifneeded;noapplicationcode. Newdocs/evidence/people/20261018-people-read* reports/logs/screenshots. ExistingE2E no weakening orskip. ControllerpackagesafterQA.
**Interfaces:** Consumes frozenfeaturecommit+Task1–3 reports andownedtargetlocal-test-target helpers. Produces actualQA verdicts/preservedcorehashes/cleanupreports; oldevidenceSHA retainedseparately.
- [ ] Step1 Fresh reviewer testsdoccontracts/sourceexpectedandcreatesnewownedexternalSupabase13migrations/ports (never543xx,nevermain/b3ef/9663.env),explicitstatus-targetidentity/inmemoryredactedkeys. Inventoryallpreexistingresources/authstates.
- [ ] Step2 Seed2x/IDstability, separateephemeralorg01fourroles forAPI/UI,0/1/multiple andforeignorg404/RLS0/deniedwrites/roleescalation. Do notaddorg01membershipstobaseAuth5orchange200data.
- [ ] Step3 Freshsinglefullpnpmverify and normal Auth/publicincludingbrowser atfrozenfinalcode; all200NextGET/MIME/approvedSHA/decode, desktoplist/tree/all200unique/drawer27+173/initials/axe+keyboard. Preserveinitialfailures/boundedrootcauseonlyreruns. No config/hookweakening, no fabricatedPASS.
- [ ] Step4 CleanupONLYownedresources/processes/ephemeralaccounts/generatedauthstates;comparemain/b3ef/9663HEAD/status/alltrackedhashesandmainsettingschange. Keepfeatureworktreebranch. ReportG1–G10/unexecutedlimitsseparately.
- [ ] Step5 Wholebranchreviewonceusingcode-reviewerpackage; onefixwaveandscopedreviewifnecessary,coveringtestsonlyuntilfinalchangesjustifynewfullverify. Packageversionedevidence/PROGRESSwithnormaldoccommit,final clean feature HEAD; feature base remains89b2b5e, this session makes no main changes. Observe/report external main advancements (latest approved-design source8317b75) rather than require global main HEAD89. No main merge/push/deploy.
