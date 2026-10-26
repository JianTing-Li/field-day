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
| `AIRNOW_API_KEY` | Live air quality | Server-side only |
| `NWS_USER_AGENT` | Live weather | NWS requires an identifying User-Agent |
| `FIELDDAY_DATA_MODE` | All | `fixture` (default) or `live` |

| Script | What it does |
|---|---|
| `npm run dev` | Run the app |
| `npm test` | Unit and fixture tests (no live API calls) |
| `npm run typecheck` | Generate route types, then type check |
| `npm run lint` | Lint |
| `npm run build` | Production build |

## Architecture
<!-- Owner: JT -->
- **Contracts** (`src/contracts/`): shared Zod schemas and types for every handoff.
- **Harness** (`src/server/`): owns state, builds evidence snapshots, runs `check_plan`, enforces budgets,
  tracks approval, and runs the final save gate. It is application code, not an agent.
- **Agents** (`src/server/agents/`): Planning, Event Logistics, Workout Adaptation, Independent Reviewer.
  They read evidence through read-only tools and return validated JSON.
- **Workflow:** initial plan → conflict check → Logistics + Workout Adaptation in parallel → combination
  checks → independent review → at most 1 revision → organizer approval → final save gate → save.
- **API** (`src/app/api/`): the UI talks to the harness only through the endpoints in `src/contracts/api.ts`.

## Features and status
<!-- Each person edits only their own rows. Status: placeholder · stub · in progress · done -->
| Feature | Owner | Status |
|---|---|---|
| Contracts | Shared | done (v0) |
| Agent runner | JT | stub |
| Agent tools | JT | stub |
| Evidence snapshots, freshness | JT | placeholder |
| Heat / AQI policies | JT | placeholder |
| Logistics rules | JT | placeholder |
| check_plan | JT | done (combining); rules placeholder |
| Orchestrator | JT | stub |
| Lifecycle, approval, save gate | JT | stub |
| Persistence | JT | in-memory stub |
| Event Logistics agent | JT | stub |
| Independent Reviewer agent | JT | stub |
| Planning agent | Yadan | stub |
| Workout Adaptation agent | Yadan | stub |
| Workout rules | Yadan | placeholder |
| Workout templates | Yadan | placeholder |
| UI | Yadan | not started |

## Data sources
<!-- Each person edits only their own sources. Status: proposed · tested · live · fixture-backed -->
| Source | Owner | Status |
|---|---|---|
| NYC Parks Open Data | JT | proposed; placeholder parks in use |
| National Weather Service | Yadan | proposed; fixture-backed |
| AirNow | Yadan | proposed; fixture-backed |
| Workout templates | Yadan | placeholder, not instructor-reviewed |

## UI and screens
<!-- Owner: Yadan -->
Not started.

## Eval results
<!-- Owner: JT -->
Not run yet. Targets are in the PRD §2c; 12 fixtures, defined before testing.

## Limitations and open decisions
<!-- Both: add as you go -->
- All conditions data is fixture-backed until integrations pass their feasibility checks.
- Environmental thresholds are unreviewed demo values and cannot support real-world finalization.
- Approval does not establish venue permission, usable space, or guaranteed conditions.
- Open decisions are tracked in [docs/decisions.md](docs/decisions.md).
