# FieldDay — Tasks

Deadline: **Thursday Oct 29, 2026, noon.**

Rules: check off tasks only in your own section, in the same PR that implements them.
Format: `- [ ] **ID** Title (#issue) · target day · needs: IDs`.
"JT waits on this" marks Yadan tasks that JT's integration depends on.

## Setup — branch `feature/project-setup` (#1, JT builds, Yadan reviews)
- [x] **S-01** Next.js 16 + TypeScript + Tailwind + Zod + Anthropic SDK + Vitest
- [x] **S-02** Folder structure with owners
- [x] **S-03** CLAUDE.md
- [x] **S-04** TASKS.md, worklogs, README skeleton, docs/decisions.md
- [x] **S-05** .env.example + `.gitignore` exception
- [x] **S-06** Contracts: brief, evidence, checks, plan, options, tools, agents, runner, data, event, api
- [x] **S-07** Fixture scenarios for Case 1 (normal) and Case 2 (conflict), plus placeholder parks and workout templates
- [x] **S-08** Stubs: 4 agents, 5 tools, check_plan + placeholder rules, orchestrator, in-memory store, lifecycle service, all API routes
- [x] **S-09** GitHub Actions: test, typecheck, lint, build on PRs into develop
- [x] **S-10** PR template
- [x] **S-11** Branch protection on develop and main (rulesets) (#2)
- [x] **S-12** GitHub Issues + labels from this file
- [ ] **S-13** PR feature/project-setup → develop, reviewed by Yadan

## JT
### Do first (Tue AM)
- [ ] **JT-01** Agent runner: Claude call, tool loop, output validation, stale-context rejection, usage counting, plus a fake runner for agent tests (#3) · Tue AM · needs: S-06
- [ ] **JT-02** Finish agent tools: time-window filtering and coverage gaps (stubs exist) (#4) · Tue AM

### Harness
- [ ] **JT-03** Evidence snapshot builder + freshness/coverage rules (#5) · Tue
- [ ] **JT-04** Heat/AQI policies + policy-config (labeled "unreviewed demo policy") (#6) · Tue · needs: JT-03
- [ ] **JT-05** Logistics rules: allowed parks, start window, permit-review warning (≥20, non-critical) (#7) · Tue
- [ ] **JT-06** check_plan: replace placeholder rules, decide critical vs non-critical checks (#8) · Tue · needs: JT-04, JT-05
- [ ] **JT-07** Lifecycle: states, versions, approval invalidation, stale-result rejection (replace stub service) (#9) · Tue–Wed
- [ ] **JT-08** Store: hosted DB, drafts + finalized events, duplicate-save protection (#10) · Wed · needs: JT-21
- [ ] **JT-09** Final save gate (all 5 checks) (#11) · Wed · needs: JT-06, JT-07, JT-08
- [ ] **JT-10** Orchestrator: conflict trigger, parallel specialists, combination checks, reviewer, 1 revision round, budgets (#12) · Wed · needs: JT-01

### Data and agents
- [ ] **JT-11** NYC Parks adapter + 3–5 curated parks with reviewed coordinates (replace placeholder parks) (#13) · Tue
- [ ] **JT-12** Event Logistics agent (#14) · Wed · needs: JT-01, JT-02
- [ ] **JT-13** Independent Reviewer agent (#15) · Wed · needs: JT-01, JT-02

### Integration, evals, deploy
- [ ] **JT-14** API routes on the real harness (snapshot builder, orchestrator, save gate) (#16) · Wed · needs: JT-09, JT-10
- [ ] **JT-15** End-to-end integration with Yadan's agents, adapters and UI (#17) · Wed
- [ ] **JT-16** Fixtures for cases 3–12 with expected outputs (written before first run) (#18) · Wed
- [ ] **JT-17** Eval runner + comparison: rules vs 1 agent vs 4 agents (#19) · Wed–Thu
- [ ] **JT-18** Logistics + Reviewer eval cases (#20) · Thu
- [ ] **JT-19** Deploy to Vercel: env vars, demo mode, Anthropic spend cap, rate limit (#21) · Thu AM · needs: JT-20
- [ ] **JT-20** Early deploy of the stub app to Vercel, to find hosting issues (time limits, env vars, store resets) (#40) · Tue
- [ ] **JT-21** Decide the hosted database and record it in docs/decisions.md (#41) · Tue PM

## Yadan
### Setup (today)
- [x] **YT-00a** Add your `git config user.name` to the table in `CLAUDE.md` (small PR) (#22) · Mon
- [ ] **YT-00b** Review and approve the setup PR (S-13) (#23) · Mon
- [ ] **YT-00c** Copy `.env.example` to `.env.local` and add your own Anthropic API key (#24) · Mon
- [ ] **YT-00d** Register an AirNow API key (needed for live mode and deploy) (#25) · Tue

### Data and content
- [x] **YT-01** NWS weather adapter (port of weather.py) (#26) · Tue AM
  - **Files:** `src/server/data/weather.ts`, `weather.test.ts`, `fixtures/sources/nws/*.json`
  - **Uses:** `FetchForecast`, `ConditionsRequest`, `AdapterResult` (`src/contracts/data.ts`); `EvidenceItem` (`src/contracts/evidence.ts`)
  - **Do:** live mode: `GET https://api.weather.gov/points/{lat},{lon}`, follow `properties.forecastHourly`,
    send `User-Agent` from `NWS_USER_AGENT`. Convert NWS timestamps with `toLocalDateTime` (`src/server/time.ts`).
    Convert each hourly period overlapping the event to
    `EvidenceItem`s (metrics `temperature`, `precipitation_probability`, `wind_speed`; `evidence_type: "forecast"`;
    `applies_to.scope: "forecast_grid"`; units from the response). Fixture mode reads recorded responses from
    `fixtures/sources/nws/`. Record one real response and one failure response.
  - **Done when:** fixture mode returns evidence for the full event interval; an event outside the returned
    periods gives a `coverage_gaps` entry (never a guessed value); an HTTP failure returns empty items plus a
    gap instead of throwing.
  - **Test:** `npm test -- weather` (fixtures only; no live calls in tests)
- [ ] **YT-02** AirNow adapter (#27) · Tue
  - **Files:** `src/server/data/air.ts`, `air.test.ts`, `fixtures/sources/airnow/*.json`
  - **Uses:** `FetchAirQuality` (`src/contracts/data.ts`); `EvidenceItem`
  - **Do:** pick the forecast and observation endpoints from AirNow's current docs; key from `AIRNOW_API_KEY`,
    server-side only. Convert times with `toLocalDateTime` (`src/server/time.ts`). Map to `EvidenceItem` with metric `aqi`, `value` = AQI, `category`, `pollutant`,
    `applies_to.scope: "reporting_area"`, `area_label` = reporting area, `evidence_type` forecast or observation.
    Add the limitation "Regional reporting-area value, not a park-level measurement".
  - **Done when:** a future event uses forecasts only (an observation never stands in for a forecast); missing
    or failed data returns a gap, never an "acceptable" value.
  - **Test:** `npm test -- air`
- [ ] **YT-03** 2–3 workout templates (JT waits on this) (#28) · Tue
  - **Files:** `src/server/content/workouts.json` (replace the 2 placeholders)
  - **Uses:** `WorkoutTemplate` (`src/contracts/evidence.ts`)
  - **Do:** real exercises, duration, equipment, `space.layout`, `surfaces`, `group_size`, and `permitted_adaptations`.
    Set `review.status` to `"pending_instructor_review"` until an instructor reviews them. Keep the IDs used by
    fixtures (`tpl-bodyweight-45`, `tpl-run-intervals-45`, `adapt-stationary-circuit`) or tell JT if they change.
  - **Done when:** `npm test -- scenarios` passes (it validates this file against the contract).
- [ ] **YT-04** Workout rules (JT waits on this) (#29) · Tue · needs: YT-03
  - **Files:** `src/server/rules/workout.ts`, `workout.test.ts`
  - **Uses:** `RuleFn`, `RuleInput`, `CheckResult` (`src/contracts/checks.ts`)
  - **Do:** use only check IDs from `CheckId` (`src/contracts/common.ts`): `equipment.available`
    (template + adaptation equipment ⊆ brief equipment), `duration.fits` (template duration + adaptation
    deltas = brief duration), `space_surface.space` (the layout the session needs) and `space_surface.surface`.
    Space/surface `pass` only with an organizer-confirmation evidence item for that exact park
    (`confirms_check_id` + `applies_to.park_id`); otherwise `unknown`. Never look at heat or AQI here.
  - **Done when:** tests cover pass, fail and unknown for each check; unconfirmed space is `unknown`, never `pass`.
  - **Test:** `npm test -- workout`

### Agents
- [ ] **YT-05** Planning agent (critical path, JT waits on this) (#30) · Tue PM · needs: JT-01
  - **Files:** `src/server/agents/planning/agent.ts`, `prompt.md`, `agent.test.ts`, `index.ts`
  - **Uses:** `PlanningInput`, `PlanningOutput` (`src/contracts/agents.ts`); `AgentDefinition`, `AgentImpl`, `runAgent`
  - **Do:** follow the agent convention in CLAUDE.md. Allowed tools: `get_park_candidates`, `get_forecast`,
    `get_air_quality`, `get_workout_templates`, `check_plan`. Switch `index.ts` from the stub when tests pass.
  - **Done when:** against the Case 1 and Case 2 fixtures the output validates against `PlanningOutput`, cites
    only evidence IDs from the snapshot, and never reports a failed or unknown check as passing.
  - **Test:** `npm test -- planning` (tests use JT's fake runner from JT-01; no Anthropic calls)
- [ ] **YT-06** Workout Adaptation agent (JT waits on this) (#31) · Wed AM · needs: JT-01, YT-04
  - **Files:** `src/server/agents/workout/agent.ts`, `prompt.md`, `agent.test.ts`, `index.ts`
  - **Uses:** `SpecialistInput`, `WorkoutOutput`
  - **Do:** allowed tools: `get_forecast`, `get_air_quality`, `get_workout_templates`, `check_plan`. At most 3
    options; each lists the `park_time_candidate_ids` it was assessed for.
  - **Done when:** on Case 2 it proposes the stationary adaptation, keeps the 10 a.m. heat block as `fail`, and
    lists Park space as unknown.
  - **Test:** `npm test -- workout`

### UI (built against the stub API: `npm run dev`, seeded events `evt-case-01` and `evt-case-02`)
API shapes: `src/contracts/api.ts`. Every fixture-backed value must be labeled as fixture data.
- [ ] **YT-07** Event list (`GET /api/events`): status, current version, finalized version (#32) · Tue
- [ ] **YT-08** Event brief form (`POST /api/events`, `PUT /api/events/:id/brief`) with field validation from `EventBrief` (#33) · Tue
- [ ] **YT-09** Event workspace (`GET /api/events/:id`): status bar, blockers + organizer tasks, plan card, checks (pass/fail/unknown with icons + text), evidence list; actions: Generate, Recheck, Something changed, Request review, Approve vN (#34) · Wed
- [ ] **YT-10** Alternatives comparison (`alternatives` on the current version): ranked combined options, before/after changes, checks, unknowns, recommendation; "Use this option" (`POST .../apply-option`) (#35) · Wed
- [ ] **YT-11** Confirmations, approve and finalize flow (`POST .../confirmations`, `.../approve`, `.../finalize`): each confirmation names its check, park and time (from the organizer task); exact version shown, gate checklist, blocked explanations, no duplicate finalize (#36) · Wed
- [ ] **YT-12** States: loading, data unavailable, stale version (409), fixture banner, save failed (#37) · Thu AM

### Evals
- [ ] **YT-13** Planning + Workout eval cases (`evals/cases/planning/`, `evals/cases/workout/`) (#38) · Thu AM

## Outside the repo
- Deck: Yadan · Script and demo flow: JT
