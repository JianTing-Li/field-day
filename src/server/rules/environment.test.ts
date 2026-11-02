import { describe, expect, it } from "vitest";
import { case01 } from "@fixtures/scenarios";
import type { CandidatePlan, EventBrief, EvidenceItem, RuleInput } from "@/contracts";
import { airQualityCheck, effectiveLimit, heatCheck, rainCheck } from "./environment";

const PARK = "park-a";
const plan: CandidatePlan = {
  park_time_candidate_id: "cand-a-0900",
  park_id: PARK,
  start_time: "2026-10-29T09:00",
  time_zone: "America/New_York",
  duration_minutes: 90,
  workout_template_id: "tpl",
  adaptation_ids: [],
  session_outline: [],
};

function ev(over: Partial<EvidenceItem> & Pick<EvidenceItem, "id" | "metric">): EvidenceItem {
  return {
    evidence_type: "forecast",
    origin: "fixture",
    source: { name: "test", url: null, record_id: null },
    value: null,
    unit: null,
    category: null,
    pollutant: null,
    missing_reason: null,
    retrieved_at: "2026-10-28T12:00:00Z",
    valid_from: null,
    valid_to: null,
    applies_to: { scope: "park", park_id: PARK, area_label: null },
    freshness: { status: "fresh", assessed_at: "2026-10-28T12:00:00Z", note: null },
    limitations: [],
    confirms_check_id: null,
    ...over,
    ...(over.value === null && !over.missing_reason ? { missing_reason: "test" } : {}),
  };
}
const temp = (from: string, to: string, value: number, extra: Partial<EvidenceItem> = {}) =>
  ev({ id: `t-${from}`, metric: "temperature", value, unit: "F", valid_from: `2026-10-29T${from}`, valid_to: `2026-10-29T${to}`, ...extra });
const aqi = (value: number | null, extra: Partial<EvidenceItem> = {}) =>
  ev({
    id: `a-${extra.pollutant ?? "pm"}-${value}-${extra.category ?? ""}`,
    metric: "aqi",
    value,
    valid_from: "2026-10-29T00:00",
    valid_to: "2026-10-30T00:00",
    ...extra,
  });

function input(items: EvidenceItem[], limits: Partial<EventBrief["instructor_limits"]> = {}, p: CandidatePlan = plan): RuleInput {
  const snapshot = { ...case01.snapshot("evt", 1), items };
  const brief = { ...case01.brief, instructor_limits: { max_temperature_f: null, max_aqi: null, notes: null, ...limits } };
  return { plan: p, brief, snapshot, event_version: 1 };
}
const fullDay = [temp("09:00", "10:00", 70), temp("10:00", "11:00", 75)];

describe("effectiveLimit", () => {
  it("uses the instructor's limit only when it is stricter", () => {
    expect(effectiveLimit(90, 85)).toEqual({ limit: 85, source: "instructor limit" });
    expect(effectiveLimit(90, 95)).toEqual({ limit: 90, source: "policy limit" });
    expect(effectiveLimit(90, null)).toEqual({ limit: 90, source: "policy limit" });
  });
});

describe("heatCheck", () => {
  it("passes when every hour of the event is at or below 90°F", () => {
    const r = heatCheck(input([temp("09:00", "10:00", 70), temp("10:00", "11:00", 90)]));
    expect(r.status).toBe("pass");
    expect(r.critical).toBe(true);
    expect(r.reason).toContain("unreviewed demo policy");
    expect(r.evidence_ids).toEqual(["t-09:00", "t-10:00"]);
  });

  it("fails when any hour of the event is above the limit, even the last one", () => {
    const r = heatCheck(input([temp("09:00", "10:00", 70), temp("10:00", "11:00", 91)]));
    expect(r.status).toBe("fail");
    expect(r.evidence_ids).toEqual(["t-10:00"]);
  });

  it("applies a stricter instructor limit and ignores a looser one", () => {
    expect(heatCheck(input(fullDay, { max_temperature_f: 72 })).status).toBe("fail");
    expect(heatCheck(input([temp("09:00", "10:00", 92), temp("10:00", "11:00", 70)], { max_temperature_f: 95 })).status).toBe("fail");
  });

  it("is unknown when an hour is missing and nothing known is too hot", () => {
    const r = heatCheck(input([temp("09:00", "10:00", 70)]));
    expect(r.status).toBe("unknown");
    expect(r.reason).toContain("2026-10-29T10:00 to 2026-10-29T10:30");
  });

  it("fails on a known hot hour even when another hour is missing", () => {
    expect(heatCheck(input([temp("09:00", "10:00", 95)])).status).toBe("fail");
  });

  it("ignores stale evidence, observations and other parks", () => {
    const stale = { freshness: { status: "stale" as const, assessed_at: null, note: null } };
    expect(heatCheck(input([temp("09:00", "10:00", 70, stale), temp("10:00", "11:00", 70)])).status).toBe("unknown");
    expect(heatCheck(input([temp("09:00", "10:00", 99, stale), ...fullDay])).status).toBe("pass");
    const obs = { evidence_type: "observation" as const };
    expect(heatCheck(input([temp("09:00", "10:00", 70, obs), temp("10:00", "11:00", 70)])).status).toBe("unknown");
    const other = { applies_to: { scope: "park" as const, park_id: "park-b", area_label: null } };
    expect(heatCheck(input([temp("09:00", "10:00", 99, other), ...fullDay])).status).toBe("pass");
  });

  it("converts Celsius readings", () => {
    expect(heatCheck(input([temp("09:00", "11:00", 33, { unit: "C" })])).status).toBe("fail");
    expect(heatCheck(input([temp("09:00", "11:00", 30, { unit: "°C" })])).status).toBe("pass");
  });

  it("is unknown when the plan has no park, start time or duration", () => {
    expect(heatCheck(input(fullDay, {}, { ...plan, start_time: null })).status).toBe("unknown");
    expect(heatCheck(input(fullDay, {}, { ...plan, duration_minutes: null })).status).toBe("unknown");
  });
});

describe("rainCheck (D-JT24-11)", () => {
  const rain = (from: string, to: string, value: number | null, extra: Partial<EvidenceItem> = {}) =>
    ev({ id: `r-${from}`, metric: "precipitation_probability", value, unit: "percent", valid_from: `2026-10-29T${from}`, valid_to: `2026-10-29T${to}`, ...extra });

  it("passes when every hour of the event is at or under 40%", () => {
    const r = rainCheck(input([rain("09:00", "10:00", 20), rain("10:00", "11:00", 40)]));
    expect(r).toMatchObject({ check_id: "weather.rain", status: "pass", critical: true });
    expect(r.reason).toContain("40%");
  });

  it("fails on any hour over 40%, even when another hour is missing", () => {
    const r = rainCheck(input([rain("09:00", "10:00", 70)]));
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("70% chance of rain");
    expect(r.evidence_ids).toEqual(["r-09:00"]);
  });

  it("is unknown, never pass, when an hour has no forecast", () => {
    expect(rainCheck(input([rain("09:00", "10:00", 10)])).status).toBe("unknown");
    expect(rainCheck(input([rain("09:00", "10:00", null), rain("10:00", "11:00", 10)])).status).toBe("unknown");
  });

  it("ignores observations and stale forecasts", () => {
    const stale = { freshness: { status: "stale" as const, assessed_at: null, note: null } };
    expect(rainCheck(input([rain("09:00", "10:00", 10, { evidence_type: "observation" }), rain("10:00", "11:00", 10)])).status).toBe("unknown");
    expect(rainCheck(input([rain("09:00", "10:00", 10, stale), rain("10:00", "11:00", 10)])).status).toBe("unknown");
  });

  it("does not depend on the workout: a gentler session never lifts a rain block", () => {
    const wet = [rain("09:00", "10:00", 80), rain("10:00", "11:00", 80)];
    expect(rainCheck(input(wet, {}, { ...plan, adaptation_ids: ["adapt-low-impact"] })).status).toBe("fail");
  });
});

describe("airQualityCheck", () => {
  it("passes at exactly AQI 100 and fails at 101", () => {
    expect(airQualityCheck(input([aqi(100)])).status).toBe("pass");
    const r = airQualityCheck(input([aqi(101)]));
    expect(r.status).toBe("fail");
    expect(r.critical).toBe(true);
  });

  it("uses the highest pollutant", () => {
    const r = airQualityCheck(input([aqi(40, { pollutant: "O3" }), aqi(120, { pollutant: "PM2.5" })]));
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("PM2.5 AQI 120");
  });

  it("applies a stricter instructor limit", () => {
    expect(airQualityCheck(input([aqi(80)], { max_aqi: 75 })).status).toBe("fail");
    expect(airQualityCheck(input([aqi(80)], { max_aqi: 150 })).status).toBe("pass");
  });

  it("decides category-only forecasts from the category's range", () => {
    expect(airQualityCheck(input([aqi(null, { category: "Moderate" })])).status).toBe("pass");
    expect(airQualityCheck(input([aqi(null, { category: "Good" })])).status).toBe("pass");
    expect(airQualityCheck(input([aqi(null, { category: "Unhealthy for Sensitive Groups" })])).status).toBe("fail");
    const undecided = airQualityCheck(input([aqi(null, { category: "Moderate" })], { max_aqi: 75 }));
    expect(undecided.status).toBe("unknown");
    expect(undecided.reason).toContain("cannot show");
    expect(airQualityCheck(input([aqi(null, { category: "Unrecognized" })])).status).toBe("unknown");
  });

  it("lets an observation during the event fail the check but never cover it", () => {
    const obs = (value: number) =>
      aqi(value, { id: `obs-${value}`, evidence_type: "observation", valid_from: "2026-10-29T09:00", valid_to: "2026-10-29T10:00" });
    expect(airQualityCheck(input([obs(130)])).status).toBe("fail");
    expect(airQualityCheck(input([obs(30)])).status).toBe("unknown");
  });

  it("is unknown with no AQI evidence, or only stale evidence", () => {
    expect(airQualityCheck(input([])).status).toBe("unknown");
    const stale = { freshness: { status: "stale" as const, assessed_at: null, note: null } };
    expect(airQualityCheck(input([aqi(30, stale)])).status).toBe("unknown");
  });
});
