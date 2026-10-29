import type { CheckId, CheckPlanResult, CheckResult, CheckStatus, RuleFn, RuleInput } from "@/contracts";
import { freshnessRules } from "@/server/evidence/freshness";
import { environmentRules } from "./environment";
import { logisticsRules } from "./logistics";
import { workoutRules } from "./workout";

/** Every rule module check_plan runs, in display order. */
export const RULE_MODULES: RuleFn[] = [logisticsRules, workoutRules, environmentRules, freshnessRules];

/**
 * Which checks block finalization when they fail or are unknown (JT-06, D-JT06-1).
 * Everything is critical except the permit-review warning, which is a conservative review flag,
 * not a permit determination (PRD §3 "Validation Policies", D-018). check_plan applies this list,
 * so it is the one place the critical set is decided.
 */
export const CRITICAL_CHECKS: Record<CheckId, boolean> = {
  "event_constraints.start_window": true,
  "event_constraints.allowed_park": true,
  "equipment.available": true,
  "duration.fits": true,
  "heat.max_temperature": true,
  "air_quality.max_aqi": true,
  "freshness.conditions": true,
  "space_surface.space": true,
  "space_surface.surface": true,
  "permissions.permit_review": false,
};

/**
 * Combines check results into one CheckPlanResult.
 * fail if any critical check fails; unknown if any critical check is unknown; otherwise pass.
 */
export function summarizeChecks(
  event_version: number,
  evidence_snapshot_id: string,
  checks: CheckResult[],
): CheckPlanResult {
  const critical = checks.filter((c) => c.critical);
  const overall: CheckStatus = critical.some((c) => c.status === "fail")
    ? "fail"
    : critical.some((c) => c.status === "unknown")
      ? "unknown"
      : "pass";
  const blockers = critical.filter((c) => c.status !== "pass").map((c) => c.check_id);
  return { event_version, evidence_snapshot_id, overall, checks, blockers };
}

/** check_plan: runs every rule module against one complete or partial combination. */
export function checkPlan(input: RuleInput, modules: RuleFn[] = RULE_MODULES): CheckPlanResult {
  const checks = modules
    .flatMap((rule) => rule(input))
    .map((c) => ({ ...c, critical: CRITICAL_CHECKS[c.check_id] }));
  return summarizeChecks(input.event_version, input.snapshot.id, checks);
}
