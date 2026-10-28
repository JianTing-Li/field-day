import { describe, expect, it } from "vitest";
import { EvidenceSnapshot, type AdapterResult, type EventBrief, type EvidenceItem, type ParkCandidate } from "@/contracts";
import { checkPlan } from "@/server/rules/check-plan";
import { buildSnapshot, startTimes } from "./snapshot";

/** A real event date inside the recorded NWS and AirNow fixtures (both retrieved 2026-10-27). */
const brief: EventBrief = {
  title: "Morning bodyweight class",
  date: "2026-10-28",
  time_zone: "America/New_York",
  start_window: { earliest: "08:00", latest: "09:00" },
  duration_minutes: 45,
  group_size: 15,
  allowed_park_ids: ["park-m047", "park-b058"],
  preferred_park_id: null,
  workout_template_id: null,
  equipment_available: [],
  exercise_exclusions: [],
  instructor_limits: { max_temperature_f: null, max_aqi: null, notes: null },
  priorities: [],
};
const args = { event_id: "evt-1", event_version: 1, brief };
const now = (iso: string) => () => new Date(iso);

describe("buildSnapshot in fixture mode (recorded responses)", () => {
  it("returns a valid, fixture-labeled snapshot for the allowed parks only", async () => {
    const snap = await buildSnapshot(args, { mode: "fixture", now: now("2026-10-28T13:00:00Z") });
    expect(() => EvidenceSnapshot.parse(snap)).not.toThrow();
    expect(snap.origin).toBe("fixture");
    for (const e of snap.items) expect(e.origin, e.id).toBe("fixture");
    expect(snap.park_candidates.map((p) => p.id).sort()).toEqual(["park-b058", "park-m047"]);
    expect(new Set(snap.park_time_candidates.map((c) => c.park_id))).toEqual(new Set(["park-m047", "park-b058"]));
  });

  it("gives every evidence item a unique ID even when two parks share a provider record", async () => {
    const snap = await buildSnapshot(args, { mode: "fixture", now: now("2026-10-28T13:00:00Z") });
    const ids = snap.items.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels fixture freshness as assessed at recording time", async () => {
    const snap = await buildSnapshot(args, { mode: "fixture", now: now("2027-01-01T00:00:00Z") });
    const conditions = snap.items.filter((e) => e.metric === "temperature" || e.metric === "aqi");
    expect(conditions.length).toBeGreaterThan(0);
    for (const e of conditions) {
      expect(e.freshness.status).toBe("fresh");
      expect(e.freshness.note).toContain("Fixture data");
    }
  });

  it("keeps the same ID for the same evidence, whenever it is built", async () => {
    const a = await buildSnapshot(args, { mode: "fixture", now: now("2026-10-28T13:00:00Z") });
    const b = await buildSnapshot(args, { mode: "fixture", now: now("2026-10-28T15:00:00Z") });
    expect(b.id).toBe(a.id);
    const v2 = await buildSnapshot({ ...args, event_version: 2 }, { mode: "fixture", now: now("2026-10-28T13:00:00Z") });
    expect(v2.id).not.toBe(a.id);
  });

  it("lets check_plan pass conditions for a candidate the recordings cover", async () => {
    const snap = await buildSnapshot(args, { mode: "fixture", now: now("2026-10-28T13:00:00Z") });
    const cand = snap.park_time_candidates.find((c) => c.park_id === "park-m047" && c.start_time.endsWith("08:00"))!;
    const out = checkPlan({
      plan: {
        park_time_candidate_id: cand.id,
        park_id: cand.park_id,
        start_time: cand.start_time,
        time_zone: "America/New_York",
        duration_minutes: 45,
        workout_template_id: "tpl-bodyweight-45",
        adaptation_ids: [],
        session_outline: [],
      },
      brief,
      snapshot: snap,
      event_version: 1,
    });
    const status = (id: string) => out.checks.find((c) => c.check_id === id)?.status;
    expect(status("freshness.conditions")).toBe("pass");
    expect(status("heat.max_temperature")).toBe("pass");
    expect(status("air_quality.max_aqi")).not.toBe("unknown");
  });
});

/** A minimal fake conditions source: one hourly temperature and one daily AQI forecast per park. */
function fakeConditions(retrievedAt: string) {
  const item = (park_id: string, metric: "temperature" | "aqi", from: string, to: string, value: number): EvidenceItem => ({
    id: `fake-${metric}-${from}`,
    metric,
    evidence_type: "forecast",
    origin: "live",
    source: { name: metric === "aqi" ? "AirNow" : "NWS", url: null, record_id: null },
    value,
    unit: metric === "aqi" ? null : "F",
    category: null,
    pollutant: null,
    missing_reason: null,
    retrieved_at: retrievedAt,
    valid_from: from,
    valid_to: to,
    applies_to: { scope: "forecast_grid", park_id, area_label: null },
    freshness: { status: "unknown", assessed_at: null, note: null },
    limitations: [],
    confirms_check_id: null,
  });
  const forecast = async (req: { park_id: string }): Promise<AdapterResult> => ({
    origin: "live",
    items: [
      item(req.park_id, "temperature", "2026-10-28T08:00", "2026-10-28T09:00", 60),
      item(req.park_id, "temperature", "2026-10-28T09:00", "2026-10-28T10:00", 61),
      item(req.park_id, "temperature", "2026-10-28T10:00", "2026-10-28T11:00", 62),
    ],
    coverage_gaps: [],
  });
  const air = async (req: { park_id: string }): Promise<AdapterResult> => ({
    origin: "live",
    items: [item(req.park_id, "aqi", "2026-10-28T00:00", "2026-10-29T00:00", 40)],
    coverage_gaps: ["AirNow has no observation near the park"],
  });
  return { forecast, air };
}

const parks: ParkCandidate[] = [
  { id: "park-one", name: "One", borough: "Manhattan", acreage: 1, location: { lat: 40.7, lon: -73.9 }, evidence_id: "ev-one", unknowns: [] },
  { id: "park-two", name: "Two", borough: "Brooklyn", acreage: 1, location: null, evidence_id: "ev-two", unknowns: [] },
];
const noParkRecords = async (): Promise<AdapterResult> => ({ origin: "live", items: [], coverage_gaps: [] });

describe("buildSnapshot in live mode (fake adapters)", () => {
  const liveBrief = { ...brief, allowed_park_ids: ["park-one", "park-two", "park-gone"] };
  const build = (retrievedAt: string, builtAt: string) => {
    const f = fakeConditions(retrievedAt);
    return buildSnapshot(
      { ...args, brief: liveBrief },
      {
        mode: "live",
        now: now(builtAt),
        parks,
        fetchForecast: f.forecast,
        fetchAirQuality: f.air,
        fetchParkRecords: noParkRecords,
      },
    );
  };

  it("measures every item's age from the snapshot's creation time", async () => {
    const snap = await build("2026-10-28T11:00:00Z", "2026-10-28T13:00:00Z");
    const temp = snap.items.find((e) => e.metric === "temperature")!;
    const aqi = snap.items.find((e) => e.metric === "aqi")!;
    expect(temp.freshness).toMatchObject({ status: "fresh", assessed_at: "2026-10-28T13:00:00.000Z" });
    expect(aqi.freshness.status).toBe("fresh");

    const later = await build("2026-10-28T11:00:00Z", "2026-10-28T14:30:00Z");
    expect(later.items.find((e) => e.metric === "temperature")!.freshness.status).toBe("stale");
    expect(later.items.find((e) => e.metric === "aqi")!.freshness.status).toBe("fresh");
  });

  it("records gaps for unknown parks, parks without coordinates and adapter gaps", async () => {
    const snap = await build("2026-10-28T11:00:00Z", "2026-10-28T13:00:00Z");
    expect(snap.coverage_gaps).toContain("Park park-gone is not a curated park, so FieldDay has no record for it");
    expect(snap.coverage_gaps.some((g) => g.startsWith("park-two has no reviewed coordinate"))).toBe(true);
    expect(snap.coverage_gaps).toContain("AirNow has no observation near the park");
    expect(snap.park_time_candidates.every((c) => c.park_id === "park-one")).toBe(true);
  });

  it("creates a candidate every 30 minutes across the start window", async () => {
    const snap = await build("2026-10-28T11:00:00Z", "2026-10-28T13:00:00Z");
    expect(snap.park_time_candidates).toEqual([
      { id: "cand-park-one-0800", park_id: "park-one", start_time: "2026-10-28T08:00", end_time: "2026-10-28T08:45" },
      { id: "cand-park-one-0830", park_id: "park-one", start_time: "2026-10-28T08:30", end_time: "2026-10-28T09:15" },
      { id: "cand-park-one-0900", park_id: "park-one", start_time: "2026-10-28T09:00", end_time: "2026-10-28T09:45" },
    ]);
  });

  it("adds template records as reference evidence that never goes stale", async () => {
    const snap = await build("2026-10-28T11:00:00Z", "2026-10-29T13:00:00Z");
    const templates = snap.items.filter((e) => e.metric === "workout_template");
    expect(templates.length).toBe(snap.workout_templates.length);
    for (const t of templates) expect(t.freshness.status).toBe("fresh");
  });

  it("gets a new ID when live data is fetched again", async () => {
    const a = await build("2026-10-28T11:00:00Z", "2026-10-28T13:00:00Z");
    const b = await build("2026-10-28T12:00:00Z", "2026-10-28T13:00:00Z");
    expect(b.id).not.toBe(a.id);
  });
});

describe("startTimes", () => {
  it("includes both ends of the window", () => {
    expect(startTimes({ ...brief, start_window: { earliest: "07:00", latest: "07:30" } })).toEqual([
      "2026-10-28T07:00",
      "2026-10-28T07:30",
    ]);
  });
  it("gives one start when earliest equals latest", () => {
    expect(startTimes({ ...brief, start_window: { earliest: "07:15", latest: "07:15" } })).toEqual(["2026-10-28T07:15"]);
  });
});
