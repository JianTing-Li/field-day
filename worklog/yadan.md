# Work log — Yadan

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
