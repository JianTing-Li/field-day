import { describe, expect, it } from "vitest";
import { case01 } from "@fixtures/scenarios";
import type { EvidenceItem, RuleInput } from "@/contracts";
import { assessFreshness, freshnessRules, isCoveringForecast, maxAgeHours } from "./freshness";

const base = case01.snapshot("evt", 1);
const plan = case01.planningOutput(1).plan;
const conditionIds = (metric: EvidenceItem["metric"]) => base.items.filter((e) => e.metric === metric).map((e) => e.id);

function item(over: Partial<EvidenceItem>): EvidenceItem {
  return { ...base.items.find((e) => e.metric === "temperature")!, ...over };
}
const run = (items: EvidenceItem[]) =>
  freshnessRules({ plan, brief: case01.brief, snapshot: { ...base, items }, event_version: 1 } satisfies RuleInput)[0];

describe("maxAgeHours", () => {
  it("uses each source's limit and no limit for reference records and confirmations", () => {
    expect(maxAgeHours(item({ metric: "temperature", evidence_type: "forecast" }))).toBe(3);
    expect(maxAgeHours(item({ metric: "wind_speed", evidence_type: "forecast" }))).toBe(3);
    expect(maxAgeHours(item({ metric: "aqi", evidence_type: "forecast" }))).toBe(24);
    expect(maxAgeHours(item({ metric: "aqi", evidence_type: "observation" }))).toBe(2);
    expect(maxAgeHours(item({ metric: "park_record", evidence_type: "reference" }))).toBeNull();
    expect(maxAgeHours(item({ metric: "space_confirmation", evidence_type: "organizer_confirmation" }))).toBeNull();
  });
});

describe("assessFreshness", () => {
  const t = item({ metric: "temperature", evidence_type: "forecast", retrieved_at: "2026-10-28T10:00:00Z" });
  it("is fresh at exactly the limit and stale after it", () => {
    expect(assessFreshness(t, "2026-10-28T13:00:00Z").status).toBe("fresh");
    expect(assessFreshness(t, "2026-10-28T13:01:00Z")).toMatchObject({ status: "stale", note: "3.0 h old, limit 3 h" });
  });
  it("treats evidence retrieved after the assessment time as fresh", () => {
    expect(assessFreshness(t, "2026-10-28T09:00:00Z").status).toBe("fresh");
  });
  it("is unknown when the retrieval time cannot be read", () => {
    expect(assessFreshness({ ...t, retrieved_at: "not a time" }, "2026-10-28T13:00:00Z").status).toBe("unknown");
  });
});

describe("isCoveringForecast", () => {
  it("needs a fresh forecast with a value or a known AQI category", () => {
    expect(isCoveringForecast(item({ value: 60 }))).toBe(true);
    expect(isCoveringForecast(item({ value: 60, freshness: { status: "stale", assessed_at: null, note: null } }))).toBe(false);
    expect(isCoveringForecast(item({ value: 60, evidence_type: "observation" }))).toBe(false);
    expect(isCoveringForecast(item({ metric: "aqi", value: null, missing_reason: "x", category: "Good" }))).toBe(true);
    expect(isCoveringForecast(item({ value: null, missing_reason: "x" }))).toBe(false);
  });
});

describe("freshnessRules", () => {
  it("passes Case 1, citing the temperature and AQI forecasts it used", () => {
    const r = run(base.items);
    expect(r.status).toBe("pass");
    expect(r.critical).toBe(true);
    for (const id of [...conditionIds("temperature"), ...conditionIds("aqi")]) expect(r.evidence_ids).toContain(id);
  });

  it("is unknown when AQI is missing", () => {
    const r = run(base.items.filter((e) => e.metric !== "aqi"));
    expect(r.status).toBe("unknown");
    expect(r.reason).toContain("No current AirNow AQI forecast");
  });

  it("is unknown, naming the items, when the covering forecast is stale", () => {
    const items = base.items.map((e) =>
      e.metric === "temperature" ? { ...e, freshness: { status: "stale" as const, assessed_at: null, note: null } } : e,
    );
    const r = run(items);
    expect(r.status).toBe("unknown");
    expect(r.reason).toContain("too old or not assessed");
  });

  it("is unknown when the plan has no start time", () => {
    const r = freshnessRules({ plan: { ...plan, start_time: null }, brief: case01.brief, snapshot: base, event_version: 1 })[0];
    expect(r.status).toBe("unknown");
  });
});
