# Evals

- `runner.ts`, `compare.ts` (JT, JT-17): run the 12 fixtures; compare rules-only vs 1 agent vs 4 agents.
- `cases/<agent>/`: per-agent eval cases, owned by that agent's owner.

Write each fixture's expected output before its first run (PRD §3d). Never tune fixtures after
seeing which architecture wins.

## Running

`npm test` checks the runner, the graders and every eval case with stub agents. It never calls the Anthropic API.

A real run calls the API and costs money. It needs `ANTHROPIC_API_KEY` in `.env.local`:

```bash
RUN_EVALS=1 FIELDDAY_AGENTS=real npx vitest run evals/run-evals.test.ts
```

It writes `evals/results/<time>-<mode>.md` (the report) and `.json` (every outcome). Options:

| Variable | What it does |
|---|---|
| `EVAL_ARCH` | Architectures to run, e.g. `rules,multi` (default: all three) |
| `EVAL_CASES` | Case numbers, e.g. `2,4,8` (default: all 12) |
| `EVAL_AGENT_CASES` | `0` skips each agent's own eval cases |
| `EVAL_PRICE_IN`, `EVAL_PRICE_OUT` | US dollars per million input/output tokens, for the cost line |

## What each architecture is

- **rules**: no agents. Every park/time candidate × template × permitted adaptation goes through check_plan, and the
  best one wins: passing over unknown over failing, then the organizer's preferred park and template, then no
  adaptation, then the earliest start. It is not graded on Case 11 (there is no agent output to reject).
- **single**: the Planning agent alone. Its plan is the result.
- **multi**: the full workflow through the orchestrator: Planning, the conflict check, then Logistics + Workout
  Adaptation, combination checks and the Reviewer (at most 1 revision round).

All three get the same brief, snapshot and check_plan, and every result is graded on check_plan's own result for
its final plan, never on an agent's claim. Case 3 is planned on snapshot A and rechecked on the refreshed snapshot B,
as the save gate does at finalization. "Finalize" is graded as allowed only for a draft whose checks all pass.
