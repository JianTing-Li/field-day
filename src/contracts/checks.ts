import { z } from "zod";
import { CheckId, CheckStatus, Id, LocalDateTime } from "./common";
import type { EventBrief } from "./brief";
import type { EvidenceSnapshot } from "./evidence";
import type { CandidatePlan } from "./plan";

/** Policy areas from PRD §3 "Validation Policies". */
export const PolicyArea = z.enum([
  "event_constraints",
  "equipment",
  "duration",
  "heat",
  "rain",
  "air_quality",
  "freshness",
  "space_surface",
  "permissions",
]);
export type PolicyArea = z.infer<typeof PolicyArea>;

/**
 * The only checks an organizer confirmation can resolve (D-JT24-1): things a person can see at the
 * park. Heat, air quality, freshness and every rule check need provider evidence or a plan change;
 * a typed sentence never turns them into a pass.
 */
export const CONFIRMABLE_CHECK_IDS = [
  "space_surface.space",
  "space_surface.surface",
  "permissions.permit_review",
] as const satisfies readonly CheckId[];

export function isConfirmableCheck(id: CheckId): boolean {
  return (CONFIRMABLE_CHECK_IDS as readonly CheckId[]).includes(id);
}

export const CheckResult = z.object({
  /** Organizer confirmations and tasks reference it, together with the assessed park/time. */
  check_id: CheckId,
  area: PolicyArea,
  status: CheckStatus,
  /** Critical failed/unknown checks block finalization. */
  critical: z.boolean(),
  reason: z.string().min(1),
  evidence_ids: z.array(Id),
  policy_version: z.string().min(1),
  /** The exact combination this check assessed. Never extend it to another candidate. */
  assessed: z.object({
    park_id: Id.nullable(),
    start_time: LocalDateTime.nullable(),
    workout_template_id: Id.nullable(),
  }),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const CheckPlanResult = z.object({
  event_version: z.number().int().positive(),
  evidence_snapshot_id: Id,
  /**
   * fail if any critical check fails; unknown if any critical check is unknown; otherwise pass.
   * Non-critical checks (e.g. permit-review warnings) never change overall.
   */
  overall: CheckStatus,
  checks: z.array(CheckResult),
  /** check_ids of critical checks that failed or are unknown. */
  blockers: z.array(CheckId),
});
export type CheckPlanResult = z.infer<typeof CheckPlanResult>;

/** What every rule module receives. Supplied by the harness, not by agents. */
export interface RuleInput {
  plan: CandidatePlan;
  brief: EventBrief;
  snapshot: EvidenceSnapshot;
  event_version: number;
}

/**
 * A rule module (environment, workout, logistics, freshness) is a pure function.
 * check_plan combines the results of all rule modules.
 */
export type RuleFn = (input: RuleInput) => CheckResult[];

/** Checks that need a forecast or an air-quality reading, which no organizer can confirm. */
export const CONDITION_CHECK_IDS = [
  "heat.max_temperature",
  "weather.rain",
  "air_quality.max_aqi",
  "freshness.conditions",
] as const satisfies readonly CheckId[];

/**
 * The forecast is the only thing left: nothing fails, and every open critical check is weather or air
 * quality, usually because the event is beyond the forecast range (D-JT25-2). While the organizer
 * still has something to confirm, it isn't.
 */
export function isWaitingOnForecast(result: { checks: Pick<CheckResult, "check_id" | "status" | "critical">[] } | null): boolean {
  if (!result) return false;
  const open = result.checks.filter((c) => c.critical && c.status !== "pass");
  return open.length > 0 && open.every((c) => c.status === "unknown" && (CONDITION_CHECK_IDS as readonly CheckId[]).includes(c.check_id));
}

/** Open critical checks that wait on a forecast; empty unless `isWaitingOnForecast`. */
export function pendingForecastChecks(result: { checks: Pick<CheckResult, "check_id" | "status" | "critical">[] } | null): CheckId[] {
  if (!isWaitingOnForecast(result)) return [];
  return result!.checks.filter((c) => c.critical && c.status === "unknown").map((c) => c.check_id);
}

/** NWS hourly forecasts reach about 6.5 days ahead; AirNow posts air quality for today only. */
export const WEATHER_FORECAST_DAYS = 6;

/**
 * Forecast-pending lock-in (D-JT26-1): the plan may be approved and locked in although a forecast
 * isn't published yet, when nothing fails and every open critical check is a forecast that can't
 * exist yet for this day: air quality for any later day, weather beyond the forecast range. The
 * freshness check only counts alongside one of those. A stale or missing forecast that should exist
 * (an outage, or the day itself) still blocks. `today` is New York's date, "YYYY-MM-DD".
 */
export function isForecastPending(
  result: { checks: Pick<CheckResult, "check_id" | "status" | "critical">[] } | null,
  startTime: string | null | undefined,
  today: string,
): boolean {
  if (!startTime || !isWaitingOnForecast(result)) return false;
  const ahead = Math.round((Date.parse(`${startTime.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const notOutYet = (id: CheckId) =>
    id === "air_quality.max_aqi" ? ahead >= 1 : id === "heat.max_temperature" || id === "weather.rain" ? ahead > WEATHER_FORECAST_DAYS : false;
  const open = pendingForecastChecks(result).filter((id) => id !== "freshness.conditions");
  return open.length > 0 && open.every(notOutYet);
}
