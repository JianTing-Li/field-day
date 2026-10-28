# Decisions

Decisions the PRD says to select and record. Add new entries at the bottom; never edit someone else's entry.
To change a decision, add a new entry that supersedes the old one.

Status: **proposed** (not yet in code) · **in use** · **reviewed** (checked by the appropriate reviewer) · **superseded**

<!--
## D-000 — Title
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

## D-018 — Logistics rules and permit-review warning
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
