# Work log — Yadan

Entries for tasks listed in TASKS.md on 2026-10-28 go under the task's own section at the end of this file,
oldest first. Tasks added later get their own file in `worklog/yadan/`. Never add entries at the end of
the file. Entries above the task sections are earlier history.

<!--
### YYYY-MM-DD — TASK-ID: short title
- **Done:** what changed (files, behavior)
- **Decisions:** anything decided (also add to docs/decisions.md if it's a PRD decision)
- **Interfaces others depend on:** exports, contract fields, API behavior
- **Unfinished / next:** what's left
- **Gotchas:** surprises, workarounds
- **Requests:** changes needed in the other person's area
-->

## 2026-10-27 — YT-00a: add git name to CLAUDE.md
- **Done:** Filled in my `git config user.name` ("Yadan Taino") in the "Who you are working for" table in `CLAUDE.md`; checked off YT-00a in `TASKS.md`.
- **Decisions:** none
- **Interfaces others depend on:** none
- **Unfinished / next:** YT-00c (.env.local + Anthropic key), YT-00d (AirNow key), then YT-01 NWS adapter.
- **Gotchas:** AirNow retired its old web services on 2026-10-01 (`/aq/forecast/latLong/`, `/aq/observation/latLong/current/` and the zip/historical versions now return HTTP 410). Use the replacements: `/aq/forecast/current/` and `/aq/observation/current/ziplatlong/` (both tested with lat/long). Source: docs.airnowapi.org/webservices/retired.
- **Requests:** none

## 2026-10-27 — YT-00b, YT-00c, YT-00d: setup PR review and local env
- **Done:** Reviewed and approved JT's setup PR (#39, merged). Created `.env.local` from `.env.example` and added my own Anthropic API key (checked: the API accepts it). Registered an AirNow key and added it to `.env.local` (checked: a Central Park lookup returns data). `.env.local` is git-ignored.
- **Decisions:** none
- **Interfaces others depend on:** none
- **Unfinished / next:** YT-02 AirNow adapter.
- **Gotchas:** AirNow retired its old web services on 2026-10-01 (`/aq/forecast/latLong/`, `/aq/observation/latLong/current/` and the zip/historical versions now return HTTP 410). Use the replacements: `/aq/forecast/current/` and `/aq/observation/current/ziplatlong/` (both tested with lat/long). Source: docs.airnowapi.org/webservices/retired.
- **Requests:** none

## 2026-10-27 — YT-01: NWS weather adapter
- **Done:** `src/server/data/weather.ts` now does the real NWS lookup (points -> hourly forecast) and turns each hour that overlaps the event into temperature, precipitation-probability and wind-speed evidence. Recorded one real Central Park response and one real HTTP 404 in `fixtures/sources/nws/`. 14 tests in `weather.test.ts`.
- **Decisions:** D-013 (wind ranges use the higher value; fixture mode uses one recording; provider error text is not passed on).
- **Interfaces others depend on:** `fetchForecast` keeps the `FetchForecast` contract. Also exports `fetchForecastWith(req, mode, fetcher)` for tests.
- **Unfinished / next:** live mode is only exercised through recorded responses (tests never call live APIs). YT-02 AirNow next.
- **Gotchas:** NWS hourly periods repeat 01:00 local on the night clocks fall back (Nov 1), so evidence IDs use the UTC start time.
- **Requests:** JT: fixture scenarios that want real weather need event times inside 2026-10-27T13:00 to 2026-11-03T00:00 (park coordinates are still null in `parks.json`).

## 2026-10-27 — YT-02: AirNow adapter
- **Done:** `src/server/data/air.ts` now fetches AirNow's daily forecast and current reading for the park's location and turns them into `aqi` evidence (value, category, pollutant, reporting area). Recorded 5 real responses in `fixtures/sources/airnow/` (forecast, observation, retired-service 410, invalid-key 401, and an error sent as HTTP 200). 15 tests in `air.test.ts`. Also ran one live check with my key: 1 forecast + 2 observations, key absent from the output.
- **Decisions:** D-015 (new AirNow services; observations only for the hour they measured; AQI -1 is missing; 200-with-error is a failure; key never in evidence).
- **Interfaces others depend on:** `fetchAirQuality` keeps the `FetchAirQuality` contract. Also exports `fetchAirQualityWith(req, mode, fetcher)` for tests.
- **Unfinished / next:** YT-03 workout templates.
- **Gotchas:** AirNow's forecast only reaches about 1-2 days ahead (the recording has 2026-10-27 and 10-28, PM2.5 only), so most events further out get a coverage gap. Rate limit is 500 requests per hour per key.
- **Requests:** JT: fixture scenarios that want real AirNow data need an event on 2026-10-27 or 2026-10-28. D-013 and D-014 were already taken on develop when I rebased, so this is D-015.

## 2026-10-28 — YT-03: workout templates
- **Done:** Replaced the 2 placeholders in `src/server/content/workouts.json` with 3 beginner templates: bodyweight circuit, walk-run intervals and resistance band strength. Each has real exercises whose minutes add up to 45, equipment, space layout, surfaces, group size and adaptations. All marked `pending_instructor_review`.
- **Decisions:** none
- **Interfaces others depend on:** kept `tpl-bodyweight-45`, `tpl-run-intervals-45` and `adapt-stationary-circuit`. New IDs: `tpl-band-strength-45` (needs `resistance_band` and `exercise_mat`, so YT-04 can test an equipment fail), `adapt-low-impact`, `adapt-short-30` (-15 min), `adapt-loop-path`, `adapt-band-short-35` (-10 min). `min_area_sq_m` is 100 for the stationary sessions (about 2 m x 2 m per person at the largest group).
- **Unfinished / next:** an instructor still needs to review them. YT-04 workout rules next.
- **Gotchas:** none
- **Requests:** JT: `referenceEvidence()` in `fixtures/scenarios/helpers.ts` still says "Placeholder template; not instructor-reviewed". The second half is still true; you may want to drop "Placeholder".

---

<!-- Task sections (see CLAUDE.md, "Work logs, decisions and task status"). -->

## YT-04 — Workout rules (JT waits on this) (#29)

### 2026-10-28 — YT-04: workout rules
- **Done:** `src/server/rules/workout.ts` now returns real results for `equipment.available`, `duration.fits`, `space_surface.space` and `space_surface.surface`. 27 tests in `workout.test.ts` cover pass, fail and unknown for each check, plus Case 1 and Case 2 behavior.
- **Decisions:** D-023 (what counts as a space or surface confirmation).
- **Interfaces others depend on:** `workoutRules` keeps the `RuleFn` contract. Every check is critical, `policy_version` "workout-rules-v1". An unknown template or an adaptation the template doesn't permit makes all 4 checks unknown.
- **Unfinished / next:** YT-05 Planning agent.
- **Gotchas:** an adaptation can't say which equipment it removes (the contract has no field for it), so adaptations only change layout and length. I swapped YT-03's "no bands" adaptation for a shorter-session one because of this.
- **Requests:** JT: (1) Case 1 has no surface confirmation, so with the real rules `space_surface.surface` comes back `unknown` and the plan is no longer an overall `pass`. Adding a surface confirmation for Park A (e.g. `value: "grass"`) to the Case 1 snapshot fixes it. (2) Case 2's `ev-c2-lane-unusable` uses metric `surface_confirmation` but confirms `space_surface.space`; it works (rules read `confirms_check_id`), but `space_confirmation` plus `category: "running_lane"` would be clearer.

### 2026-10-28 — YT-04: update tests after the Case 1 surface confirmation
- **Done:** JT's #51 added `ev-c1-surface-confirm` (grass) to Case 1, as requested, so Case 1 now passes all four workout checks. Updated 4 tests in `workout.test.ts` that assumed Case 1 had no surface confirmation: the Case 1 test now expects `pass`, and the surface tests drop that item so each test controls its own confirmation. No rule changes.
- **Decisions:** none
- **Interfaces others depend on:** none
- **Unfinished / next:** YT-06 Workout Adaptation agent.
- **Gotchas:** none
- **Requests:** none

## YT-05 — Planning agent (critical path, JT waits on this) (#30)

### 2026-10-28 — YT-05: Planning agent
- **Done:** `src/server/agents/planning/agent.ts` (definition + real `AgentImpl`), extra notes at the end of `prompt.md`, 14 tests in `agent.test.ts` using the fake runner (Case 1, Case 2, a model that lies about checks, made-up evidence IDs, skipped check_plan, stale version, disallowed tool, invalid JSON + repair). One live run on Case 2 with my key: valid output, picked Park B at 8 a.m. (avoiding the 10 a.m. heat and Park A's broken lane), `needs_verification`, cited only snapshot IDs, a blocking concern and an organizer task for every blocker. Cost: 5 model calls, 8 tool calls, ~44k input / ~4.7k output tokens, ~20 s.
- **Decisions:** D-024 (the harness has the last word on the Planning output).
- **Interfaces others depend on:** `planningAgentImpl` and `planningDefinition` from `planning/agent.ts`; `enforceHarnessResults(output, deps)` is exported too.
- **Unfinished / next:** `index.ts` still exports the stub. Switching it made 3 `lifecycle/service.test.ts` tests fail (they expect fixture outputs and have no API key), so the switch needs JT's call. YT-06 next.
- **Gotchas:** the live model's first two attempts failed: copying `rule_checks` back hit the 4096-token output limit, and without the JSON Schema it guessed field names. Both fixed (rule_checks null + schema in the user message). The prompt is read with `readFileSync(process.cwd()/…)`; Vercel's file tracing should include it, but check the first deploy.
- **Requests:** JT: how should the harness choose real vs stub agents? One idea: real agents when `FIELDDAY_DATA_MODE=live`, stubs in fixture mode, so lifecycle tests keep working. Also, the tools stub returns evidence for the whole day, not just the asked window (JT-02), so the live model read 10 a.m. data while looking at 8 a.m.

## YT-06 — Workout Adaptation agent (JT waits on this) (#31)

## YT-07 — Event list (`GET /api/events`): status, current version, finalized version (#32)

### 2026-10-28 — YT-07: Event list
- **Done:** Home page (`src/app/page.tsx`) lists events from `GET /api/events` via `src/components/EventList.tsx`: title, date, status, current version, finalized version, last update. Shared pieces for the next screens: `StatusBadge` (every status is icon + words, never color alone), `format.ts` (status labels, New York dates), `api-client.ts` (`apiGet` checks every response against its contract and turns network/HTTP/shape errors into one result type). Loading skeleton, error with "Try again", empty state. `layout.tsx` got the FieldDay header and a "Demo data" banner whenever `FIELDDAY_DATA_MODE` is fixture. Checked in the browser at desktop and 375px (no sideways scroll). 13 tests for the formatters and API client.
- **Decisions:** none
- **Interfaces others depend on:** `apiGet(path, schema)`, `StatusBadge`, `STATUS` labels in `src/components/`.
- **Unfinished / next:** rows link to `/events/[id]` (YT-09) and the button to `/events/new` (YT-08); both 404 until those land. The app is light-only for now.
- **Gotchas:** dates in the brief are calendar dates, so they're formatted as UTC to stop the day shifting; update times are shown in New York time.
- **Requests:** none

## YT-08 — Event brief form (`POST /api/events`, `PUT /api/events/:id/brief`) with field validation from `EventBrief` (#33)

### 2026-10-28 — YT-08: Event brief form
- **Done:** `/events/new` (create, `POST /api/events`) and `/events/[id]/brief` (edit, `PUT /api/events/:id/brief`) share `src/components/BriefForm.tsx`. Sections: event, start window, parks (checkboxes from `parks.json`, preferred park limited to the ones ticked), workout (templates from `workouts.json`, with an "not reviewed by an instructor yet" note), equipment, instructor limits, priorities. `brief-form.ts` turns the text fields into an `EventBrief` and validates with the contract, with a friendly message per field plus an error summary that links to each field. Editing warns that saving makes a new version and clears approval and confirmations; a 409 `stale_version` gets a plain "this event changed, nothing was saved" message. Added `apiSend` (POST/PUT) to `api-client.ts`. Checked in the browser: empty submit, create, edit to v2, and a stale-version PUT (409). 10 new tests.
- **Decisions:** none
- **Interfaces others depend on:** `BriefForm`, `toBrief`/`fromBrief` in `src/components/brief-form.ts`, `apiSend`.
- **Unfinished / next:** after saving, the page goes to `/events/[id]`, which is YT-09.
- **Gotchas:** Next 16 blocks a page that awaits `params` outside `<Suspense>` ("runtime data during prerendering"), so the edit page reads the ID in a child component inside Suspense. Briefs that use parks outside `parks.json` (the fixture `park-a`/`park-b`) still show them as "not in the park list" so editing doesn't silently drop them.
- **Requests:** none

## YT-09 — Event workspace (`GET /api/events/:id`): status bar, blockers + organizer tasks, plan card, checks (pass/fail/unknown with icons + text), evidence list; actions: Generate, Recheck, Something changed, Request review, Approve vN (#34)

### 2026-10-28 — YT-09: Event workspace
- **Done:** `/events/[id]` renders `src/components/workspace/Workspace.tsx` from `GET /api/events/:id`: title and brief summary, status bar (status, version, snapshot, finalized version, last run), actions (Generate, Recheck, Something changed with a kind + details form, Request review, Approve vN with the reason when it's unavailable), blockers + organizer tasks, plan card (park, start, length, workout and adaptations, outline, facts with links to their evidence), checks (fail, then unknown, then pass; icon + word; advisory checks marked), and the evidence list (type, fixture label, value or missing reason, source, valid period, limitations, coverage gaps). Each action reloads the event afterwards. Shared `ui.tsx` (Button, Card, Alert, Pill) for the later design-system pass. 9 tests in `workspace/logic.test.ts`. Checked in the browser on Case 2 and on a new event (Generate -> v3 ready for approval).
- **Decisions:** none
- **Interfaces others depend on:** `availableActions` in `workspace/logic.ts` mirrors `ACTION_FROM` in `lifecycle/transitions.ts`; if JT changes that table, this needs the same change.
- **Unfinished / next:** YT-10 alternatives, YT-11 confirmations/approve/finalize, YT-12 states.
- **Gotchas:** check names are neutral labels ("Heat limit"), so a fail badge never sits next to a sentence that claims the opposite.
- **Requests:** none

## YT-10 — Alternatives comparison (`alternatives` on the current version): ranked combined options, before/after changes, checks, unknowns, recommendation; "Use this option" (`POST .../apply-option`) (#35)

### 2026-10-28 — YT-10: Alternatives comparison
- **Done:** `workspace/Alternatives.tsx` shows `alternatives` on the current version: reviewer status, unresolved blocking issues, the recommendation (or a plain "no option is recommended yet"), and one card per ranked option with park/time/workout, before -> after changes in words, critical checks that aren't passing, unknowns, tradeoffs, and **Use this option** (`POST .../apply-option`, then reload). A recommended option is outlined and starred; an option that still fails a check says it can't be approved as is. Checked on Case 2: Request review -> 2 options, none recommended; Use option 1 -> v3 at 8 a.m. with the stationary circuit and one blocker (Park A stationary space). 4 new tests.
- **Decisions:** none
- **Interfaces others depend on:** none
- **Unfinished / next:** YT-11 confirmations, approve and finalize.
- **Gotchas:** after applying, the new version carries the review's organizer tasks for both parks (Park B's task too), which reads a little odd on a Park A plan. That comes from the lifecycle/reviewer data, not the UI.
- **Requests:** JT: should `apply_option` keep only the organizer tasks for the chosen option's park/time?

## YT-11 — Confirmations, approve and finalize flow (`POST .../confirmations`, `.../approve`, `.../finalize`): each confirmation names its check, park and time (from the organizer task); exact version shown, gate checklist, blocked explanations, no duplicate finalize (#36)

### 2026-10-28 — YT-11: Confirmations, approve and finalize
- **Done:** `workspace/ApprovalFlow.tsx`. Each organizer task that names a check and a park gets **Confirm**, which opens a form locked to that task's check, park and time (shown, not editable) and posts `POST .../confirmations`; recorded confirmations are listed with who/when. **Approve and finalize** card: step 1 approves the exact version + evidence snapshot (button explains why it's unavailable; a `blocked` response lists the blocking checks); step 2 finalizes with a stable idempotency key per version (`finalize-<event>-v<n>`), shows the 5-item gate checklist, and if the gate fails says "Not finalized" with the failing items. Approve moved out of the Actions card into this card. `apiGet`/`apiSend` now pass on API error `details`. Checked on Case 2 v3: empty confirmation rejected, confirmation -> ready_for_approval with all checks passing, approve, finalize, and a repeat finalize returned the same record. 2 new tests.
- **Decisions:** none
- **Interfaces others depend on:** none
- **Unfinished / next:** YT-12 states.
- **Gotchas:** v3 (from apply-option) still shows the v2 facts ("10 a.m. is 93°F"), which no longer describe the plan. Lifecycle data, not UI.
- **Requests:** JT: should `apply_option` drop or refresh `facts` from the previous version? Also the gate's `current_evidence` and `required_confirmations` are still stubs (JT-09); the UI shows their "Stub:" reasons as they are.

## YT-12 — States: loading, data unavailable, stale version (409), fixture banner, save failed (#37)

### 2026-10-28 — YT-12: States
- **Done:** `src/components/errors.ts` turns every API failure (all `ApiError` codes, plus network and unexpected-shape) into a title + plain explanation, and every one says nothing was saved. Workspace: **stale version (409)** shows "This event changed since you opened it" with **Reload the latest version** (not a retry); **data unavailable** (`upstream_unavailable`) says FieldDay never fills gaps with guesses; **budget_exhausted** says the run hit its limit; a failed refresh keeps showing the last loaded data with a warning; a last run that `failed`/`budget_exhausted` gets a "the last run didn't finish, v<n> is unchanged" note; evidence that can't be loaded gets its own warning; **not found** says the event doesn't exist (no pointless retry). Loading: skeletons on list and workspace, and the busy action is announced (`aria-live`). **Fixture banner** (from YT-07) plus a Fixture pill on the evidence card and each fixture item. **Save failed** on the brief form was done in YT-08. The event list uses the same messages. Checked in the browser: stale approve -> warning -> Reload shows v4; unknown event ID -> "This event doesn't exist". 3 new tests.
- **Decisions:** none
- **Interfaces others depend on:** `describeError(failure, action)` in `src/components/errors.ts`.
- **Unfinished / next:** design-system pass over all screens, then YT-13 evals.
- **Gotchas:** React 19 reveals streamed Suspense content on an animation frame, so in a hidden browser tab (like the automated test pane) pages can sit on their loading skeleton. Not an app bug; any visible tab loads normally.
- **Requests:** none

## YT-13 — Planning + Workout eval cases (`evals/cases/planning/`, `evals/cases/workout/`) (#38)
