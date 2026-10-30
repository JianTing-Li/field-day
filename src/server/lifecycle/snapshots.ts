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

/** The snapshot a new plan is drafted on. */
export async function snapshotFor(event: FieldDayEvent, version: number): Promise<EvidenceSnapshot> {
  const scenario = scenarioOf(event);
  if (scenario) return shiftDate(scenario.snapshot(event.id, version), scenario.brief.date, event.brief.date);
  return buildSnapshot({ event_id: event.id, event_version: version, brief: event.brief });
}

/**
 * Freshly gathered evidence for an existing plan (Recheck and the save gate). Built for the same
 * version as an earlier snapshot, unchanged evidence gets the same ID (the ID is a hash of the
 * evidence); live data has new retrieval times, so a live refresh always gets a new ID.
 */
export async function refreshedSnapshot(event: FieldDayEvent, version: number): Promise<EvidenceSnapshot> {
  if (event.id === "evt-case-03") {
    return shiftDate(case03.refreshedSnapshot(event.id, version), case03.brief.date, event.brief.date);
  }
  return snapshotFor(event, version);
}
