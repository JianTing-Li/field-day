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

## JT-06 — check_plan: replace placeholder rules, decide critical vs non-critical checks (#8)

## JT-07 — Lifecycle: states, versions, approval invalidation, stale-result rejection (replace stub service) (#9)

## JT-08 — Store: hosted DB, drafts + finalized events, duplicate-save protection (#10)

## JT-09 — Final save gate (all 5 checks) (#11)

## JT-10 — Orchestrator: conflict trigger, parallel specialists, combination checks, reviewer, 1 revision round, budgets (#12)

## JT-11 — NYC Parks adapter + 3–5 curated parks with reviewed coordinates (replace placeholder parks) (#13)

## JT-12 — Event Logistics agent (#14)

## JT-13 — Independent Reviewer agent (#15)

## JT-14 — API routes on the real harness (snapshot builder, orchestrator, save gate) (#16)

## JT-15 — End-to-end integration with Yadan's agents, adapters and UI (#17)

## JT-16 — Fixtures for cases 3–12 with expected outputs (written before first run) (#18)

## JT-17 — Eval runner + comparison: rules vs 1 agent vs 4 agents (#19)

## JT-18 — Logistics + Reviewer eval cases (#20)

## JT-19 — Deploy to Vercel: env vars, demo mode, Anthropic spend cap, rate limit (#21)

## JT-20 — Early deploy of the stub app to Vercel, to find hosting issues (time limits, env vars, store resets) (#40)

## JT-21 — Decide the hosted database and record it in docs/decisions.md (#41)
