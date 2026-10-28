# UI system decisions

### D-UI-1 — Claymorphism UI system
- **Date / owner:** 2026-10-28 · Yadan
- **PRD section:** UI (no PRD-defined style)
- **Decision:** The app uses the Claymorphism UI system: tokens in `src/app/globals.css` (`--dp-*`), Instrument Sans, soft molded surfaces lit from the upper left, pill controls, cream trays and pastel cushions. Status meaning is always icon + words; colors map pass → mint, unknown → butter, fail and errors → pink, info → blue, finalized → ink. One color outside the token table, `--dp-color-danger-ink` (#8a2453), is used only for field error text so it stays legible on cream. Light-only; reduced-motion removes hover/press movement.
- **Status:** in use

### D-UI-2 — Light teal accent instead of pink
- **Date / owner:** 2026-10-28 · Yadan
- **PRD section:** UI (no PRD-defined style)
- **Decision:** The accent (`--dp-color-accent`) is light teal `#8ad9d1` instead of pink: hero, primary buttons, logo, recommended option. Problems get their own soft rose surface (`--dp-color-surface-danger`, `#f6b3cf`, Tailwind `bg-danger`) for fail checks, blocking concerns, error alerts and "No workable option", so a failure never looks like the mint "pass" or the teal brand color. The hero sculpture's ball is cream so it reads on teal. Supersedes the color mapping in D-UI-1 (fail/errors were pink there).
- **Status:** in use
