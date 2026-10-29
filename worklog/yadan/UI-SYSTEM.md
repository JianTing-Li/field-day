# UI system (Claymorphism): Yadan's work log

### 2026-10-28 — UI-SYSTEM: Claymorphism design pass
- **Done:** Applied the Claymorphism UI system to every screen without changing routes, copy or behavior. `globals.css` holds the authoritative `--dp-*` tokens (colors, type sizes, spacing, radii, focus width, motion) and maps them to Tailwind names (`bg-cream`, `text-ink`, `bg-accent`, `bg-mint`, `bg-lavender`, `bg-butter`, `bg-cool`, `rounded-surface`/`tray`/`control`/`disclosure`), plus `clay`, `clay-sm`, `clay-recessed`, `clay-control` (hover raises, press compresses) and `focus-ring` utilities, all lit from the upper left. Instrument Sans via `next/font`. Home: pink hero cushion with a static decorative sculpture (md and up, kept clear of the headline) and the list in a cream tray. Forms: recessed pill fields, cream cushion sections, raised/pressed checkbox cushions. Workspace: cream cushions, alternatives in a lavender decision tray with horizontal shelves (recommended shelf pink; action moves below under 1100px), evidence as a disclosure with a recessed +/−. Status colors: pass mint, unknown butter, fail/errors pink, info blue, finalized ink; meaning always also in icon + words. Also: evidence links now open the collapsed evidence list before jumping. Checked in the browser at desktop and 375px (no sideways scroll).
- **Decisions:** D-UI-1 in `docs/decisions/UI-SYSTEM.md`.
- **Interfaces others depend on:** `ui.tsx` (`Button`, `buttonClass`, `Card`, `Alert`, `Pill`, `fieldClass`, `TONE_BG`).
- **Unfinished / next:** none.
- **Gotchas:** after editing `globals.css`, the dev server kept serving the old stylesheet until `.next/dev` was deleted and the server restarted (the production build was fine).
- **Requests:** none

### 2026-10-28 — UI-SYSTEM: light teal accent
- **Done:** Swapped the pink accent for light teal (`#8ad9d1`). Fail checks, blocking concerns and error alerts moved to a separate soft rose (`bg-danger`) so problems stay distinct from mint passes and the teal brand. Checked home and the Case 2 workspace at 1280px and 762px.
- **Decisions:** D-UI-2.
- **Interfaces others depend on:** new Tailwind color `danger` (and `TONE_BG.danger` now uses it).
- **Unfinished / next:** none.
- **Gotchas:** the dev server again kept the old stylesheet until `.next/dev` was deleted.
- **Requests:** none

### 2026-10-29 — UI-SYSTEM: polish pass (6 fixes)
- **Done:** (1) Approve note pointed to blockers "below"; now "listed above". (2) A one-time start window says "starts at 9:00 AM", not "between 09:00 and 09:00". (3) Event header times use AM/PM like the rest of the app (`formatClock`, `startWindowText` in `format.ts`). (4) Event list gives the name column more room and wraps to 2 lines instead of cutting names off. (5) "What's blocking this plan" now comes before Actions, so phones see it first. (6) On phones, "Finalized: Not finalized" is hidden until something is finalized. Checked with headless Playwright at 390px and 1280px; 4 new tests.
- **Decisions:** none
- **Interfaces others depend on:** `formatClock`, `startWindowText`.
- **Unfinished / next:** none
- **Gotchas:** none
- **Requests:** none

### 2026-10-29 — UX: next step, plan first, plain words
- **Done:** (1) New top card on the event page (`workspace/NextStep.tsx`): status, the plan in one line (park · day · time · workout · people) and a **Next step** with one primary action, decided by `nextStep()` in `workspace/next-step.ts` (draft a plan / find alternatives / see alternatives / confirm the first task for the current plan / check the latest weather / approve / lock it in / edit the brief). On phones the same action sits in a bar fixed to the bottom. If a lock-in attempt fails, the next step says "Can't lock it in yet" and why, instead of offering the same button again. The old Actions card is now "More actions". (2) The plan summary leads the page. (3) Plain words: version/snapshot/run details moved into a collapsed "Technical details"; evidence IDs replaced by source names ("NWS forecast", "Your confirmation"); buttons renamed (Draft a plan, Check the latest weather, Report a problem, Find alternatives, Approve plan, Lock it in); "Evidence" is now "Sources", "Checks" is "Safety checks", "Plan" is "Plan details". Walked Case 2 end to end by following only the next-step button in headless Playwright, and checked 390px. 9 new tests.
- **Decisions:** none
- **Interfaces others depend on:** `nextStep(version, gate)`, `PlanSummary`, `TechnicalDetails`, `sourceNames`.
- **Unfinished / next:** progress steps while agents run, yes/no confirmations (UX review items 4 and 5).
- **Gotchas:** none
- **Requests:** JT: Case 2 can't be locked in after applying option 1: the gate needs the Park A ground surface confirmed, but the version has no organizer task for it (only "space" at Park A, and space + surface at Park B), so the organizer has no way to confirm it.
