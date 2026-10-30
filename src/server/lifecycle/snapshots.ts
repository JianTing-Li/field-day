import { case01, case02, case03, shiftDate } from "@fixtures/scenarios";
import type { EventBrief, EvidenceSnapshot, FieldDayEvent } from "@/contracts";
import { buildSnapshot } from "@/server/evidence/snapshot";
import { toLocalDateTime } from "@/server/time";

/**
 * Evidence snapshots for the lifecycle (owner: JT, task JT-14, D-JT14-1).
 *
 * The seeded demo events (Cases 1, 2 and 3) keep their scenario fixtures, so the demo is the same
 * every time. Every other event gets a snapshot from the JT-03 builder: recorded provider data in
 * fixture mode, live NWS, AirNow and NYC Parks data in live mode.
 *
 * Case 3 is the disruption demo: it is planned on snapshot A, and any refresh (Recheck, or the
 * save gate at finalize) returns the refreshed snapshot B, whose forecast blocks the plan.
 */

export const SCENARIO_EVENTS = {
  "evt-case-01": case01,
  "evt-case-02": case02,
  "evt-case-03": case03,
} as const;

/**
 * How the seeded demo events look to an organizer (D-JT24-14): plain names, and, when the fixture
 * date is already past, a date a few days ahead. The scenario's weather, times and agent answers move
 * with it (shiftDate), so each demo still tells the same story.
 */
const SEED: Record<keyof typeof SCENARIO_EVENTS, { title: string; daysAhead: number }> = {
  "evt-case-01": { title: "Morning bodyweight class", daysAhead: 2 },
  "evt-case-02": { title: "Run club intervals", daysAhead: 3 },
  "evt-case-03": { title: "Early bodyweight class", daysAhead: 4 },
};

/** The brief a demo event is seeded with. */
export function seedBrief(id: keyof typeof SCENARIO_EVENTS, now: Date = new Date()): EventBrief {
  const scenario = SCENARIO_EVENTS[id];
  const today = toLocalDateTime(now).slice(0, 10);
  const ahead = new Date(`${today}T12:00:00Z`);
  ahead.setUTCDate(ahead.getUTCDate() + SEED[id].daysAhead);
  const date = scenario.brief.date < today ? ahead.toISOString().slice(0, 10) : scenario.brief.date;
  return { ...shiftDate(scenario.brief, scenario.brief.date, date), title: SEED[id].title };
}

function scenarioOf(event: FieldDayEvent) {
  return (SCENARIO_EVENTS as Record<string, (typeof SCENARIO_EVENTS)[keyof typeof SCENARIO_EVENTS]>)[event.id] ?? null;
}

/** Above this, a recorded summer hour is a heat-wave hour; in the demo it becomes a rainy one. */
const SUMMER_HEAT_F = 90;

/**
 * The demo events' recorded weather as late fall weather (D-JT24-16). Cases 2 and 3 were recorded in
 * July, so moved to an upcoming date they showed 92°F in November. Warm hours lose 30°F, and every hour
 * that was over 90°F gets an 80% chance of rain instead. The same hours fail, now on rain instead of
 * heat, so each demo keeps its story. The eval cases keep their recorded July weather.
 */
export function inFallWeather(snapshot: EvidenceSnapshot): EvidenceSnapshot {
  const hot = new Set(
    snapshot.items
      .filter((e) => e.metric === "temperature" && typeof e.value === "number" && e.value > SUMMER_HEAT_F)
      .map((e) => `${e.applies_to.park_id}|${e.valid_from}`),
  );
  const items = snapshot.items.map((e) => {
    if (e.metric === "temperature" && typeof e.value === "number" && e.value > 70) return { ...e, value: e.value - 30 };
    if (e.metric === "precipitation_probability" && hot.has(`${e.applies_to.park_id}|${e.valid_from}`)) return { ...e, value: 80 };
    return e;
  });
  return { ...snapshot, items };
}

/** A seeded demo event's recorded snapshot, on the event's date and in fall weather. */
function demoSnapshot(snapshot: EvidenceSnapshot, from: string, to: string): EvidenceSnapshot {
  return inFallWeather(shiftDate(snapshot, from, to));
}

/** The snapshot a new plan is drafted on. */
export async function snapshotFor(event: FieldDayEvent, version: number): Promise<EvidenceSnapshot> {
  const scenario = scenarioOf(event);
  if (scenario) return demoSnapshot(scenario.snapshot(event.id, version), scenario.brief.date, event.brief.date);
  return buildSnapshot({ event_id: event.id, event_version: version, brief: event.brief });
}

/**
 * Freshly gathered evidence for an existing plan (Recheck and the save gate). Built for the same
 * version as an earlier snapshot, unchanged evidence gets the same ID (the ID is a hash of the
 * evidence); live data has new retrieval times, so a live refresh always gets a new ID.
 */
export async function refreshedSnapshot(event: FieldDayEvent, version: number): Promise<EvidenceSnapshot> {
  if (event.id === "evt-case-03") {
    return demoSnapshot(case03.refreshedSnapshot(event.id, version), case03.brief.date, event.brief.date);
  }
  return snapshotFor(event, version);
}
