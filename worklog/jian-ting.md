# Work log — JT

Entries for tasks listed in TASKS.md on 2026-10-28 go under the task's own section at the end of this file,
oldest first. Tasks added later get their own file in `worklog/jian-ting/`. Never add entries at the end of
the file. Entries above the task sections are earlier history.

<!--
### YYYY-MM-DD — TASK-ID: short title
- **Done:** what changed (files, behavior)
- **Decisions:** anything decided (also add to docs/decisions.md if it's a PRD decision)
- **Interfaces others depend on:** exports, contract fields, API behavior
- **Unfinished / next:** what's left
- **Gotchas:** surprises, workarounds
- **Requests:** changes needed in the other person's area
-->

## 2026-10-26 — Setup (S-01 to S-12)
- **Done:** Next.js 16 stack, contracts in `src/contracts/`, Case 1 + Case 2 fixtures, placeholder parks and
  workout templates, stubs for all agents, tools, rules, orchestrator, store, lifecycle service and API routes.
  CLAUDE.md, TASKS.md, README, decisions, CI, PR template, GitHub issues.
- **Decisions:** see D-001 to D-010 in `docs/decisions.md`.
- **Interfaces others depend on:** all of `src/contracts/`; stub API at `/api/events/**` seeded with
  `evt-case-01` (ready for approval) and `evt-case-02` (blocked); `RuleFn` for workout rules; `AgentImpl` +
  `index.ts` switch for agents.
- **Unfinished / next:** setup PR review, then JT-01 runner and JT-02 tools.
- **Gotchas:** `npm run typecheck` runs `next typegen` first so `RouteContext` / `LayoutProps` exist.
  `npm run dev` keeps the in-memory store per server process; restarting resets it.
- **Requests:** Yadan: add your `git config user.name` to CLAUDE.md (YT-00a).

## 2026-10-26 — S-11: Branch protection
- **Done:** Rulesets "protect develop" (refs/heads/develop) and "protect main" (refs/heads/main): no deletion,
  no force-push, PR with 1 approval, stale approvals dismissed, review threads resolved. Removed CODEOWNERS.
- **Gotchas:** "protect main" used to target the default branch; making `develop` the default left `main`
  unprotected. It now targets `refs/heads/main` by name.
- **Unfinished / next:** optionally require the CI check once it has run on PR #39.

## 2026-10-26 — Setup review fixes
- **Done:** fixed check ID list (`CheckId`), confirmations/tasks scoped to park + time, shared time helper
  `src/server/time.ts`, Node 24 pinned (`.nvmrc`, `engines`), README "How we work", CI required on both rulesets.
  Added JT-20 (early deploy) and JT-21 (database decision); JT-01 now includes a fake runner for tests.
- **Decisions:** D-011, D-012.
- **Interfaces others depend on:** `CheckId`; `addConfirmation` now needs `park_id` + `start_time`;
  `toLocalDateTime` / `fromLocalDateTime`.

## 2026-10-27 — JT-01: Agent runner and fake runner (#3)
- **Done:** Implemented `runAgent` and `createRunner` in `src/server/agents/runner.ts` (Anthropic Messages API call, `allowed_tools` JSON Schema conversion, multi-turn tool loop with `ToolSchemas` validation, final JSON output validation with at most 1 budget-counted repair attempt, `stale_context` rejection on `event_version` / `evidence_snapshot_id` mismatch, `deps.budget.record` usage tracking, and non-throwing `model_error` / `tool_error` handling). Added scripted test runner in `src/server/agents/fake-runner.ts` and unit tests in `src/server/agents/runner.test.ts`. Added `ANTHROPIC_MODEL` to `.env.example` and `README.md`.
- **Decisions:** D-022 (`ANTHROPIC_MODEL` defaults to `claude-haiku-5-5`), D-014 (fail fast with `tool_error` on disallowed tools, invalid tool input, or thrown tool errors).
- **Interfaces others depend on:**
  - `runAgent(definition, input, deps)` in `src/server/agents/runner.ts` (implements `RunAgent`).
  - `createFakeRunner(steps, options?)` in `src/server/agents/fake-runner.ts` for agent tests (YT-05, YT-06, JT-12, JT-13) with no network calls:
    - Pass an array of steps: `{ tool_calls: [{ name, input }] }`, `{ output: jsonObject }`, `{ error: new Error(...) }`, or `(call, turn) => step`.
    - Call `await fake(definition, input, deps)` directly (or `const restore = fake.install()` around `agent.run(input, deps)`), and inspect `fake.calls` for recorded requests.
- **Unfinished / next:** JT-02 (finish agent tools: time-window filtering and coverage gaps).
- **Gotchas:** `budget.record` rejects over-limit deltas without recording partial values, so when a final model call exceeds a token or `elapsed_ms` cap, that call's usage appears in `result.usage` but not in `budget.used()` (to handle in JT-10).
- **Requests:** `CLAUDE.md` needs an ownership row/entry assigning `src/server/agents/fake-runner.ts` to JT (to be done in a separate small PR).

## 2026-10-27 — JT-02: Finish agent tools (#4)
- **Done:** Updated `src/server/tools/index.ts` so `get_forecast` and `get_air_quality` filter `EvidenceItem`s by park (`park_id` or regional `null`), metric, and overlapping `[start_time, end_time]` interval (using `fromLocalDateTime` / `toLocalDateTime`), and compute `coverage_gaps` for missing metrics, `null`-value items (`missing_reason`), partially uncovered time sub-intervals, and relevant snapshot-level gaps. Added unit tests in `src/server/tools/tools.test.ts`.
- **Decisions:** none (follows PRD §3a and `ToolRegistry` contract).
- **Interfaces others depend on:** `tools` (`ToolRegistry` in `src/server/tools/index.ts`) — contract unchanged, now returns time-filtered items and accurate `coverage_gaps` for Planning (YT-05), Workout Adaptation (YT-06), and Event Logistics (JT-12).
- **Unfinished / next:** JT-01 (agent runner) and JT-03 (evidence snapshot builder + freshness).
- **Gotchas:** Fixture snapshots in Case 1 and Case 2 only include `temperature` (not `precipitation_probability` or `wind_speed`); `get_forecast` requires `temperature` coverage and also checks interval coverage for `precipitation_probability` and `wind_speed` whenever those metrics are present in the snapshot.
- **Requests:** none

## 2026-10-27 — JT-02: Audit fixes (#4)
- **Done:** Tightened `get_forecast` / `get_air_quality` after review: snapshot gaps filtered by whole park ID and domain (no `park-ab` vs `park-a` leaks, no park-record/template gaps); inverted or zero-length windows and non-candidate parks return no items plus an explicit gap; only `forecast` items count as coverage (observations never do); null-value gaps name the evidence ID and its own period. Scenario AQI days now end at next-day `00:00`. Added tests for each case.
- **Decisions:** D-019.
- **Interfaces others depend on:** gap strings from the condition tools changed wording for null-value items and the new invalid-window / unknown-park cases.
- **Unfinished / next:** JT-03 should write snapshot gaps that name the park ID and source (NWS / AirNow) so D-019 filtering works.
- **Gotchas:** A snapshot gap naming a park ID that is nowhere in the snapshot is treated as regional.
- **Requests:** Yadan (YT-01/YT-02): mark AirNow current values `observation`, use half-open periods ending at the next period's start, and include the park ID and source name in adapter gaps (current placeholders already do).

---

<!-- Task sections (see CLAUDE.md, "Work logs, decisions and task status"). -->

## JT-03 — Evidence snapshot builder + freshness/coverage rules (#5)

## JT-04 — Heat/AQI policies + policy-config (labeled "unreviewed demo policy") (#6)

## JT-05 — Logistics rules: allowed parks, start window, permit-review warning (≥20, non-critical) (#7)

### 2026-10-27 — JT-05: Logistics rules
- **Done:** replaced the placeholder `logisticsRules` in `src/server/rules/logistics.ts` with real
  `event_constraints.start_window`, `event_constraints.allowed_park` and `permissions.permit_review` checks;
  tests in `logistics.test.ts` (incl. Case 1 and Case 2 fixtures).
- **Decisions:** D-018 (permit flag ≥ 20, non-critical; unknown without an organizer record at any group size).
- **Interfaces others depend on:** `logisticsRules` (same export); also exports `startWindowCheck`,
  `allowedParkCheck`, `permitReviewCheck`, `LOGISTICS_POLICY`.
- **Unfinished / next:** JT-06 decides which checks are critical (start window / allowed park are critical for now).
- **Gotchas:** permit confirmations match on `applies_to.park_id`; when `valid_from`/`valid_to` are set, the plan's
  start time must be at or after `valid_from` and before `valid_to`
  (the same rule as Yadan's workout rules, D-023). Plan and brief time zones are both fixed to New York by the contracts.
- **Requests:** none

## JT-06 — check_plan: replace placeholder rules, decide critical vs non-critical checks (#8)

## JT-07 — Lifecycle: states, versions, approval invalidation, stale-result rejection (replace stub service) (#9)

### 2026-10-27 — JT-07: Lifecycle
- **Done:** Replaced the stub state handling in `src/server/lifecycle/service.ts`. New: `transitions.ts`
  (transition table, `assertCanStart`, `transition`, `deriveStatus`), `confirmations.ts` (scope matching,
  `applyConfirmations`), `snapshots.ts` (fixture snapshot per version, stub until JT-03). Every save checks
  the stored event has not changed since the request loaded it. Tests for each transition, invalid transitions,
  approval invalidation, stale version/snapshot/result rejection, confirmation scope and finalize idempotency,
  plus PRD Case 3.
- **Decisions:** D-016 (transitions, approval invalidation, confirmation carry-forward), D-017 (finalize idempotency).
- **Interfaces others depend on:** exported service functions and API shapes unchanged. Additive contract
  changes in `src/contracts/event.ts`: `PlanVersion.source` gains `"recheck"`; `FinalizedRecord` gains optional
  `idempotency_key`. New API behavior for the UI: invalid actions return 400 `invalid_request` (e.g. confirming
  a finalized version), stale requests 409 `stale_version`, approving `needs_verification` 409 `blocked`.
  A confirmation or reported change on an approved version clears approval; request review does not.
  A brief edit clears `event.confirmations`.
- **Unfinished / next:** JT-09 full save gate (freshness, required confirmations). JT-03 snapshot builder:
  `snapshotFor` must return a new snapshot ID whenever evidence changes, so recheck revalidates. JT-08 should
  make the stale-write check atomic (compare-and-swap on `updated_at`) in the hosted store.
- **Gotchas:** fixture snapshot IDs never change (agent stubs look fixtures up by ID), so in fixture mode
  recheck always reports "evidence unchanged". Tests swap in a new snapshot ID with `vi.mock`. A recheck with
  a new snapshot revalidates with `checkPlan`, whose placeholder rules return unknown → `needs_verification`.
- **Requests:** none

## JT-08 — Store: hosted DB, drafts + finalized events, duplicate-save protection (#10)

## JT-09 — Final save gate (all 5 checks) (#11)

## JT-10 — Orchestrator: conflict trigger, parallel specialists, combination checks, reviewer, 1 revision round, budgets (#12)

## JT-11 — NYC Parks adapter + 3–5 curated parks with reviewed coordinates (replace placeholder parks) (#13)

### 2026-10-27 — JT-11: NYC Parks adapter + curated parks
- **Done:** `src/server/data/parks.ts`: `fetchParkRecords(mode)` checks each curated park against its NYC Open
  Data Parks Properties record and returns one `park_record` reference item per park (fixture or live).
  Flags missing/retired records, name/borough/acreage mismatches and coordinates outside the boundary as
  coverage gaps; never throws. `parks.json` now has 10 real parks; recorded source data in
  `fixtures/sources/parks/parks-properties.json` (labeled fixture). The eval scenarios keep their fixture parks
  `park-a`/`park-b`, now in `fixtures/scenarios/parks.json`, so no scenario or test IDs change.
- **Decisions:** D-020 (10 curated parks, more than the PRD's 3–5).
- **Interfaces others depend on:** curated park IDs are `park-<property ID>`; fixture scenarios still use
  `park-a`/`park-b`. `getCuratedParks()` unchanged; new `fetchParkRecords(mode, deps)` for the snapshot builder (JT-03).
- **Unfinished / next:** JT-03 should call `fetchParkRecords` and use its items in the snapshot (scenario
  helpers still build park evidence by hand). Live mode was exercised only with an injected fetch in tests.
- **Gotchas:** McCarren's boundary is 5 parcels; its rounded centroid fell in a street, which the boundary
  check caught. Large parks (Crotona, Clove Lakes, Wolfe's Pond) note that the coordinate is not a meeting point.
- **Requests:** Yadan: please agree to D-020 (10 parks instead of 3–5). Seeded demo events still show the fixture
  parks ("Park A", "Park B"), labeled as fixture data.

## JT-12 — Event Logistics agent (#14)

### 2026-10-28 — JT-12: Event Logistics agent
- **Done:** `src/server/agents/logistics/agent.ts`: `logisticsDefinition` (tools: get_park_candidates, get_forecast,
  get_air_quality, check_plan; the PRD's System Prompt v0 in `prompt.md`) and `logisticsAgentImpl`, which runs the
  agent and then `enforceLogisticsResults`. Tests in `agent.test.ts` use the fake runner (no API calls), including a
  check that every eval fixture's Logistics output passes the harness's checks unchanged.
- **Decisions:** the harness drops an option that is assessed for a candidate it wasn't given, whose plan doesn't
  match its candidate, that changes the workout (template, adaptations or length: Workout Adaptation's job, and the
  prompt says not to), or that keeps the current park and time. Checks always come from check_plan; unknown
  critical checks are listed in the option's unknowns; failed critical checks become blocking concerns.
  `index.ts` still exports the stub, as Planning and Workout do; the orchestrator picks stub or real (JT-10).
- **Interfaces others depend on:** `logisticsAgentImpl`, `logisticsDefinition`, `enforceLogisticsResults`.
- **Unfinished / next:** a live run once the orchestrator can choose the real agent (JT-10), then evals (JT-17/18).
- **Gotchas:** tests compare against the real `check_plan` tool rather than fixed statuses, so they hold before and
  after the real heat/AQI rules (JT-04) merge.
- **Requests:** none

## JT-13 — Independent Reviewer agent (#15)

### 2026-10-28 — JT-13: Independent Reviewer agent
- **Done:** `src/server/agents/reviewer/agent.ts`: `reviewerDefinition` (only check_plan: the Reviewer cannot
  retrieve new evidence) and `reviewerAgentImpl`, which runs the agent and then `enforceReviewerResults`. The user
  message includes both proposals, the harness's combination checks and `revision_available`. Tests in
  `agent.test.ts` use the fake runner, including every eval fixture's Reviewer output.
- **Decisions:** the harness drops a combination that cites an option nobody proposed, whose plan isn't its
  candidate, or whose park/time or workout comes from neither a cited specialist option nor the original plan.
  Checks always come from check_plan. A recommendation is kept only when every critical check of that combination
  passes; otherwise it becomes null and its blockers are added to blocking_issues. Revision requests are kept only
  while the round is available and only for options that specialist proposed. Status is only ever made more
  cautious: a draft with no passing recommendation, or a revision request with no valid request left, becomes
  needs_verification, and "no feasible option" becomes needs_verification while any combination is not a
  demonstrated fail (missing evidence is not infeasibility).
- **Interfaces others depend on:** `reviewerAgentImpl`, `reviewerDefinition`, `enforceReviewerResults`. The
  orchestrator (JT-10) must pass `combination_checks` and the run context's `revision_available`.
- **Unfinished / next:** live run through the orchestrator (JT-10); evals (JT-17/18).
- **Gotchas:** a combined option may take its park/time from the Logistics option and its workout from the Workout
  option even when the Workout option was assessed at another time (Case 2, combo-1); the combined plan is checked
  as a whole.
- **Requests:** none

## JT-14 — API routes on the real harness (snapshot builder, orchestrator, save gate) (#16)

## JT-15 — End-to-end integration with Yadan's agents, adapters and UI (#17)

## JT-16 — Fixtures for cases 3–12 with expected outputs (written before first run) (#18)

### 2026-10-27 — JT-16: Fixtures for eval cases 3–12
- **Done:** `fixtures/scenarios/case-03` to `case-12` (brief, snapshot, expected agent outputs, `expected`
  outcome), `expected.ts` (`ExpectedOutcome`), `expected` added to cases 1–2, registry + `evalCases` in
  `index.ts`, helpers for per-case retrieval time, fixture-only templates and plans. `scenarios.test.ts` now
  checks all 12 cases: contracts, fixture labels, ID references, template/adaptation IDs, confirmation scoping,
  and agreement between fixture outputs and `expected`.
- **Decisions:** D-021 (case definitions).
- **Interfaces others depend on:** `evalCases` and `ExpectedOutcome` (for JT-17); `case03.refreshed` is the
  snapshot-B registry entry; `case11.malformedOutputs`; `case12.INJECTED_TEXT`.
- **Unfinished / next:** JT-17 eval runner grades against `expected`. Case 3 gate failures and case 11
  rejection are asserted by the harness/runner later, not by these fixture tests.
- **Gotchas:** a space confirmation names the layout it confirms in `category` (D-023, Yadan's workout rules).
  Every case expected to pass has a surface confirmation, because the real rules treat an unconfirmed surface as
  unknown. Cases 1, 2, 4, 5, 8, 10–12 read their templates from `workouts.json`, so template edits can change them.
- **Requests:** Yadan: review the expected outcomes for cases 6 and 7 (workout substitution and duration).
  Yadan: Case 1 now has a surface confirmation (`ev-c1-surface-confirm`, as you asked), which breaks 4 tests in
  `workout.test.ts` that add their own surface evidence to Case 1. Dropping the base snapshot's surface
  confirmations in `run()` fixes all 4.

## JT-17 — Eval runner + comparison: rules vs 1 agent vs 4 agents (#19)

## JT-18 — Logistics + Reviewer eval cases (#20)

## JT-19 — Deploy to Vercel: env vars, demo mode, Anthropic spend cap, rate limit (#21)

## JT-20 — Early deploy of the stub app to Vercel, to find hosting issues (time limits, env vars, store resets) (#40)

## JT-21 — Decide the hosted database and record it in docs/decisions.md (#41)
