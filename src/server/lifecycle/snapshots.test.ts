import { describe, expect, it } from "vitest";
import { case01, case02, case03 } from "@fixtures/scenarios";
import type { EventBrief, FieldDayEvent } from "@/contracts";
import { refreshedSnapshot, snapshotFor } from "./snapshots";

const ev = (id: string, brief: EventBrief) => ({ id, brief }) as FieldDayEvent;

describe("snapshots (JT-14, D-JT14-1)", () => {
  it("keeps the scenario fixtures for the seeded demo events", async () => {
    expect((await snapshotFor(ev("evt-case-01", case01.brief), 2)).id).toBe(case01.SNAPSHOT_ID);
    expect((await snapshotFor(ev("evt-case-02", case02.brief), 2)).id).toBe(case02.SNAPSHOT_ID);
    expect((await refreshedSnapshot(ev("evt-case-01", case01.brief), 3)).id).toBe(case01.SNAPSHOT_ID);
  });

  it("Case 3 is planned on snapshot A and refreshed to snapshot B", async () => {
    const e = ev("evt-case-03", case03.brief);
    expect((await snapshotFor(e, 2)).id).toBe(case03.SNAPSHOT_ID);
    expect((await refreshedSnapshot(e, 2)).id).toBe(case03.REFRESHED_SNAPSHOT_ID);
  });

  it("builds every other event's snapshot from the brief with the JT-03 builder", async () => {
    const brief: EventBrief = { ...case01.brief, allowed_park_ids: ["park-m047"], preferred_park_id: "park-m047" };
    const s = await snapshotFor(ev("evt-new", brief), 2);
    expect(s.id).toMatch(/^snap-evt-new-v2-/);
    expect(s.origin).toBe("fixture");
    expect(s.park_candidates.map((p) => p.id)).toEqual(["park-m047"]);
  });

  it("gives unchanged built evidence the same ID when refreshed for the same version", async () => {
    const brief: EventBrief = { ...case01.brief, allowed_park_ids: ["park-m047"], preferred_park_id: "park-m047" };
    const e = ev("evt-new", brief);
    expect((await refreshedSnapshot(e, 2)).id).toBe((await snapshotFor(e, 2)).id);
  });
});
