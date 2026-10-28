# Work log — JT

Add newest entries at the bottom. One entry per task or work session.

<!--
## YYYY-MM-DD — TASK-ID: short title
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
- **Decisions:** D-013 (`ANTHROPIC_MODEL` defaults to `claude-haiku-5-5`), D-014 (fail fast with `tool_error` on disallowed tools, invalid tool input, or thrown tool errors).
- **Interfaces others depend on:**
  - `runAgent(definition, input, deps)` in `src/server/agents/runner.ts` (implements `RunAgent`).
  - `createFakeRunner(steps, options?)` in `src/server/agents/fake-runner.ts` for agent tests (YT-05, YT-06, JT-12, JT-13) with no network calls:
    - Pass an array of steps: `{ tool_calls: [{ name, input }] }`, `{ output: jsonObject }`, `{ error: new Error(...) }`, or `(call, turn) => step`.
    - Call `await fake(definition, input, deps)` directly (or `const restore = fake.install()` around `agent.run(input, deps)`), and inspect `fake.calls` for recorded requests.
- **Unfinished / next:** JT-02 (finish agent tools: time-window filtering and coverage gaps).
- **Gotchas:** `budget.record` rejects over-limit deltas without recording partial values, so when a final model call exceeds a token or `elapsed_ms` cap, that call's usage appears in `result.usage` but not in `budget.used()` (to handle in JT-10).
- **Requests:** `CLAUDE.md` needs an ownership row/entry assigning `src/server/agents/fake-runner.ts` to JT (to be done in a separate small PR).

## 2026-10-27 — JT-11: NYC Parks adapter + curated parks
- **Done:** `src/server/data/parks.ts`: `fetchParkRecords(mode)` checks each curated park against its NYC Open
  Data Parks Properties record and returns one `park_record` reference item per park (fixture or live).
  Flags missing/retired records, name/borough/acreage mismatches and coordinates outside the boundary as
  coverage gaps; never throws. `parks.json` now has 10 real parks; recorded source data in
  `fixtures/sources/parks/parks-properties.json` (labeled fixture). Case 1/2 fixtures, lifecycle and check-plan
  tests now use McCarren (`park-b058`, PRD "Park A") and Astoria (`park-q004`, PRD "Park B").
- **Decisions:** D-020 (10 curated parks, more than the PRD's 3–5).
- **Interfaces others depend on:** park IDs changed from `park-a`/`park-b` to `park-<property ID>`;
  `getCuratedParks()` unchanged; new `fetchParkRecords(mode, deps)` for the snapshot builder (JT-03).
  Case 2 snapshot now lists only the two allowed parks.
- **Unfinished / next:** JT-03 should call `fetchParkRecords` and use its items in the snapshot (scenario
  helpers still build park evidence by hand). Live mode was exercised only with an injected fetch in tests.
- **Gotchas:** McCarren's boundary is 5 parcels; its rounded centroid fell in a street, which the boundary
  check caught. Large parks (Crotona, Clove Lakes, Wolfe's Pond) note that the coordinate is not a meeting point.
- **Requests:** Yadan: please agree to D-020 (10 parks instead of 3–5). Seeded events now show real park names.
