import type { CandidatePlan, CheckResult, EventBrief, EvidenceSnapshot, RuleFn } from "@/contracts";
import { checkPlan } from "@/server/rules/check-plan";
import { logisticsRules } from "@/server/rules/logistics";
import { workoutRules } from "@/server/rules/workout";

/**
 * TEST ONLY. check_plan with stand-ins for the environment and freshness rules (JT-03, JT-04 are
 * still placeholders), so the scenarios' ideal outputs can be graded in a world where those rules
 * exist. Heat: the temperature evidence covering the plan's start vs the brief's limit. AQI: every AQI
 * value for the day vs the limit. Freshness: pass when both are present, otherwise unknown.
 * The eval runner (JT-17) supplies the real check_plan instead.
 */
const standInEnvironment: RuleFn = ({ plan, brief, snapshot }) => {
  const assessed = { park_id: plan.park_id, start_time: plan.start_time, workout_template_id: plan.workout_template_id };
  const make = (check_id: CheckResult["check_id"], status: CheckResult["status"], reason: string, ids: string[]): CheckResult => ({
    check_id,
    area: check_id.split(".")[0] as CheckResult["area"],
    status,
    critical: true,
    reason,
    evidence_ids: ids,
    policy_version: "test-stand-in",
    assessed,
  });
  const temp = snapshot.items.find(
    (i) =>
      i.metric === "temperature" &&
      (i.applies_to.park_id === plan.park_id || i.applies_to.park_id === null) &&
      plan.start_time !== null &&
      i.valid_from !== null &&
      i.valid_from <= plan.start_time &&
      (i.valid_to === null || plan.start_time < i.valid_to),
  );
  const day = plan.start_time?.slice(0, 10);
  const aqi = snapshot.items.filter((i) => i.metric === "aqi" && typeof i.value === "number" && (i.valid_from ?? "").startsWith(day ?? "-"));
  const tLimit = brief.instructor_limits.max_temperature_f;
  const aLimit = brief.instructor_limits.max_aqi;
  const heat =
    typeof temp?.value === "number" && tLimit !== null
      ? make("heat.max_temperature", temp.value > tLimit ? "fail" : "pass", `${temp.value}°F vs ${tLimit}°F`, [temp.id])
      : make("heat.max_temperature", "unknown", "No temperature evidence for the start time", []);
  const air =
    aqi.length > 0 && aLimit !== null
      ? make("air_quality.max_aqi", aqi.some((i) => (i.value as number) > aLimit) ? "fail" : "pass", `AQI vs ${aLimit}`, aqi.map((i) => i.id))
      : make("air_quality.max_aqi", "unknown", "No AQI evidence for the day", []);
  const fresh = make(
    "freshness.conditions",
    heat.status !== "unknown" && air.status !== "unknown" ? "pass" : "unknown",
    "Stand-in freshness",
    [],
  );
  return [heat, air, fresh];
};

export function testCheckPlan(snapshot: EvidenceSnapshot, brief: EventBrief, event_version: number) {
  return (plan: CandidatePlan) =>
    checkPlan({ plan, brief, snapshot, event_version }, [logisticsRules, workoutRules, standInEnvironment]);
}
