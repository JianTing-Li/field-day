import * as raw01 from "./case-01-normal";
import * as raw02 from "./case-02-conflict";
import * as raw03 from "./case-03-outdated-approval";
import * as raw04 from "./case-04-time-change";
import * as raw05 from "./case-05-venue-change";
import * as raw06 from "./case-06-equipment-substitution";
import * as raw07 from "./case-07-duration-adjustment";
import * as raw08 from "./case-08-combined-revision";
import * as raw09 from "./case-09-no-feasible-option";
import * as raw10 from "./case-10-outside-forecast";
import * as raw11 from "./case-11-malformed-output";
import * as raw12 from "./case-12-untrusted-text";
import { withDryForecasts } from "./helpers";

type HasSnapshot = { snapshot: (event_id: string, event_version: number) => import("@/contracts").EvidenceSnapshot };

/** The case with a dry-weather rain forecast next to every recorded temperature hour (D-JT24-11). */
function dry<C extends HasSnapshot>(c: C): C {
  return { ...c, snapshot: (event_id: string, event_version: number) => withDryForecasts(c.snapshot(event_id, event_version)) };
}

const case01 = dry(raw01);
const case02 = dry(raw02);
const case03 = {
  ...dry(raw03),
  refreshedSnapshot: (event_id: string, event_version: number) => withDryForecasts(raw03.refreshedSnapshot(event_id, event_version)),
  refreshed: dry(raw03.refreshed),
};
const case04 = dry(raw04);
const case05 = dry(raw05);
const case06 = dry(raw06);
const case07 = dry(raw07);
const case08 = dry(raw08);
const case09 = dry(raw09);
const case10 = dry(raw10);
const case11 = dry(raw11);
const case12 = dry(raw12);

/**
 * Scenario registry. Stubs look up the scenario whose snapshot ID matches the run.
 * Case 3 has two snapshots: A (approval time) and B (refreshed during final validation).
 */
export const scenarios = {
  [case01.SNAPSHOT_ID]: case01,
  [case02.SNAPSHOT_ID]: case02,
  [case03.SNAPSHOT_ID]: case03,
  [case03.REFRESHED_SNAPSHOT_ID]: case03.refreshed,
  [case04.SNAPSHOT_ID]: case04,
  [case05.SNAPSHOT_ID]: case05,
  [case06.SNAPSHOT_ID]: case06,
  [case07.SNAPSHOT_ID]: case07,
  [case08.SNAPSHOT_ID]: case08,
  [case09.SNAPSHOT_ID]: case09,
  [case10.SNAPSHOT_ID]: case10,
  [case11.SNAPSHOT_ID]: case11,
  [case12.SNAPSHOT_ID]: case12,
} as const;

export type ScenarioId = keyof typeof scenarios;

export { case01, case02, case03, case04, case05, case06, case07, case08, case09, case10, case11, case12 };
export type { ExpectedOutcome } from "./expected";

/** The 12 PRD eval cases in order, with each case's expected outcome. Case 3 is graded on snapshot B. */
export const evalCases = [
  case01,
  case02,
  case03.refreshed,
  case04,
  case05,
  case06,
  case07,
  case08,
  case09,
  case10,
  case11,
  case12,
] as const;

/** Returns the scenario for a snapshot ID, or null if no fixture exists for it. */
export function scenarioForSnapshot(snapshotId: string) {
  return (scenarios as Record<string, (typeof scenarios)[ScenarioId]>)[snapshotId] ?? null;
}
