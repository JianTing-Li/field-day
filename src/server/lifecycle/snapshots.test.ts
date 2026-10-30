import { describe, expect, it } from "vitest";
import { case01, case02, case03 } from "@fixtures/scenarios";
import type { EventBrief, FieldDayEvent } from "@/contracts";
import { inFallWeather, refreshedSnapshot, snapshotFor } from "./snapshots";

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

  it("shows the demo events' July recordings as fall weather: heat-wave hours become rainy hours (D-JT24-16)", async () => {
    const value = (s: Awaited<ReturnType<typeof snapshotFor>>, metric: string, time: string) =>
      s.items.find((e) => e.metric === metric && e.applies_to.park_id === "park-a" && e.valid_from?.endsWith(time))?.value;
    const s = await snapshotFor(ev("evt-case-02", case02.brief), 2);
    expect(value(s, "temperature", "T10:00")).toBe(63);
    expect(value(s, "precipitation_probability", "T10:00")).toBe(80);
    expect(value(s, "temperature", "T08:00")).toBe(52);
    expect(value(s, "precipitation_probability", "T08:00")).toBe(10);
    const b = await refreshedSnapshot(ev("evt-case-03", case03.brief), 2);
    expect(b.items.every((e) => e.metric !== "temperature" || Number(e.value) < 90)).toBe(true);
    // The eval cases keep their recorded weather.
    expect(case02.snapshot("evt-case-02", 2).items.some((e) => e.metric === "temperature" && e.value === 93)).toBe(true);
  });

  it("leaves cool hours and other evidence alone in fall weather", () => {
    const s = case01.snapshot("evt-case-01", 1);
    expect(inFallWeather(s).items).toEqual(s.items);
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
