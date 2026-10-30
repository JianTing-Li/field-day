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

### 2026-10-29 — UX: create-event flow
- **Done:** From a walk-through of creating an event on a phone. (1) Dates: the form rejects past dates ("Pick today or a later date") and notes when a date is beyond the ~7-day forecast range; today's date is read in New York time, in the browser only (`todayInNewYork`, `daysFrom`, `dateHint`). (2) Form: essentials first ("The event", "When can it start?", "Where?", each tagged Required), quick start-window presets (early morning, morning, midday, evening), the favorite-park menu only once 2+ parks are picked, and workout/equipment/safety limits/priorities folded into "More options" (opens itself on an error there or when editing a brief that uses them). Safety limits explain the defaults (90°F, AQI 100). Create stays visible in a sticky bar. The phone page is ~27% shorter. (3) A failed draft with no plan now shows "Couldn't draft a plan" with the reason in plain words and Try again, instead of offering "Draft a plan" forever; the misleading "Your plan below is unchanged" alert only shows when there is a plan. (4) While FieldDay works, the next-step box shows what it's doing, a running timer and how long it usually takes. (5) To-dos are split into "Must do before approving" (clears a blocker for this plan's park/time) and "Good to know"; park IDs in agent text become park names (`withParkNames`). Checked on a phone with headless Playwright; 13 new tests.
- **Decisions:** none
- **Interfaces others depend on:** `toBrief(values, today?)`, `dateHint`, `nextStep(v, gate, lastRun)`, `draftFailure`, `withParkNames`.
- **Unfinished / next:** live progress steps need the harness to save `last_run.progress` during a run.
- **Gotchas:** Next 16 flags `new Date()` during prerender in a client component; read it with `useSyncExternalStore` (server value null).
- **Requests:** JT: (1) in stub mode a new event can't be planned ("No planning fixture for snapshot …"); use the real planner for new events or add a generic stub fallback. (2) The real planner's first plan for a new event had 6 to-dos and 5 concerns in system language (park IDs, "critical check", "unreviewed demo policy"), some not the organizer's job ("Obtain an AQI forecast"); please ask it for at most 3 short, plain to-dos only the organizer can do. (3) Saving `last_run.progress` while a run is going would let the UI show live steps. 

### 2026-10-29 — Welcome page, working create flow, less clutter
- **Done:** (1) Home page now opens with "Welcome to FieldDay / Your outdoor workout planner", one line on what it does, a "Plan a new event" button and 3 steps (Tell us the basics / FieldDay checks it / You approve). (2) New events now get a plan in demo mode: my practice planner falls back to a rules-only planner (`planning/rules-plan.ts`) for events with no sample fixture. It tries every allowed park and time with each workout through `check_plan` and picks the best, and it invents nothing: facts, concerns and to-dos all come from the checks. To-dos are only things the organizer can do (confirm space, confirm the ground), named with the park and time. (3) Confirming no longer loops: the next step skips to-dos whose check already passes, finished to-dos move to a "Done" list, and blockers that are settled disappear. (4) Trimmed: the event list shows only Event / Date / Status, the demo banner is one short sentence, and Sources are collapsed by default. Walked create → draft → confirm space → confirm ground in headless Playwright (ends at "Waiting on weather data", which is right: the recorded air-quality data doesn't cover that date). 11 new tests.
- **Decisions:** none
- **Interfaces others depend on:** `rulesPlan(input, deps)`.
- **Unfinished / next:** none on my side.
- **Gotchas:** demo air-quality data only covers the sample dates, so new events stop at "Waiting on weather data" in demo mode.
- **Requests:** JT: in stub mode, "Find alternatives" on a new event still fails because the logistics/workout/reviewer stubs only have sample fixtures; same fallback idea would fix it.
