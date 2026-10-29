import type { CheckId, CheckResult, CheckStatus, EvidenceItem, PolicyArea, RuleFn, RuleInput } from "@/contracts";
import { findUncoveredIntervals, itemsForPark, overlapsWindow, planWindow } from "@/server/evidence/coverage";
import { aqiCategoryRange } from "@/server/evidence/freshness";
import { POLICY_CONFIG } from "./policy-config";

/**
 * Heat and air-quality policies (owner: JT, task JT-04).
 * Limits come from policy-config.ts; an instructor limit in the brief can only make them stricter.
 * Only fresh evidence counts (freshness is assessed by the snapshot builder, JT-03). Missing or
 * stale evidence is unknown, never pass. A known reading over the limit fails even when other
 * hours are missing. Lowering workout intensity never turns a blocked condition into a pass:
 * neither check reads the workout.
 */

function result(
  input: RuleInput,
  check_id: CheckId,
  area: PolicyArea,
  status: CheckStatus,
  reason: string,
  evidence_ids: string[],
): CheckResult {
  return {
    check_id,
    area,
    status,
    critical: true,
    reason: `${reason} (${POLICY_CONFIG.label})`,
    evidence_ids,
    policy_version: POLICY_CONFIG.version,
    assessed: {
      park_id: input.plan.park_id,
      start_time: input.plan.start_time,
      workout_template_id: input.plan.workout_template_id,
    },
  };
}

/** The stricter of the policy limit and the instructor's limit (an instructor can only lower it). */
export function effectiveLimit(policy: number, instructor: number | null): { limit: number; source: string } {
  return instructor !== null && instructor < policy
    ? { limit: instructor, source: "instructor limit" }
    : { limit: policy, source: "policy limit" };
}

/** Fresh items of one metric for the plan's park that overlap the event interval. */
function freshOverlapping(input: RuleInput, metric: EvidenceItem["metric"], startMs: number, endMs: number) {
  return itemsForPark(input.snapshot.items, input.plan.park_id!, metric).filter(
    (e) => e.freshness.status === "fresh" && overlapsWindow(e, startMs, endMs),
  );
}

function uncoveredText(items: EvidenceItem[], startMs: number, endMs: number): string | null {
  const gaps = findUncoveredIntervals(items, startMs, endMs);
  return gaps.length === 0 ? null : gaps.map((g) => `${g.start} to ${g.end}`).join(", ");
}

/** Temperature in °F, or null when the unit is not one we can read. */
function fahrenheit(item: EvidenceItem): number | null {
  if (typeof item.value !== "number") return null;
  const unit = (item.unit ?? "").replace("°", "").trim().toUpperCase();
  if (unit === "F") return item.value;
  if (unit === "C") return item.value * 1.8 + 32;
  return null;
}

export function heatCheck(input: RuleInput): CheckResult {
  const check = (status: CheckStatus, reason: string, ids: string[] = []) =>
    result(input, "heat.max_temperature", "heat", status, reason, ids);
  const window = planWindow(input.plan);
  if (window === null) return check("unknown", "Park, start time or duration is not set");

  const { limit, source } = effectiveLimit(
    POLICY_CONFIG.heat.max_value,
    input.brief.instructor_limits.max_temperature_f,
  );
  const readings = freshOverlapping(input, "temperature", window.startMs, window.endMs)
    .filter((e) => e.evidence_type === "forecast")
    .map((e) => ({ item: e, f: fahrenheit(e) }))
    .filter((r): r is { item: EvidenceItem; f: number } => r.f !== null);

  const hot = readings.filter((r) => r.f > limit);
  if (hot.length > 0) {
    const worst = Math.max(...hot.map((r) => r.f));
    return check(
      "fail",
      `Forecast reaches ${Math.round(worst)}°F during the event, above the ${limit}°F ${source}`,
      hot.map((r) => r.item.id),
    );
  }

  const missing = uncoveredText(readings.map((r) => r.item), window.startMs, window.endMs);
  if (missing !== null) {
    return check("unknown", `No current temperature forecast for ${missing}`, readings.map((r) => r.item.id));
  }
  const highest = Math.max(...readings.map((r) => r.f));
  return check(
    "pass",
    `Highest forecast temperature during the event is ${Math.round(highest)}°F, within the ${limit}°F ${source}`,
    readings.map((r) => r.item.id),
  );
}

type AqiVerdict = "within" | "over" | "undecided";

/** Compares one AQI item with the limit; a category-only item uses its category's AQI range. */
function aqiVerdict(item: EvidenceItem, limit: number): { verdict: AqiVerdict; text: string } | null {
  const what = item.pollutant ? `${item.pollutant} ` : "";
  if (typeof item.value === "number") {
    return { verdict: item.value > limit ? "over" : "within", text: `${what}AQI ${item.value}` };
  }
  const range = aqiCategoryRange(item);
  if (range === null) return null;
  const verdict: AqiVerdict = range.min > limit ? "over" : range.max <= limit ? "within" : "undecided";
  return { verdict, text: `${what}"${item.category}" (AQI ${range.min}–${range.max}, category only)` };
}

export function airQualityCheck(input: RuleInput): CheckResult {
  const check = (status: CheckStatus, reason: string, ids: string[] = []) =>
    result(input, "air_quality.max_aqi", "air_quality", status, reason, ids);
  const window = planWindow(input.plan);
  if (window === null) return check("unknown", "Park, start time or duration is not set");

  const { limit, source } = effectiveLimit(POLICY_CONFIG.air_quality.max_aqi, input.brief.instructor_limits.max_aqi);
  // Observations count only when they measured an hour of the event itself (filtered by overlap);
  // they can show a problem but never cover a future window.
  const readings = freshOverlapping(input, "aqi", window.startMs, window.endMs)
    .filter((e) => e.evidence_type === "forecast" || e.evidence_type === "observation")
    .map((e) => ({ item: e, v: aqiVerdict(e, limit) }))
    .filter((r): r is { item: EvidenceItem; v: { verdict: AqiVerdict; text: string } } => r.v !== null);

  const over = readings.filter((r) => r.v.verdict === "over");
  if (over.length > 0) {
    return check(
      "fail",
      `${over.map((r) => r.v.text).join(", ")} during the event is above the AQI ${limit} ${source}`,
      over.map((r) => r.item.id),
    );
  }

  const covering = readings.filter((r) => r.item.evidence_type === "forecast" && r.v.verdict === "within");
  const missing = uncoveredText(covering.map((r) => r.item), window.startMs, window.endMs);
  if (missing !== null) {
    const undecided = readings.filter((r) => r.v.verdict === "undecided");
    const why = undecided.length > 0
      ? `; ${undecided.map((r) => r.v.text).join(", ")} cannot show it is within AQI ${limit}`
      : "";
    return check("unknown", `No current AQI forecast within the limit for ${missing}${why}`, readings.map((r) => r.item.id));
  }
  return check(
    "pass",
    `${covering.map((r) => r.v.text).join(", ")} during the event, within the AQI ${limit} ${source}`,
    covering.map((r) => r.item.id),
  );
}

export const environmentRules: RuleFn = (input) => [heatCheck(input), airQualityCheck(input)];
