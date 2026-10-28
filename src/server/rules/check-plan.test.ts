import { describe, expect, it } from "vitest";
import { case01, evalCases, scenarios } from "@fixtures/scenarios";
import type { CandidatePlan, CheckId, CheckPlanResult, CheckResult } from "@/contracts";
import { checkPlan, summarizeChecks } from "./check-plan";

const assessed = { park_id: "park-a", start_time: "2026-10-29T09:00", workout_template_id: "t" };
const c = (status: CheckResult["status"], critical = true, check_id: CheckId = "heat.max_temperature"): CheckResult => ({
  check_id,
  area: "heat",
  status,
  critical,
  reason: "test",
  evidence_ids: [],
  policy_version: "test",
  assessed,
});

describe("summarizeChecks", () => {
  it("passes only when all critical checks pass", () => {
    expect(summarizeChecks(1, "s", [c("pass"), c("fail", false)]).overall).toBe("pass");
  });
  it("is unknown when a critical check is unknown", () => {
    const r = summarizeChecks(1, "s", [c("pass"), c("unknown", true, "air_quality.max_aqi")]);
    expect(r.overall).toBe("unknown");
    expect(r.blockers).toEqual(["air_quality.max_aqi"]);
  });
  it("fails when any critical check fails", () => {
    expect(summarizeChecks(1, "s", [c("unknown"), c("fail")]).overall).toBe("fail");
  });
});

describe("checkPlan", () => {
  const run = () =>
    checkPlan({
      plan: case01.planningOutput(1).plan,
      brief: case01.brief,
      snapshot: case01.snapshot("evt", 1),
      event_version: 1,
    });

  it("passes the Case 1 plan with the real rules", () => {
    const out = run();
    expect(out.blockers).toEqual([]);
    expect(out.overall).toBe("pass");
    expect(out.evidence_snapshot_id).toBe(case01.SNAPSHOT_ID);
  });

});

/** Every plan in a case's fixture agent outputs, with the checks the fixture expects for it. */
function plansWithChecks(s: (typeof scenarios)[keyof typeof scenarios]): Array<{ where: string; plan: CandidatePlan; checks: CheckPlanResult }> {
  const out: Array<{ where: string; plan: CandidatePlan; checks: CheckPlanResult }> = [];
  const planning = s.planningOutput(1);
  if (planning.rule_checks) out.push({ where: "planning", plan: planning.plan, checks: planning.rule_checks });
  const extra = s as {
    logisticsOutput?: (v: number) => { options: Array<{ option_id: string; plan: CandidatePlan; checks: CheckPlanResult }> };
    workoutOutput?: (v: number) => { options: Array<{ option_id: string; plan: CandidatePlan; checks: CheckPlanResult }> };
    reviewerOutput?: (v: number) => { ranked_options: Array<{ combined_option_id: string; plan: CandidatePlan; checks: CheckPlanResult }> };
  };
  for (const o of extra.logisticsOutput?.(1).options ?? []) out.push({ where: `logistics ${o.option_id}`, plan: o.plan, checks: o.checks });
  for (const o of extra.workoutOutput?.(1).options ?? []) out.push({ where: `workout ${o.option_id}`, plan: o.plan, checks: o.checks });
  for (const o of extra.reviewerOutput?.(1).ranked_options ?? []) {
    out.push({ where: `reviewer ${o.combined_option_id}`, plan: o.plan, checks: o.checks });
  }
  return out;
}

const ENVIRONMENT_CHECKS: CheckId[] = ["heat.max_temperature", "air_quality.max_aqi", "freshness.conditions"];

describe("environment and freshness rules agree with the eval fixtures", () => {
  // Case 11's output cites a time the snapshot does not have; the harness must reject it, so its
  // claimed checks are not a target for the real rules.
  for (const s of evalCases.filter((x) => x.expected.case_number !== 11)) {
    const snapshot = s.snapshot("evt", 1);
    for (const { where, plan, checks } of plansWithChecks(s)) {
      it(`Case ${s.expected.case_number} ${where}`, () => {
        const out = checkPlan({ plan, brief: s.brief, snapshot, event_version: 1 });
        for (const id of ENVIRONMENT_CHECKS) {
          const expected = checks.checks.find((x) => x.check_id === id);
          if (!expected) continue;
          const actual = out.checks.find((x) => x.check_id === id)!;
          expect(actual.status, `${id}: ${actual.reason}`).toBe(expected.status);
        }
      });
    }
  }
});
