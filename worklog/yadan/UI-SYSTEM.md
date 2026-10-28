# UI system (Claymorphism): Yadan's work log

### 2026-10-28 — UI-SYSTEM: Claymorphism design pass
- **Done:** Applied the Claymorphism UI system to every screen without changing routes, copy or behavior. `globals.css` holds the authoritative `--dp-*` tokens (colors, type sizes, spacing, radii, focus width, motion) and maps them to Tailwind names (`bg-cream`, `text-ink`, `bg-accent`, `bg-mint`, `bg-lavender`, `bg-butter`, `bg-cool`, `rounded-surface`/`tray`/`control`/`disclosure`), plus `clay`, `clay-sm`, `clay-recessed`, `clay-control` (hover raises, press compresses) and `focus-ring` utilities, all lit from the upper left. Instrument Sans via `next/font`. Home: pink hero cushion with a static decorative sculpture (md and up, kept clear of the headline) and the list in a cream tray. Forms: recessed pill fields, cream cushion sections, raised/pressed checkbox cushions. Workspace: cream cushions, alternatives in a lavender decision tray with horizontal shelves (recommended shelf pink; action moves below under 1100px), evidence as a disclosure with a recessed +/−. Status colors: pass mint, unknown butter, fail/errors pink, info blue, finalized ink; meaning always also in icon + words. Also: evidence links now open the collapsed evidence list before jumping. Checked in the browser at desktop and 375px (no sideways scroll).
- **Decisions:** D-UI-1 in `docs/decisions/UI-SYSTEM.md`.
- **Interfaces others depend on:** `ui.tsx` (`Button`, `buttonClass`, `Card`, `Alert`, `Pill`, `fieldClass`, `TONE_BG`).
- **Unfinished / next:** none.
- **Gotchas:** after editing `globals.css`, the dev server kept serving the old stylesheet until `.next/dev` was deleted and the server restarted (the production build was fine).
- **Requests:** none
