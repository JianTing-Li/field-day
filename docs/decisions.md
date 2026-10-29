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
- **Status:** in use

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

### D-JT03-1 — Freshness limits per source
- **Date / owner:** 2026-10-28 · JT
- **PRD section:** §3 "Validation Policies" (Freshness), §3 "Final save gate" (Current evidence)
- **Decision:** Each item's age is measured from `retrieved_at` to the snapshot's assessment time, once, by the
  snapshot builder, and stored in `item.freshness`; rules read that status and never use the clock. Live mode
  assesses at the snapshot's `created_at`. Fixture mode assesses each recorded item at its own recording time and
  says so in `freshness.note`, because recordings are old by design; fixture evidence never supports real-world
  finalization. `freshness.conditions` passes only when fresh forecasts with a value (or a known AQI category)
  cover the full event interval for both temperature and AQI; anything missing or stale is unknown. Precipitation
  and wind are not required. The save gate (JT-09) refreshes a live snapshot that is older than these limits at
  finalize time. Limits are based on how often each source updates; they are unreviewed demo values.
- **Value:** NWS hourly forecast 3 h · AirNow forecast 24 h · AirNow observation 2 h · parks, templates,
  organizer confirmations: no limit · policy version `unreviewed-demo-policy-v1`
- **Status:** in use

### D-JT03-2 — Snapshot candidates and IDs
- **Date / owner:** 2026-10-28 · JT
- **PRD section:** §3 "Shared state and ownership" (evidence snapshot), §3a
- **Decision:** The builder includes only the brief's allowed parks. Parks without a reviewed coordinate stay in
  `park_candidates` but get no conditions and no candidates, with a gap. Candidates start every 30 minutes from the
  earliest to the latest allowed start (inclusive), ID `cand-<park_id>-<HHMM>`. Conditions are requested from the
  earliest start to the latest start plus the duration plus the longest permitted adaptation. The snapshot ID is
  `snap-<event_id>-v<version>-<hash>`, a hash of the evidence that ignores freshness and template read times, so
  unchanged fixture evidence keeps its ID (D-016) and every live fetch gets a new one.
- **Status:** in use

## JT-04 — Heat/AQI policies + policy-config (labeled "unreviewed demo policy") (#6)

### D-JT04-1 — Heat and AQI demo policy (supersedes the TBD values in D-010)
- **Date / owner:** 2026-10-28 · JT
- **PRD section:** §3 "Validation Policies" (Heat, Air quality)
- **Decision:** Heat reads the NWS hourly forecast air temperature for every hour the event overlaps; the hottest
  hour decides. NWS humidity is not collected, so this is not a heat index; that is a known limitation. AQI uses the
  highest value across pollutants from AirNow's daily forecast for the event day. A forecast with only a category
  uses the category's AQI range: it passes when the whole range is within the limit, fails when the whole range is
  above it, and is unknown otherwise. AQI observations count only for an hour of the event itself; they can fail the
  check but never cover it. An instructor limit in the brief applies only when it is stricter than the policy. A
  known reading over the limit fails even when other hours are missing; otherwise missing or stale evidence is
  unknown. Limits are inclusive. Values are an unreviewed demo policy and are consistent with every eval fixture
  (passes at 84°F and below, fails at 92°F and above; AQI 28–68).
- **Value:** heat max 90°F (air temperature) · AQI max 100 · policy version `unreviewed-demo-policy-v1`
- **Status:** in use

## JT-05 — Logistics rules: allowed parks, start window, permit-review warning (≥20, non-critical) (#7)

### D-018 — Logistics rules and permit-review warning
- **Date / owner:** 2026-10-27 · JT
- **PRD section:** §3 "Validation Policies" (event constraints, permissions)
- **Decision:** `src/server/rules/logistics.ts` checks the allowed park, the start window (event date and
  inclusive earliest–latest, New York time) and the permit-review warning. A null park or start time is unknown.
  The permit-review check is non-critical and passes only on an organizer `permission_confirmation` for the same
  park (and time, when the record has a valid period); a recorded "no" fails. With no record it is unknown at any
  group size: 20 or more raises the review flag, under 20 says permit status is not recorded, since group size
  alone does not show whether permission is needed. Start-window and allowed-park checks are critical for now;
  JT-06 decides the final critical set.
- **Value:** permit-review flag: group size ≥ 20 (source: NYC Parks permit guidance) · policy version `logistics-rules-v1`
- **Status:** in use

## JT-06 — check_plan: replace placeholder rules, decide critical vs non-critical checks (#8)

### D-JT06-1 — Critical checks
- **Date / owner:** 2026-10-28 · JT
- **PRD section:** §3 "Validation Policies", §3 "Final save gate"
- **Decision:** Every check is critical except `permissions.permit_review`, which stays a non-critical review
  warning (D-007, D-018). `CRITICAL_CHECKS` in `src/server/rules/check-plan.ts` is the single list and check_plan
  applies it to every rule module's results. There is no rain or wind check: the PRD defines no policy for them, so
  precipitation and wind are shown as information only.
- **Value:** critical: start_window, allowed_park, equipment, duration, heat, air_quality, freshness, space,
  surface · non-critical: permit_review
- **Status:** in use

## JT-07 — Lifecycle: states, versions, approval invalidation, stale-result rejection (replace stub service) (#9)

### D-016 — Lifecycle transitions and confirmation carry-forward
- **Date / owner:** 2026-10-27 · JT
- **PRD section:** §2 "Event lifecycle", §3 "Shared state and ownership", §3c, §4 acceptance criteria
- **Decision:** Status lives on each plan version; the event's status is its current version's status.
  Allowed status changes are listed once in `src/server/lifecycle/transitions.ts`; anything else is
  `invalid_request` (approving `needs_verification` is `blocked` with the blockers). Brief edits, generate,
  applied options and a recheck that gets a new snapshot ID each create a new version; old versions are kept.
  Approval is tied to version + snapshot ID and is cleared by any new version, a new confirmation or a
  reported change (the approved version returns to `ready_for_approval`). Requests or agent results naming an
  outdated version or snapshot, or finishing after the event changed, are rejected with `stale_version`.
  Confirmations are re-applied to later versions only for the same check at the same park (and time, if
  given), and a brief edit retires them. A recheck with an unchanged snapshot ID leaves the plan as is.
- **Status:** in use

### D-017 — Finalize idempotency
- **Date / owner:** 2026-10-27 · JT
- **PRD section:** §3c "Draft persistence and duplicate-save protection"
- **Decision:** A finalize request for the already-finalized version returns the saved record whatever its
  key, even after a newer draft exists. The key is stored on `FinalizedRecord.idempotency_key`; reusing it for
  a different version is `invalid_request`.
- **Status:** in use

## JT-08 — Store: hosted DB, drafts + finalized events, duplicate-save protection (#10)

## JT-09 — Final save gate (all 5 checks) (#11)

## JT-10 — Orchestrator: conflict trigger, parallel specialists, combination checks, reviewer, 1 revision round, budgets (#12)

### D-JT10-1 — Choosing stub or real agents
- **Date / owner:** 2026-10-28 · JT
- **PRD section:** §3 "Orchestration & Shared State"; CLAUDE.md "Stubs and placeholders"
- **Decision:** `FIELDDAY_AGENTS=real` runs every real agent that exists; anything else (the default, `stub`) runs the
  fixture-backed stubs and makes no Anthropic calls. The orchestrator picks the implementation
  (`src/server/orchestrator/agents.ts`) by importing each real agent from its `agent.ts`; every agent folder's
  `index.ts` keeps exporting its stub, so fixture mode and the lifecycle tests are unchanged. An agent with no real
  version yet runs as its stub, and every run reports which agents were stubs so an eval never mislabels one.
- **Value:** default `stub`
- **Status:** in use

### D-JT10-2 — What starts the specialists
- **Date / owner:** 2026-10-28 · JT
- **PRD section:** §3 "Workflow at a glance", "How the agents connect"
- **Decision:** A conflict is a critical check that fails on the drafted plan (source `harness`) or an organizer
  report or review request (source `organizer`). A critical check that is only unknown is not a conflict: the
  specialists cannot supply missing evidence, so the plan goes to the organizer as needs_verification with its
  tasks. This matches every eval fixture (`specialists_run`): cases 2 and 4–9 run the specialists, cases 1, 3 and
  10–12 do not.
- **Status:** in use

### D-JT10-3 — Run budget and revision round
- **Date / owner:** 2026-10-28 · JT
- **PRD section:** §3 "Execution budgets"
- **Decision:** One budget is shared by every agent in a run. The orchestrator counts agent executions itself
  (stubs included) and stops at 7: planning, 2 specialists, first review, at most 2 specialist revisions and a final
  review. Only the specialists the Reviewer names run again in the revision round. A final review that still asks
  for a revision becomes needs_verification with the request listed as a blocking issue; there is never a second
  round. Running out of budget, a failed agent or an answer for another version or snapshot returns an explicit
  unresolved result. The other caps keep D-004's placeholder values until the evals (JT-17) measure real runs; the
  elapsed cap (240 s) must also fit the hosting function time limit, to be confirmed in the JT-20 deploy.
- **Value:** 7 agent executions · 1 revision round · other caps as D-004 (proposed)
- **Status:** in use

## JT-11 — NYC Parks adapter + 3–5 curated parks with reviewed coordinates (replace placeholder parks) (#13)

### D-020 — Curated parks
- **Date / owner:** 2026-10-27 · JT
- **PRD section:** §2 MVP Scope ("3–5 park candidates"), Data Sources "NYC Parks Open Data"
- **Decision:** Use 10 curated parks instead of the PRD's 3–5, so the Logistics agent has real alternatives
  and parks outside the allowed list to stay away from. Two per borough, chosen for variety (size, track vs
  lawn, waterfront, spread across forecast grid cells). Supersedes the PRD's 3–5; needs Yadan's agreement.
- **Value:** M047 Thomas Jefferson, M088 Tompkins Square, B058 McCarren, B032 Fort Greene, Q004 Astoria,
  Q102 Juniper Valley, X010 Crotona, X104 Williamsbridge Oval, R005 Clove Lakes, R031 Wolfe's Pond.
  Park IDs are `park-<Parks property ID>`. Each coordinate is the centroid of the Parks Properties boundary,
  rounded to 4 decimals and checked to lie inside the boundary (McCarren moved to 40.7207, -73.9518 because
  the rounded centroid fell in a street between parcels). Coordinates reviewed by JT on 2026-10-27. They are
  for NWS/AirNow lookups, not meeting points. Space, surface, capacity and permits stay unknown.
  Eval scenarios keep their own fixture parks (`park-a`, `park-b` in `fixtures/scenarios/parks.json`), so scenario
  and test IDs don't change when the curated list does. Resolves the "Curated parks (JT-11)" open decision.
- **Status:** in use

## JT-12 — Event Logistics agent (#14)

## JT-13 — Independent Reviewer agent (#15)

## JT-14 — API routes on the real harness (snapshot builder, orchestrator, save gate) (#16)

## JT-15 — End-to-end integration with Yadan's agents, adapters and UI (#17)

## JT-16 — Fixtures for cases 3–12 with expected outputs (written before first run) (#18)

### D-021 — Eval case definitions (cases 3–12)
- **Date / owner:** 2026-10-27 · JT
- **PRD section:** §2c Success Metrics, §3d Eval Card
- **Decision:** The PRD defines cases 1–3 in full and outlines 4–12. Inputs and expected outcomes for 4–12 are
  defined in `fixtures/scenarios/case-NN-*.ts` and were written before any agent run. Each case exports an
  `expected: ExpectedOutcome` (`fixtures/scenarios/expected.ts`); evals grade on these fields, not on matching
  the full fixture agent outputs. Cases 4–8 are the known-feasible conflicts. Cases 6, 7 and 9 use fixture-only
  templates so later edits to `workouts.json` never change an eval input.
- **Status:** proposed

## JT-17 — Eval runner + comparison: rules vs 1 agent vs 4 agents (#19)

### D-JT17-1 — How the three architectures are run and graded
- **Date / owner:** 2026-10-28 · JT
- **PRD section:** §2c Success Metrics, §3d Eval Card
- **Decision:** Rules-only checks every park/time candidate × template × permitted adaptation with check_plan and
  takes the best (pass over unknown over fail, then the organizer's preferred park and template, then no
  adaptation, then the earliest start); it is not graded on Case 11, which has no agent output to reject. Single is
  the Planning agent alone. Multi is the orchestrator's full workflow. Every result is graded on check_plan's result
  for its final plan (the recommended combination, or the top-ranked one), not on the agent's claim. "Finalize" is
  allowed only for a draft whose checks all pass, until the save gate (JT-09) exists. Case 3 is a final-validation
  case: every architecture plans on snapshot A, then the result is rechecked on the refreshed snapshot B and a
  draft that no longer passes becomes needs_verification. "Invented claims" are counted as cited evidence IDs that
  are not in the snapshot; claim text is not read. Real runs are gated behind `RUN_EVALS=1` and never run in `npm test`.
- **Status:** in use

### D-JT17-2 — The harness rejects a Planning answer with unknown references
- **Date / owner:** 2026-10-28 · JT
- **PRD section:** §3d Case 11; §3 "The harness validates every returned JSON"
- **Decision:** The orchestrator rejects a Planning answer as `invalid_output` when its plan names a park/time
  candidate that isn't in the snapshot, when the plan's park or time doesn't match that candidate, or when a fact
  cites evidence that isn't in the snapshot. It is rejected, not repaired. The specialists and the Reviewer keep
  their own harness checks, which drop the bad options and keep the rest.
- **Status:** in use

## JT-18 — Logistics + Reviewer eval cases (#20)

## JT-19 — Deploy to Vercel: env vars, demo mode, Anthropic spend cap, rate limit (#21)

### D-JT19-1 — Agent-run rate limit for the public demo
- **Date / owner:** 2026-10-29 · JT
- **PRD section:** §3 "Execution budgets"; open decision "Persistence, deployment, and user-access approach"
- **Decision:** The deployed app has no sign-in and runs real agents on shared credits, so the three routes that run
  agents (generate, changes, review) are rate limited when `FIELDDAY_AGENTS=real`: 18 runs per visitor (IP address)
  per rolling hour and 180 runs per UTC day in total. Over the limit the API returns 429 `rate_limited` (an additive
  `ApiError` code) with `Retry-After`, and nothing runs. Recheck is not limited: it runs check_plan, not agents.
  Counts are in memory per server instance, so PR 6 does not depend on the database; a second instance starts at
  zero. The Anthropic workspace spend limit is the backstop. Seeding the demo events on a server's first request runs
  Planning and is not counted.
- **Why these numbers:** one demo rehearsal is about 4 or 5 agent runs, and a room on shared Wi-Fi shares one IP
  address, so 18 per hour leaves room for several rehearsals or a few people trying the demo at once. A Generate uses
  about 30k tokens and a conflict review about 80k (first real eval run), so one looping visitor is capped at about
  1.4M tokens an hour and the whole demo at about 14M a day.
- **Value:** 18 per visitor per hour; 180 per day; `src/app/api/_lib/rate-limit.ts`
- **Status:** in use

### D-JT19-2 — What "demo mode" means
- **Date / owner:** 2026-10-29 · JT
- **PRD section:** §4 "Prototype definition of done" ("Live integrations and fixtures are clearly identified")
- **Decision:** Demo mode is labeling, not a separate mode: the fixture banner, the seeded scenario events, and (with
  real agents) a line saying plans are drafted by Claude on shared demo credits with the rate limit. No feature is
  turned off for visitors.
- **Status:** in use

### D-JT19-3 — Function time limit
- **Date / owner:** 2026-10-29 · JT
- **PRD section:** §3 "Execution budgets"
- **Decision:** Every event route sets `maxDuration = 300` seconds, so a conflict review (run budget 240 s, D-004) or a
  server's first request (which seeds the demo events with Planning) is never cut off by the platform's default limit.
- **Value:** 300 s
- **Status:** in use

## JT-20 — Early deploy of the stub app to Vercel, to find hosting issues (time limits, env vars, store resets) (#40)

## JT-21 — Decide the hosted database and record it in docs/decisions.md (#41)

### D-JT21-1 — Hosted database: Neon Postgres through Vercel
- **Date / owner:** 2026-10-28 · JT
- **PRD section:** §3c "Draft persistence and duplicate-save protection"
- **Decision:** The hosted app stores events and evidence snapshots in Neon Postgres, added to the Vercel project
  from the Vercel Marketplace (free plan). Postgres makes "one finalized record per approved version" a unique
  constraint instead of application code, and gives JT-08 an atomic stale-write check (compare-and-swap on
  `updated_at`, from JT-07). Rejected: a key-value store (Upstash Redis), which has no unique constraints, so
  duplicate-save protection would rest on our own code; a separate Supabase account, which is more than the demo needs;
  files or SQLite on Vercel, whose filesystem does not persist between requests.
  - **Which store runs:** the Neon store when `DATABASE_URL` is set (the Marketplace integration sets it in Vercel).
    Tests and local `npm run dev` keep the in-memory store; tests never connect to Neon.
  - **Free-plan sleep:** Neon suspends after 5 idle minutes, and the first request after that waits for it to wake.
    The store retries connection errors a few times. A finalize that fails first looks for an already saved record
    before saving again (D-017), so a retry never saves twice.
  - **Lifetime and reset:** data survives page refreshes and redeploys. A reset deletes all events and snapshots. Only
    JT runs it, with `npm run db:reset` locally or a manual GitHub Actions workflow that needs `RESET` typed in; the
    app has no reset path.
  - **Access:** the app has no sign-in (the PRD has no accounts), so anyone with the link can create, approve and
    finalize events. This is a known demo risk, listed under README "Limitations".
- **Value:** Neon Postgres (free plan) via the Vercel Marketplace; `DATABASE_URL`; in-memory store when it is unset
- **Status:** proposed (JT-08 builds it)

## YT-04 — Workout rules (JT waits on this) (#29)

### D-023 — Workout rules: what counts as a space or surface confirmation
- **Date / owner:** 2026-10-28 · Yadan
- **PRD section:** §3 "Validation Policies" (space/surface), open decision "Acceptable confirmation records"
- **Decision:** A confirmation counts only if it is an `organizer_confirmation` whose `confirms_check_id` matches,
  whose `applies_to.park_id` is the plan's park, and, when it has `valid_from`/`valid_to`, whose period covers the
  plan's start time. Space: the confirmation names the layout it confirms in `category` (e.g. `stationary`); with
  no `category` it confirms the template's own layout, so a "running lane unusable" report never resolves a
  stationary adaptation. `value: false` fails, `value: true` passes, a "no" wins over a "yes". Surface: a string
  value is the surface type, checked against the template's `surfaces`; a boolean is a yes/no on suitability.
  No matching confirmation means `unknown`. Adaptations change layout and length only, never equipment.
- **Status:** in use

## YT-05 — Planning agent (critical path, JT waits on this) (#30)

### D-024 — Planning output: the harness has the last word
- **Date / owner:** 2026-10-28 · Yadan
- **PRD section:** §3b Planning Agent, §3a check_plan
- **Decision:** After the model answers, the Planning agent re-runs `check_plan` on the model's final plan and
  uses that result as `rule_checks` (the prompt asks the model to send `null`). Evidence IDs that aren't in the
  snapshot are removed; a "verified" claim left with no evidence becomes "unverified" and a non-blocking concern
  is added. Every blocker gets a blocking concern. A `draft` whose checks aren't all `pass` becomes
  `needs_verification`; the agent never upgrades a status. The model gets the exact output JSON Schema in its
  user message.
- **Status:** in use

## YT-06 — Workout agent (JT waits on this) (#31)

### D-YT06-1 — Workout options: the harness has the last word
- **Date / owner:** 2026-10-28 · Yadan
- **PRD section:** §3b Workout agent (the PRD calls it the Workout Adaptation Agent), §3 specialist-option contract
- **Decision:** After the model answers, the Workout agent drops any option that is assessed for a park/time
  candidate it wasn't given, whose plan doesn't match its candidate's park and start time, or that changes no part
  of the workout (a park or time move alone is Logistics' job). Every kept option's `checks` come from a fresh
  `check_plan` run (the prompt asks for an empty placeholder to keep the answer short). Evidence IDs not in the
  snapshot are removed and noted in `unknowns`; every unknown critical check's reason is added to `unknowns`;
  every failed critical check gets a blocking concern. `options_proposed` with no options left becomes
  `needs_verification`. Same approach as D-024 for Planning.
- **Status:** in use

## YT-07 — Event list (`GET /api/events`): status, current version, finalized version (#32)

## YT-08 — Event brief form (`POST /api/events`, `PUT /api/events/:id/brief`) with field validation from `EventBrief` (#33)

## YT-09 — Event workspace (`GET /api/events/:id`): status bar, blockers + organizer tasks, plan card, checks (pass/fail/unknown with icons + text), evidence list; actions: Generate, Recheck, Something changed, Request review, Approve vN (#34)

## YT-10 — Alternatives comparison (`alternatives` on the current version): ranked combined options, before/after changes, checks, unknowns, recommendation; "Use this option" (`POST .../apply-option`) (#35)

## YT-11 — Confirmations, approve and finalize flow (`POST .../confirmations`, `.../approve`, `.../finalize`): each confirmation names its check, park and time (from the organizer task); exact version shown, gate checklist, blocked explanations, no duplicate finalize (#36)

## YT-12 — States: loading, data unavailable, stale version (409), fixture banner, save failed (#37)

## YT-13 — Planning + Workout eval cases (`evals/cases/planning/`, `evals/cases/workout/`) (#38)

### D-YT13-1 — Agent eval cases: rubric graded against check_plan
- **Date / owner:** 2026-10-28 · Yadan
- **PRD section:** §3d Eval Card, §2c Success Metrics
- **Decision:** Each Planning/Workout eval case (`evals/cases/<agent>/index.ts`) reuses a PRD scenario's brief and snapshot and has a rubric of criteria that grade the agent's own output. Criteria judge against the harness `check_plan` the runner passes in (`EvalContext.checkPlan`), never against hard-coded rule results, so they stay correct when JT-03/JT-04 replace the placeholder rules. Every case runs a shared baseline (schema, echoed version/snapshot, snapshot-only evidence, real candidates/templates/adaptations, no ready status or "pass" claims check_plan disagrees with, every blocker reported) plus scenario-specific criteria. A case passes when every critical criterion passes; advisory criteria (e.g. a permit review claimed as pass) are reported only. A blocker counts as reported when a blocking concern or organizer task covers its area. `runAndGrade(case, agent, deps, …)` runs any `AgentImpl` (stub, fake runner or live) and grades it, for JT-17's runner.
- **Value:** Planning cases 1, 2, 9, 10, 12; Workout cases 2, 4, 6, 7, 9.
- **Status:** in use
