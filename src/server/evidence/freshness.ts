import type { CheckResult, CheckStatus, EvidenceItem, RuleFn, RuleInput } from "@/contracts";
import { AQI_CATEGORY_RANGES, POLICY_CONFIG } from "@/server/rules/policy-config";
import { findUncoveredIntervals, itemsForPark, overlapsWindow, planWindow } from "./coverage";

/**
 * Freshness and coverage (owner: JT, task JT-03): evidence age limits per source and
 * whether evidence covers the full event interval.
 *
 * The snapshot builder assesses each item's age once, against the snapshot's assessment time,
 * and records it in `item.freshness`. Rules read that status and never look at the clock, so the
 * same snapshot always gives the same result. Stale or unassessed evidence is never used.
 */

const HOUR_MS = 3_600_000;

/** Maximum age in hours for this kind of evidence, or null when it has no age limit. */
export function maxAgeHours(item: EvidenceItem): number | null {
  const f = POLICY_CONFIG.freshness;
  if (item.evidence_type === "reference" || item.evidence_type === "organizer_confirmation") return null;
  if (item.metric === "aqi") {
    return item.evidence_type === "forecast" ? f.airnow_forecast_max_age_hours : f.airnow_observation_max_age_hours;
  }
  if (item.metric === "temperature" || item.metric === "precipitation_probability" || item.metric === "wind_speed") {
    return item.evidence_type === "forecast" ? f.nws_forecast_max_age_hours : null;
  }
  return null;
}

/** Freshness of one item at `assessedAt` (an ISO timestamp). */
export function assessFreshness(item: EvidenceItem, assessedAt: string, note: string | null = null): EvidenceItem["freshness"] {
  const limit = maxAgeHours(item);
  if (limit === null) return { status: "fresh", assessed_at: assessedAt, note: note ?? "No age limit for this kind of evidence" };
  const ageMs = Date.parse(assessedAt) - Date.parse(item.retrieved_at);
  if (Number.isNaN(ageMs)) return { status: "unknown", assessed_at: assessedAt, note: "Retrieval time could not be read" };
  const ageHours = Math.max(0, ageMs) / HOUR_MS;
  const age = `${ageHours.toFixed(1)} h old, limit ${limit} h`;
  return ageHours <= limit
    ? { status: "fresh", assessed_at: assessedAt, note: note ? `${note}; ${age}` : age }
    : { status: "stale", assessed_at: assessedAt, note: note ? `${note}; ${age}` : age };
}

/** True when an AQI item has no number but its category alone places it in a known AQI range. */
export function aqiCategoryRange(item: EvidenceItem): { min: number; max: number } | null {
  if (item.metric !== "aqi" || item.category === null) return null;
  return AQI_CATEGORY_RANGES[item.category.trim().toLowerCase()] ?? null;
}

/** A forecast with a usable value (an AQI category counts) that is fresh. Only these cover an event. */
export function isCoveringForecast(item: EvidenceItem): boolean {
  if (item.evidence_type !== "forecast" || item.freshness.status !== "fresh") return false;
  return typeof item.value === "number" || aqiCategoryRange(item) !== null;
}

const REQUIRED = [
  { metric: "temperature" as const, label: "NWS temperature" },
  { metric: "aqi" as const, label: "AirNow AQI" },
];

function result(input: RuleInput, status: CheckStatus, reason: string, evidence_ids: string[]): CheckResult {
  return {
    check_id: "freshness.conditions",
    area: "freshness",
    status,
    critical: true,
    reason,
    evidence_ids,
    policy_version: POLICY_CONFIG.version,
    assessed: {
      park_id: input.plan.park_id,
      start_time: input.plan.start_time,
      workout_template_id: input.plan.workout_template_id,
    },
  };
}

/**
 * freshness.conditions passes only when fresh forecasts cover the whole event interval for both
 * temperature and AQI. Anything missing or stale is unknown: it blocks finalization without
 * proving the event is infeasible.
 */
export const freshnessRules: RuleFn = (input) => {
  const { plan, snapshot } = input;
  const window = planWindow(plan);
  if (window === null) {
    return [result(input, "unknown", "Park, start time or duration is not set, so conditions coverage cannot be checked", [])];
  }

  const problems: string[] = [];
  const usedIds: string[] = [];
  for (const { metric, label } of REQUIRED) {
    const overlapping = itemsForPark(snapshot.items, plan.park_id!, metric).filter((e) =>
      overlapsWindow(e, window.startMs, window.endMs),
    );
    const covering = overlapping.filter(isCoveringForecast);
    const uncovered = findUncoveredIntervals(covering, window.startMs, window.endMs);
    if (uncovered.length === 0) {
      usedIds.push(...covering.map((e) => e.id));
      continue;
    }
    const stale = overlapping.filter((e) => e.evidence_type === "forecast" && e.freshness.status !== "fresh");
    const span = uncovered.map((g) => `${g.start} to ${g.end}`).join(", ");
    problems.push(
      stale.length > 0
        ? `${label} forecast for ${span} is too old or not assessed (${stale.map((e) => e.id).join(", ")})`
        : `No current ${label} forecast covers ${span}`,
    );
  }

  if (problems.length > 0) {
    return [result(input, "unknown", `${problems.join("; ")} (${POLICY_CONFIG.label})`, usedIds)];
  }
  return [
    result(
      input,
      "pass",
      `Current temperature and AQI forecasts cover the full event interval (${POLICY_CONFIG.label})`,
      usedIds,
    ),
  ];
};
