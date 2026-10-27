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
