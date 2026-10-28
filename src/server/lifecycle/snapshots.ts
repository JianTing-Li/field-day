import { case01, case02 } from "@fixtures/scenarios";
import type { EvidenceSnapshot, FieldDayEvent } from "@/contracts";

/**
 * Evidence snapshot for a new plan version.
 *
 * STUB until the snapshot builder exists (JT-03): Case 2 for the seeded Case 2 event, Case 1
 * for everything else. Fixture snapshot IDs never change, so a recheck in fixture mode always
 * finds the evidence unchanged.
 */
export async function snapshotFor(event: FieldDayEvent, version: number): Promise<EvidenceSnapshot> {
  const scenario = event.id === "evt-case-02" ? case02 : case01;
  return scenario.snapshot(event.id, version);
}
