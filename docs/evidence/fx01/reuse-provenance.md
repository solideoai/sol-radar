---
title: "FX-01 committed runtime reuse provenance"
status: draft
updated: 2026-10-19
---

# FX-01 runtime reuse provenance

Task 1 imports contracts and the AI gateway only. Sources were read with `git show <commit>:<path>`; no foreign worktree files or branch merges were used. Base: `3705d5dce77f921f15e001b49289853224ebd079`.

## Scope and decisions

- C5 analysis supplies the seven production modules plus six test modules and test-only support. Production imports do not reference `test-support.ts`; fixture filesystem reads stay in test support. Existing C4 scoring code, goldens (94/72/68), 27 scoring members, 20 available FTE, and 200-person roster are unchanged.
- C6 supplies four DTO modules, two model tests, and shared review-input plus its test. Its `bid.model.test.ts` imports `organization.SolRole`, which is absent on the target base; that test alone instead asserts the documented ADMIN/SALES/ANALYST/VIEWER type union, preserving its runtime enum assertion without importing C6 auth implementation. A new narrow bids barrel exports only these four modules; the existing shared barrel only gains review-input exports. Dashboard, notifications, UI, seed, SQL, worker and API integration are outside this step.
- C5 gateway supplies the complete Python runtime closure, schema, prompt, injection guard, qualification dictionary, Kev question set v0.1, exact pyproject/uv lock and related tests. Existing package name/version/description, Python requirement, build backend, verify script, startup and configuration/parity regressions remain.
- Execution uses explicit mock configuration and TestClient/injected fetches. Local and hosted adapters remain explicitly unavailable; they never call a model or silently substitute mock. Parsing reports unavailable parsers honestly. No DB or model network calls were made.
- Target `infra/run-modes.json` allows only `KEV_ENABLED=true`, whereas pinned gateway tests assume false is allowed. ADR-020 requires contradictory modes to reject startup; ADR-023 changes priorities, not these rules. Repository rules and original run-mode/startup/parity tests remain unchanged. Disabled-adapter tests explicitly opt into a temporary test-only rules file built from a deep copy, preserving the session-scoped canonical fixture. A regression protects that isolation and a parameterized regression verifies actual repository startup rejects false in mock/fixture/live. This changes test preconditions, not the expected adapter outcome or production permissions.
- Container assets are not copied in this initial import; package verification does not claim a container build. Existing Dockerfile requires selected runtime asset COPY additions before the new gateway can run in a container.

## File-level source record

The source blob identifies the exact committed input. "Adapted tests" marks only the rule-precondition changes above; source files listed as unchanged from base remain byte-identical.

| Target path | Source commit | Source blob | Import treatment / reason |
| --- | --- | --- | --- |
| `web/server/analysis/analysis.model.test.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `cafb5d9615a2b42f331ec601bd44dde1bfa6caaf` | Verbatim analysis contract/regression tests or test-only support |
| `web/server/analysis/analysis.model.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `9fccc71139eadf2d2363f96220f7a64201aea8d3` | Verbatim analysis runtime closure |
| `web/server/analysis/analysis.service.test.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `0dce80cadf54ff946f75f3bf2ee12e992a2c04d0` | Verbatim analysis contract/regression tests or test-only support |
| `web/server/analysis/analysis.service.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `3fa6d281fc98867d3e8a0605e4152e7be0bfd71d` | Verbatim analysis runtime closure |
| `web/server/analysis/circuit-breaker.model.test.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `67962cde102aa2a603ae61a42ce1ef9f00ebdff0` | Verbatim analysis contract/regression tests or test-only support |
| `web/server/analysis/circuit-breaker.model.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `cd8bc2858c325257c6d712200fd9334b3cc1e3b3` | Verbatim analysis runtime closure |
| `web/server/analysis/fallback.model.test.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `2e0605d6e9ee6ee84063f8321becb40b9a23c0db` | Verbatim analysis contract/regression tests or test-only support |
| `web/server/analysis/fallback.model.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `475868ed8708ca53297e3a2a285857d1d2492ac5` | Verbatim analysis runtime closure |
| `web/server/analysis/gateway.client.test.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `cae04da2c62ea5133f6ac7aa5515c3704bfd8b20` | Verbatim analysis contract/regression tests or test-only support |
| `web/server/analysis/gateway.client.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `ce6ebaabacf4f4f3a1c763cfc03660bee2200d4e` | Verbatim analysis runtime closure |
| `web/server/analysis/gateway.model.test.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `558b628a31a50367d218dbe75ae40f790958d79a` | Verbatim analysis contract/regression tests or test-only support |
| `web/server/analysis/gateway.model.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `92490bfe09045fd2fab76a30eb43394651d6a8ae` | Verbatim analysis runtime closure |
| `web/server/analysis/index.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `fa31f6c2e64d7e73eeffea0145106372ca67e240` | Verbatim analysis runtime closure |
| `web/server/analysis/test-support.ts` | `82bea1bf42c65b917cadad70fbd3933dd65bf13a` | `1dd2dc95890c1ad705f0a89fcb717da0c5113dec` | Verbatim analysis contract/regression tests or test-only support |
| `services/ai/dictionaries/qualification-codes.yaml` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `c85c03786cd2c7ca816f6dca0ac0d2528a247582` | Verbatim required gateway runtime/assets |
| `services/ai/guards/injection-patterns.yaml` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `8fc811364d1e68c08001260ffb58b1c3cb15f42b` | Verbatim required gateway runtime/assets |
| `services/ai/kev/question-sets/v0.1.json` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `72f782568e07287eef4754203a16f0c17a219067` | Verbatim required gateway runtime/assets |
| `services/ai/prompts/req-extract.v0.1.md` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `17904bc5d072ab074fd43eddc4e3dfa5188156be` | Verbatim required gateway runtime/assets |
| `services/ai/pyproject.toml` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `70c29ddcb69d269f6b737edda550f0efacb19ed7` | Verbatim frozen dependency definition |
| `services/ai/schemas/requirement-extraction.v0.1.json` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `f83f9b0fb87c08f24a7fecd90611a3cd0c24f176` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/__init__.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `69af27e21a5a65996805dfa8644512468530818d` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/__main__.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `928a5c5bfd9fb77fe7c81e8ea3ebdea5f1db0b02` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/adapters/__init__.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `db2170f08211742cd27d063702ec5d760f5dd753` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/adapters/base.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `9d4c4dfbe2c1044868c8e1ac9d60e838a8c9a598` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/adapters/factory.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `e7709c35dcc3b9dadc337234065d4299a253369f` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/adapters/kev.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `80503b6c2a3b66f1a4cf2bf11d85784e3e3217e3` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/adapters/kev_wire.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `7f14a8c52567831b4882464e73b3effad508ae51` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/adapters/mock.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `3fa2cfd531b020bcc830eb47aec29b60504d872a` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/adapters/unavailable.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `0034893f8d05a79b7f143670ef0ff64b4c847914` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/app.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `6a555a3c823a57a9aae2ea8ed3a3e10f8641f2fc` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/citation.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `d6c99ccd5118633974eab97efcf30e30932f8c12` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/contracts.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `9325f25aba23fa92ffad52025267d8ffaffcd2aa` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/explain.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `5a390346a487cb1884142baa9d0081a9c8be81de` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/extraction.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `8a23e0b1f5761c2ab0a5f9d0c8fc8f3c566e8a10` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/guards.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `2e70cbe05d444e036fedc81e08140a22e516e23c` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/kev_state.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `97beea3f020978f675d9a698357a2cf59d45c0f0` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/parse.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `73095ca99471cf4c98f88a1ecf5a09e918a6bef5` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/paths.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `8ef42813bed5e10a5c8503e5691c5fcb1a90841d` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/qualifications.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `b25d5e4722da8fe274e5f827706fea6415868475` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/question_sets.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `8f4f667daa344d10f56a78fa85b6708ead5a25a5` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/run_mode.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `c05ef559d729ab38b1868f395f7a9bb5707b963e` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/schema.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `045afecfcf66d342877997f63ba7881161de628c` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/settings.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `f3d9a21f125010a956364ae6169d507f697c0f53` | Verbatim required gateway runtime/assets |
| `services/ai/src/sol_ai/timeutil.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `100b0dc3e1d994cc53e1f75836b0cd56c3ff5663` | Verbatim required gateway runtime/assets |
| `services/ai/tests/conftest.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `8ca8838910e3eb530f806b9b6c31b9c6103dc4d8` | Adapted tests: explicit temporary rules / real-rule rejection regression |
| `services/ai/tests/support.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `5bf439b67ec20eae6061cf27d8dcd19202d1502e` | Verbatim gateway regression tests |
| `services/ai/tests/test_citation_verify.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `4ceca13b54bcfd8479a83a47b1161c167e833785` | Verbatim gateway regression tests |
| `services/ai/tests/test_explain.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `409c68d8573ad817d582466c5d65d13e8e4a1b18` | Verbatim gateway regression tests |
| `services/ai/tests/test_extraction_schema.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `3b4cb762fc0b72e3a3e6a74121c1185a08e1fda3` | Verbatim gateway regression tests |
| `services/ai/tests/test_gateway_fallback.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `901400d41fcfa9a117e56bf11a441f9c326538fc` | Verbatim gateway regression tests |
| `services/ai/tests/test_health.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `e46e704cc7ac1c8e7510c2a7cf91f5b1ec5e06bd` | Adapted tests: explicit temporary rules / real-rule rejection regression |
| `services/ai/tests/test_injection.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `c00c78a8f42f7dbfe91b3e7cdbe24f3bde78c0af` | Verbatim gateway regression tests |
| `services/ai/tests/test_kev_adapter.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `1a170cfc443056d5387c9feb2a342f86c5029d3e` | Adapted tests: explicit temporary rules / real-rule rejection regression |
| `services/ai/tests/test_model_unavailable.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `e4a75ffe037ebd695f9fba362c3560ddf7eb4b8e` | Verbatim gateway regression tests |
| `services/ai/tests/test_parse.py` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `83346043f8bf76b9706e426dcb28bf0e15b52aaa` | Verbatim gateway regression tests |
| `services/ai/uv.lock` | `3d06523d5c42b29a8f23e6cc9cddef4c5a30e310` | `c1fe4a95e7722f98cd408c0fd7ad6e7a8c29dea9` | Verbatim frozen dependency definition |
| `web/server/bids/bid.model.ts` | `f1cea68cab570e0af29c78755b6606434dfb07cf` | `05fdb9c36026b4b69615aee442a3cd5d8d3f3ca3` | Verbatim DTO/shared review validation contract or focused tests |
| `web/server/bids/analysis-view.model.ts` | `f1cea68cab570e0af29c78755b6606434dfb07cf` | `9cd8f4f61a8769e28ca576360f3cc2fa62df71a9` | Verbatim DTO/shared review validation contract or focused tests |
| `web/server/bids/bid-detail.model.ts` | `f1cea68cab570e0af29c78755b6606434dfb07cf` | `cb68fe5f39f990ed17059661c0985dc8ccc6b309` | Verbatim DTO/shared review validation contract or focused tests |
| `web/server/bids/review.model.ts` | `f1cea68cab570e0af29c78755b6606434dfb07cf` | `66381f859ffa2b710ac78879ffbfa18946d91d22` | Verbatim DTO/shared review validation contract or focused tests |
| `web/server/shared/review-input.ts` | `f1cea68cab570e0af29c78755b6606434dfb07cf` | `96dc499f368936de27240409a89b8b6ede1d8d5b` | Verbatim DTO/shared review validation contract or focused tests |
| `web/server/bids/analysis-view.model.test.ts` | `f1cea68cab570e0af29c78755b6606434dfb07cf` | `1456784f65490de156b27586fa04155d6bcfe8d2` | Verbatim DTO/shared review validation contract or focused tests |
| `web/server/bids/bid.model.test.ts` | `f1cea68cab570e0af29c78755b6606434dfb07cf` | `237c6946eb10a97cdde65a62ec203b15a6c8d3dd` | Adapted test: assert documented role union; target organization has no SolRole export |
| `web/server/shared/review-input.test.ts` | `f1cea68cab570e0af29c78755b6606434dfb07cf` | `7687b30dda6f336d13d0a9b1472a2087dfb8cac4` | Verbatim DTO/shared review validation contract or focused tests |

## Locally authored integration files

| Target path | Reason |
| --- | --- |
| `web/server/bids/index.ts` | Narrow barrel; excludes dashboard and notification contracts. |
| `web/server/shared/index.ts` | Append only the three review schema and two review type exports. |
| `web/server/bids/bid-detail.model.test.ts` | Six focused DTO checks: pending documents, source/DEMO fields, full-analysis shape, user/system recommendation separation, nullable review context, strict reviewer shape. |
| `docs/evidence/fx01/reuse-provenance.md` | This selected-source audit. |

## Verification evidence

Exact commands, counts, red runs and final results are recorded in the controller-owned `.superpowers/sdd/2026-10-19-fx01-vertical/task-1-report.md`. This provenance alone makes no full-slice completion claim.
