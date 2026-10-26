import type { CheckId, CheckResult, PolicyArea, RuleInput } from "@/contracts";

/**
 * Placeholder check used by rule modules that are not implemented yet.
 * Returns unknown + critical, which correctly blocks finalization.
 */
export function notImplementedCheck(
  input: RuleInput,
  check_id: CheckId,
  area: PolicyArea,
  task: string,
): CheckResult {
  return {
    check_id,
    area,
    status: "unknown",
    critical: true,
    reason: `Not implemented yet (${task})`,
    evidence_ids: [],
    policy_version: "placeholder",
    assessed: {
      park_id: input.plan.park_id,
      start_time: input.plan.start_time,
      workout_template_id: input.plan.workout_template_id,
    },
  };
}
