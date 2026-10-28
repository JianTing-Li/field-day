# Decisions

Decisions the PRD says to select and record. Add a decision under its task's section at the end of this file
(tasks added after 2026-10-28 use `docs/decisions/<TASK-ID>.md`); never edit someone else's entry.
New decisions use task-based IDs (`D-JT03-1`); D-000 to D-024 keep their numbers.
To change a decision, add a new entry that supersedes the old one.

Status: **proposed** (not yet in code) · **in use** · **reviewed** (checked by the appropriate reviewer) · **superseded**

<!--
### D-JT03-1 — Title
- **Date / owner:** YYYY-MM-DD · JT | Yadan | Both
- **PRD section:** §...
- **Decision:** ...
- **Value:** ...
- **Status:** proposed | in use | reviewed | superseded by D-...
-->

## D-001 — Stack
- **Date / owner:** 2026-10-26 · Both
- **PRD section:** §4 "Persistence, deployment, and user-access approach" (framework part)
- **Decision:** TypeScript everywhere: Next.js 16 (UI + API routes), Zod contracts, Vitest, npm, Tailwind. Deploy on Vercel.
- **Status:** in use

## D-002 — LLM provider
- **Date / owner:** 2026-10-26 · Both
- **PRD section:** §3
- **Decision:** Anthropic API via the official TypeScript SDK. Each developer uses their own key locally.
- **Value:** model: to be chosen in JT-01
- **Status:** in use (SDK installed); model proposed

## D-003 — Scope
- **Date / owner:** 2026-10-26 · Both
- **PRD section:** §2 MVP Scope
- **Decision:** Build only what the PRD includes. No promo caption. Design Brief tab ignored; Yadan owns UI design.
- **Status:** in use

## D-004 — Execution budgets
- **Date / owner:** 2026-10-26 · JT
- **PRD section:** §3 "Execution budgets"
- **Decision:** Max 7 agent executions and 1 revision round per run (PRD-fixed). Other caps are placeholders
  in `src/server/orchestrator/budget.ts` until measured in the first spike.
- **Value:** model_requests 40, tool_calls 80, input_tokens 400k, output_tokens 60k, elapsed 240 s (placeholders)
- **Status:** proposed

## D-005 — Data mode
- **Date / owner:** 2026-10-26 · Both
- **PRD section:** §4 "Live versus fixture-backed integrations for the first demo"
- **Decision:** `FIELDDAY_DATA_MODE=fixture` by default; `live` uses real integrations. Every adapter supports
  both. Fixture data is labeled everywhere, including the UI.
- **Status:** in use

## D-006 — Evidence type vs origin
- **Date / owner:** 2026-10-26 · JT
- **PRD section:** §3 "Common evidence contract"
- **Decision:** The PRD lists "fixture" as an evidence type. The contract keeps `evidence_type`
  (observation / forecast / organizer_confirmation / reference) separate from `origin` (live / fixture), so a
  fixture forecast is still a forecast and is still labeled as fixture data.
- **Status:** in use

## D-007 — check_plan overall result
- **Date / owner:** 2026-10-26 · JT
- **PRD section:** §3 "Validation Policies"
- **Decision:** overall = fail if any critical check fails; unknown if any critical check is unknown; else pass.
  Non-critical checks (permit-review warning) never change overall.
- **Status:** in use

## D-008 — Draft saving
- **Date / owner:** 2026-10-26 · JT
- **PRD section:** §3c "Draft persistence"
- **Decision:** Every successful API call saves the draft; there is no separate "save draft" request.
  Each plan change (generate, apply option, brief edit) creates a new plan version and clears approval.
- **Status:** in use (stub service)

## D-009 — Contract change rule
- **Date / owner:** 2026-10-26 · Both
- **PRD section:** —
- **Decision:** Additive contract changes may be made by either person in their own PR; breaking changes need
  their own PR approved by both.
- **Status:** in use

## D-010 — Environmental policy ownership and labeling
- **Date / owner:** 2026-10-26 · JT
- **PRD section:** §3 "Validation Policies"
- **Decision:** Heat/AQI policies are owned by JT; thresholds live in `src/server/rules/policy-config.ts`,
  labeled "unreviewed demo policy" until reviewed. Fixture scenarios use 90°F and AQI 100 as demo limits.
- **Value:** heat max: TBD (fixtures: 90°F) · AQI max: TBD (fixtures: 100)
- **Status:** proposed

## D-011 — Fixed check IDs
- **Date / owner:** 2026-10-26 · JT
- **PRD section:** §3a check_plan, §3 "Validation Policies"
- **Decision:** All checks use IDs from `CheckId` in `src/contracts/common.ts`. Space needs are one check
  (`space_surface.space`) assessed per park/time/workout; the reason text names the layout.
- **Status:** in use

## D-012 — Confirmations are scoped to a park and time
- **Date / owner:** 2026-10-26 · JT
- **PRD section:** §3d Case 2, §4 "Organizer confirmation resolves only the stated check"
- **Decision:** Organizer confirmations and tasks carry `park_id` and optional `start_time`. A confirmation
  resolves only the matching check at that park (and time); Park A suitability never resolves Park B.
- **Status:** in use

## D-013 — NWS adapter: wind ranges and the fixture recording
- **Date / owner:** 2026-10-27 · Yadan
- **PRD section:** §3 "Common evidence contract"
- **Decision:** When NWS gives a wind range ("5 to 10 mph"), the evidence uses the higher value and says so in
  `limitations`. Fixture mode always answers with one real recording (Central Park, grid OKX/34,45, retrieved
  2026-10-27, covering 2026-10-27T13:00 to 2026-11-03T00:00), so fixture events must fall in that window or they
  get a coverage gap. Provider error text is never copied into gaps; only the HTTP status is.
- **Status:** in use

## D-015 — AirNow adapter: which services, and when observations count
- **Date / owner:** 2026-10-27 · Yadan
- **PRD section:** §3 "Common evidence contract"
- **Decision:** Use AirNow's June 2026 services: `/aq/forecast/current/` (daily forecast per pollutant) and
  `/aq/observation/current/ziplatlong/` (current NowCast reading). The older lat/long and zip services were retired
  on 2026-10-01 and return HTTP 410. Forecasts cover whole days (00:00 to 00:00); each event day without one is a
  coverage gap. An observation is kept only when the hour it measured overlaps the event, so a current reading
  never stands in for a later event. A category-only forecast (AQI -1) becomes a missing value, not a guess. AirNow
  also sends some errors as HTTP 200 with a `WebServiceError` body; those are treated as failures. The API key is
  added only inside the live fetcher and never appears in evidence URLs or gaps.

## D-019 — Condition tool coverage rules
- **Date / owner:** 2026-10-27 · JT
- **PRD section:** §3a get_forecast / get_air_quality; Data Sources "Coverage" (NWS, AirNow)
- **Decision:** `get_forecast` and `get_air_quality` (`src/server/tools/index.ts`) report coverage like this:
  - Valid periods are half-open `[valid_from, valid_to)`; an hour ending 09:00 does not cover 09:00.
    Adapters should end a daily period at the next day's `00:00`, not `23:59`.
  - Only `forecast` items with a value and both bounds count as coverage. Observations, point-in-time
    items and items with a missing bound are returned but never cover a window.
  - Temperature (forecast) and AQI are always required. Precipitation probability and wind are checked
    only when the snapshot has that metric for the park at some time.
  - A window with `end_time <= start_time`, or a park that is not in the snapshot, returns no items and
    one explicit gap.
  - Snapshot-level gaps are passed on only when they are about the tool's domain (NWS/forecast/weather
    vs AirNow/AQI terms) and either name the requested park or name no park known to the snapshot.
    Gaps about park records or templates go to neither tool.
  - Local times are converted with `src/server/time.ts`; the repeated 1 a.m. hour on the fall-back
    date cannot be told apart in `LocalDateTime`.
- **Status:** in use

## Open decisions
- Persistence: hosted database for Vercel (JT-21, Tuesday evening; needed by JT-08)
- Curated parks (JT-11) and reviewed workout templates (YT-03)
- Freshness limits per source (JT-03)
- Acceptable confirmation records for space, surface and permission
- Ranking priorities for equally valid alternatives

## D-022 — Default Anthropic model
- **Date / owner:** 2026-10-27 · JT
- **PRD section:** §3
- **Decision:** The agent runner reads the model ID from `ANTHROPIC_MODEL` and defaults to `claude-haiku-5-5` when unset (completing the model choice left open in D-002).
- **Value:** `claude-haiku-5-5`
- **Status:** in use

## D-014 — Agent runner tool error handling
- **Date / owner:** 2026-10-27 · JT
- **PRD section:** §3a, §3b
- **Decision:** The agent runner fails fast and returns `tool_error` immediately if the model requests a tool not in `definition.allowed_tools`, if tool input fails `ToolSchemas` validation, or if a tool handler throws. Automatic retry/repair is reserved for the single final JSON output repair attempt.
- **Status:** in use

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

## YT-04 — Workout rules (JT waits on this) (#29)

## YT-05 — Planning agent (critical path, JT waits on this) (#30)

## YT-06 — Workout Adaptation agent (JT waits on this) (#31)

## YT-07 — Event list (`GET /api/events`): status, current version, finalized version (#32)

## YT-08 — Event brief form (`POST /api/events`, `PUT /api/events/:id/brief`) with field validation from `EventBrief` (#33)

## YT-09 — Event workspace (`GET /api/events/:id`): status bar, blockers + organizer tasks, plan card, checks (pass/fail/unknown with icons + text), evidence list; actions: Generate, Recheck, Something changed, Request review, Approve vN (#34)

## YT-10 — Alternatives comparison (`alternatives` on the current version): ranked combined options, before/after changes, checks, unknowns, recommendation; "Use this option" (`POST .../apply-option`) (#35)

## YT-11 — Confirmations, approve and finalize flow (`POST .../confirmations`, `.../approve`, `.../finalize`): each confirmation names its check, park and time (from the organizer task); exact version shown, gate checklist, blocked explanations, no duplicate finalize (#36)

## YT-12 — States: loading, data unavailable, stale version (409), fixture banner, save failed (#37)

## YT-13 — Planning + Workout eval cases (`evals/cases/planning/`, `evals/cases/workout/`) (#38)
