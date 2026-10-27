# Evals

- `runner.ts`, `compare.ts` (JT, JT-17): run the 12 fixtures; compare rules-only vs 1 agent vs 4 agents.
- `cases/<agent>/`: per-agent eval cases, owned by that agent's owner.

Write each fixture's expected output before its first run (PRD §3d). Never tune fixtures after
seeing which architecture wins.
