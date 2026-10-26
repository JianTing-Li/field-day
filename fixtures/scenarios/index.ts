import * as case01 from "./case-01-normal";
import * as case02 from "./case-02-conflict";

/**
 * Scenario registry. Stubs look up the scenario whose snapshot ID matches the run.
 * Cases 3–12 are added here as they are written (JT-16).
 */
export const scenarios = {
  [case01.SNAPSHOT_ID]: case01,
  [case02.SNAPSHOT_ID]: case02,
} as const;

export type ScenarioId = keyof typeof scenarios;

export { case01, case02 };

/** Returns the scenario for a snapshot ID, or null if no fixture exists for it. */
export function scenarioForSnapshot(snapshotId: string) {
  return (scenarios as Record<string, (typeof scenarios)[ScenarioId]>)[snapshotId] ?? null;
}
