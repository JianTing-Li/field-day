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

## Open decisions
- Persistence: hosted database for Vercel (JT-21, Tuesday evening; needed by JT-08)
- Curated parks (JT-11) and reviewed workout templates (YT-03)
- Freshness limits per source (JT-03)
- Acceptable confirmation records for space, surface and permission
- Ranking priorities for equally valid alternatives

## D-013 — Curated parks
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
  Resolves the "Curated parks (JT-11)" open decision.
- **Status:** in use
