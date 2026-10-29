# FieldDay

<!-- Owner: shared -->
FieldDay is a multi-agent app that helps NYC organizers plan outdoor fitness events and resolve conflicts
across locations, schedules, and workouts, with independent review and organizer approval.

It turns an event brief into a checked plan (park, time, conditions, workout), shows the evidence and the
unknowns behind every fact, and compares combined alternatives when something conflicts. FieldDay never
books, files permits, or messages anyone.

**Demo:** not deployed yet.

## How we work
<!-- Owner: shared -->
- **Rules for Claude:** [CLAUDE.md](CLAUDE.md) — ownership, PRD rules, done checklist. Claude Code reads it automatically.
- **Tasks:** [TASKS.md](TASKS.md) — one section per person, each task linked to a GitHub issue.
- **Work logs:** [worklog/](worklog/) — read the other person's log before touching or depending on their work.
- **Decisions:** [docs/decisions.md](docs/decisions.md).
- **Flow:** branch from `develop` → one task per PR → the other person reviews → merge. `develop` → `main` once tested.

**First time setup (Yadan):** install Node 24 (`nvm use` reads `.nvmrc`), run the commands below, add your
`git config user.name` to CLAUDE.md (YT-00a), then start Claude Code in this folder and ask for your next task.

## Getting started
<!-- Owner: JT -->
Requires Node 24 (see `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # then fill in your own keys
npm run dev                  # http://localhost:3000
```

| Variable | Needed for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Running real agents | Server-side only; each developer uses their own key |
| `ANTHROPIC_MODEL` | Running real agents | Defaults to `claude-haiku-5-5` |
| `AIRNOW_API_KEY` | Live air quality | Server-side only |
| `NWS_USER_AGENT` | Live weather | NWS requires an identifying User-Agent |
| `FIELDDAY_DATA_MODE` | All | `fixture` (default) or `live` |
| `FIELDDAY_AGENTS` | Running real agents | `stub` (default: fixture outputs, no API calls) or `real`; an agent with no real version yet stays a stub, and each run reports which ran |
| `DATABASE_URL` | Saving to the hosted database | Neon Postgres (D-JT21-1); set by Vercel's Neon integration. Without it the app uses an in-memory store that empties on restart |

| Script | What it does |
|---|---|
| `npm run dev` | Run the app |
| `npm test` | Unit and fixture tests (no live API calls) |
| `npm run typecheck` | Generate route types, then type check |
| `npm run lint` | Lint |
| `npm run build` | Production build |
| `npm run db:reset` | Empty the hosted database after typing `RESET` (also a manual "Reset database" GitHub Action) |

### Deployed demo
https://field-day-sepia.vercel.app deploys from `develop` on Vercel (team Calm Forge, region `iad1`), with real agents
on shared demo credits. `FIELDDAY_DATA_MODE` on Vercel picks recorded or live weather and air quality (live since
2026-10-29); the seeded demo events always use their recorded scenarios.

- **Rate limit (D-JT19-1, D-JT24-10):** with `FIELDDAY_AGENTS=real`, Draft a plan, Report a problem and Find
  alternatives allow 18 agent runs per visitor per hour and 180 per day in total. A malformed request is refused before
  it counts. Creating events has its own limit in every mode: 20 per visitor per hour, 300 a day. Over a limit, the
  API answers 429 `rate_limited` and nothing runs. Counts are kept in memory per server instance.
- **Spend limit:** set a monthly spend limit on the Anthropic workspace that owns the deployed key. It is the backstop
  for anything the in-memory rate limit misses.
- **Demo labeling (D-JT19-2, D-JT24-2):** the "Demo" banner shows in every mode: recorded data, or live data with
  safety limits and workouts not yet reviewed, and (with real agents) that Claude drafts plans on shared demo credits.
  A locked-in plan says it's for the demo only while anything it rests on is unreviewed.
- **Reset:** GitHub → Actions → "Reset database" → Run workflow → type `RESET`. It needs the `DATABASE_URL`
  repository secret (Settings → Secrets and variables → Actions). The next page view seeds the demo events again with
  the stub agents, so it costs no credits.
- **Time limit (D-JT19-3):** every event route sets `maxDuration = 300`; the run budget stops agents at 240 s.

## Architecture
<!-- Owner: JT -->
- **Contracts** (`src/contracts/`): shared Zod schemas and types for every handoff.
- **Harness** (`src/server/`): owns state, builds evidence snapshots, runs `check_plan`, enforces budgets,
  tracks approval, and runs the final save gate. It is application code, not an agent.
- **Agents** (`src/server/agents/`): Planning, Event Logistics, Workout Adaptation, Independent Reviewer.
  They read evidence through read-only tools and return validated JSON.
- **Workflow:** initial plan → conflict check → Logistics + Workout Adaptation in parallel → combination
  checks → independent review → at most 1 revision → organizer approval → final save gate → save. Draft a plan runs
  all of it in one request when the draft fails a critical check (D-JT24-4); Report a problem and Find alternatives
  run the review on the current plan.
- **Checks:** every version's checks come from the harness's `check_plan`, never from an agent (D-JT24-3). An
  organizer confirmation resolves only space, surface or permit at one park and time (D-JT24-1).
- **API** (`src/app/api/`): the UI talks to the harness only through the endpoints in `src/contracts/api.ts`.

## Features and status
<!-- Each person edits only their own rows. Status: placeholder · stub · in progress · done -->
| Feature | Owner | Status |
|---|---|---|
| Contracts | Shared | done (v0) |
| Agent runner | JT | done |
| Agent tools | JT | done |
| Evidence snapshots, freshness | JT | done |
| Heat / AQI policies | JT | done (unreviewed demo policy) |
| Logistics rules | JT | done |
| check_plan | JT | done (all rules real, no placeholders) |
| Orchestrator | JT | done; `FIELDDAY_AGENTS=real` picks real agents; API routes not on it yet (JT-14) |
| Lifecycle, approval | JT | done (states, versions, approval invalidation, stale-result rejection; space and surface confirmations tied to the workout layout, JT-22) |
| Final save gate | JT | stub (version, approval, hard constraints only) |
| Persistence | JT | in-memory stub |
| Event Logistics agent | JT | done; the orchestrator and evals use it with `FIELDDAY_AGENTS=real`; API routes not on it yet (JT-14) |
| Independent Reviewer agent | JT | done; the orchestrator and evals use it with `FIELDDAY_AGENTS=real`; API routes not on it yet (JT-14) |
| Planning agent | Yadan | built and tested (one live run); app still uses the stub until JT picks how to switch |
| Workout agent | Yadan | built and tested (one live run); app still uses the stub until JT picks how to switch |
| Workout rules | Yadan | done (equipment, duration, space, surface) |
| Workout templates | Yadan | 3 beginner templates, pending instructor review |
| UI | Yadan | done: event list, brief form, workspace, alternatives, confirm/approve/finalize, states; Claymorphism UI system |

## Data sources
<!-- Each person edits only their own sources. Status: proposed · tested · live · fixture-backed -->
| Source | Owner | Status |
|---|---|---|
| NYC Parks Open Data | JT | in use: 10 curated parks (D-020); eval scenarios use fixture parks; live mode untested in CI |
| National Weather Service | Yadan | tested; fixture-backed (live mode needs `NWS_USER_AGENT`) |
| AirNow | Yadan | tested live; fixture-backed (live mode needs `AIRNOW_API_KEY`) |
| Workout templates | Yadan | 3 beginner templates, pending instructor review |

## UI and screens
<!-- Owner: Yadan -->
Not started.

## Eval results
<!-- Owner: JT -->
First real run: 2026-10-28, all four agents real, `claude-haiku-5-5`, fixture inputs (not live data or
real-world results). Full report: [`evals/results/2026-10-28T22-38-08-324Z-real.md`](evals/results/2026-10-28T22-38-08-324Z-real.md).
Targets are in the PRD §2c. The 12 cases' expected outcomes (`expected` in each `fixtures/scenarios/` file) were
written before any agent run and were not changed after it; cases 4–8 are the 5 known-feasible conflicts.
How to run it: [`evals/README.md`](evals/README.md). The evals grade the full workflow (`runWorkflow`), which the app
now runs on Draft a plan too (D-JT24-4). This run predates JT-24's shorter specialist and Reviewer answers
(D-JT24-3); rerun before quoting latency or tokens.

| Metric (PRD §2c) | Target | Rules only | Planning alone | 4 agents |
|---|---|---|---|---|
| Correct outcomes | ≥ 11 of 12 | 11 of 11 | 8 of 12 | 8 of 12 |
| Conflicts resolved (cases 4–8) | ≥ 4 of 5 | 5 of 5 | 3 of 5 | 5 of 5 |
| Approvable plans breaking a hard rule | 0 | 0 | 0 | 0 |
| Cited evidence not in the snapshot | 0 | 0 | 0 | 0 |
| Missing-data cases shown as passing | 0 | 0 | 0 | 0 |
| Model requests / tool calls (all 12 cases) | — | 0 / 0 | 44 / 71 | 77 / 129 |
| Tokens in / out (all 12 cases) | — | 0 / 0 | 350k / 40k | 852k / 137k |
| Total latency (all 12 cases) | — | 0.0 s | 172 s | 439 s |

**Multi-agent value** (target: ≥ 2 more conflicts resolved than Planning alone, at ≤ 2× its latency): the 4-agent
workflow resolved 2 more (Cases 6 and 8, the workout substitution and the combined revision), at 2.6× the latency.
The conflict target is met; the latency target is not. Each agent passed all of its own eval cases (Planning 5/5,
Workout 5/5, Logistics 6/6, Reviewer 6/6).

What the failures mean:
- **4 agents, Cases 4, 5 and 7 ("specialists did not run"):** the final plan is correct, but Planning found the time,
  venue or session change on its own, so its plan had no failed check and the harness never triggered the
  specialists. The case expected them to run, so these count as wrong.
- **Case 11, both agent architectures:** the case tests that the harness rejects malformed output or an unknown
  candidate/evidence ID. The real model returned valid output, so there was nothing to reject. The rejection
  itself is covered by the stub-mode tests (`evals/runner.test.ts`, `src/server/orchestrator`), not by this run.
- **Planning alone, Cases 2, 6 and 8:** it kept a plan with a failed critical check (space, equipment) where the
  4-agent workflow reached the expected result. That is the gap the specialists exist for.
- **Rules only scores highest** because the fixtures are small enough to try every combination. It cannot explain a
  choice or handle anything outside the fixed rules, but it is the baseline the agents have to beat.

An earlier run the same day scored 6/12 (Planning alone) and 3/12 (4 agents) because of two harness problems, fixed
in JT-23: Logistics and Reviewer answers were cut off at 4,096 output tokens, and an agent's `needs_verification`
blocked plans that passed every check (D-JT23-1, D-JT23-2).

## Limitations and open decisions
<!-- Both: add as you go -->
- Conditions data is recorded (fixture mode, covering Oct 27–Nov 2, 2026 for weather and Oct 27–28 for air quality) or
  live, set by `FIELDDAY_DATA_MODE`. Live forecasts reach about 7 days ahead for weather and 1–2 days for air quality,
  so an event further out stays "waiting on weather data" until then (D-JT24-8).
- Sessions run 30, 35 or 45 minutes and use one of 3 workouts, all pending instructor review; other activities need a
  reviewed workout first (D-JT24-7).
- Environmental thresholds are unreviewed demo values and cannot support real-world finalization.
  The heat check uses forecast air temperature only; humidity is not collected, so it is not a heat index.
- In fixture mode, recorded evidence is assessed for freshness at its recording time, not against the current time.
- Approval does not establish venue permission, usable space, or guaranteed conditions.
- The hosted app has no sign-in, so anyone with the link can create, approve and finalize events (D-JT21-1).
- Open decisions are tracked in [docs/decisions.md](docs/decisions.md).
