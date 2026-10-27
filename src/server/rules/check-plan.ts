import type { CheckPlanResult, CheckResult, CheckStatus, RuleFn, RuleInput } from "@/contracts";
import { freshnessRules } from "@/server/evidence/freshness";
import { environmentRules } from "./environment";
import { logisticsRules } from "./logistics";
import { workoutRules } from "./workout";

/** Every rule module check_plan runs, in display order. */
export const RULE_MODULES: RuleFn[] = [logisticsRules, workoutRules, environmentRules, freshnessRules];

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
  const checks = modules.flatMap((rule) => rule(input));
  return summarizeChecks(input.event_version, input.snapshot.id, checks);
}
