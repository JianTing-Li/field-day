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

## 2026-10-27 — JT-07: Lifecycle
- **Done:** Replaced the stub state handling in `src/server/lifecycle/service.ts`. New: `transitions.ts`
  (transition table, `assertCanStart`, `transition`, `deriveStatus`), `confirmations.ts` (scope matching,
  `applyConfirmations`), `snapshots.ts` (fixture snapshot per version, stub until JT-03). Every save checks
  the stored event has not changed since the request loaded it. Tests for each transition, invalid transitions,
  approval invalidation, stale version/snapshot/result rejection, confirmation scope and finalize idempotency,
  plus PRD Case 3.
- **Decisions:** D-013 (transitions, approval invalidation, confirmation carry-forward), D-014 (finalize idempotency).
- **Interfaces others depend on:** exported service functions and API shapes unchanged. Additive contract
  changes in `src/contracts/event.ts`: `PlanVersion.source` gains `"recheck"`; `FinalizedRecord` gains optional
  `idempotency_key`. New API behavior for the UI: invalid actions return 400 `invalid_request` (e.g. confirming
  a finalized version), stale requests 409 `stale_version`, approving `needs_verification` 409 `blocked`.
  A confirmation or reported change on an approved version clears approval; request review does not.
  A brief edit clears `event.confirmations`.
- **Unfinished / next:** JT-09 full save gate (freshness, required confirmations). JT-03 snapshot builder:
  `snapshotFor` must return a new snapshot ID whenever evidence changes, so recheck revalidates. JT-08 should
  make the stale-write check atomic (compare-and-swap on `updated_at`) in the hosted store.
- **Gotchas:** fixture snapshot IDs never change (agent stubs look fixtures up by ID), so in fixture mode
  recheck always reports "evidence unchanged". Tests swap in a new snapshot ID with `vi.mock`. A recheck with
  a new snapshot revalidates with `checkPlan`, whose placeholder rules return unknown → `needs_verification`.
- **Requests:** none
