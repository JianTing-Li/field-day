import { describe, expect, it } from "vitest";
import { ZERO_USAGE } from "@/contracts";
import { case01, case03 } from "@fixtures/scenarios";
import { multiAgentValue, summarize, toMarkdown } from "./compare";
import { ALL_CASES, allPlans, applicable, finalValidation, gradeOutcome, harnessStatus, runEvals, runRules, snapshotFor, type Outcome } from "./runner";

// Stub mode only: stubs return the fixtures' own outputs and make no API calls. These tests check
// the runner and the grading, not agent quality.

const byNumber = (n: number) => ALL_CASES.find((c) => c.expected.case_number === n)!;

describe("rules-only baseline", () => {
  it("checks every candidate x template x permitted adaptation", () => {
    const c = byNumber(1);
    const snapshot = snapshotFor(c);
    const perSlot = snapshot.workout_templates.reduce((n, t) => n + 1 + t.permitted_adaptations.length, 0);
    expect(allPlans(c, snapshot)).toHaveLength(snapshot.park_time_candidates.length * perSlot);
  });

  it("picks a passing plan when one exists and prefers the organizer's choices", async () => {
    const o = await runRules(byNumber(1));
    expect(o.final_status).toBe("draft");
    expect(o.checks?.overall).toBe("pass");
    expect(o.plan?.park_id).toBe(case01.brief.preferred_park_id ?? o.plan?.park_id);
    expect(o.usage.model_requests).toBe(0);
  });

  it("says no_feasible_option only when every combination fails (Case 9)", async () => {
    const o = await runRules(byNumber(9));
    expect(o.final_status).toBe("no_feasible_option");
    expect(o.checks?.overall).toBe("fail");
  });

  it("is not graded on Case 11, which has no agent output to reject", () => {
    expect(applicable("rules", byNumber(11))).toBe(false);
    expect(applicable("single", byNumber(11))).toBe(true);
  });
});

describe("harnessStatus (D-JT23-1)", () => {
  const out = case01.planningOutput(1);
  const pass = out.rule_checks!;

  it("grades passing checks as a draft even when the agent says needs_verification", () => {
    expect(harnessStatus(out.plan, pass, "needs_verification")).toBe("draft");
  });
  it("never grades unknown or failed checks as a draft, whatever the agent says", () => {
    expect(harnessStatus(out.plan, { ...pass, overall: "unknown" }, "draft")).toBe("needs_verification");
    expect(harnessStatus(out.plan, { ...pass, overall: "fail" }, "no_feasible_option")).toBe("no_feasible_option");
    expect(harnessStatus(null, null, "revision_requested")).toBe("needs_verification");
  });
});

describe("final validation (Case 3)", () => {
  it("plans on snapshot A and rechecks the result on the refreshed snapshot B", async () => {
    const c = byNumber(3);
    expect(snapshotFor(c).id).toBe(case03.SNAPSHOT_ID);
    const planned = await runRules(c);
    expect(planned.final_status).toBe("draft");
    const checked = await finalValidation(c, planned);
    expect(checked.final_status).toBe("needs_verification");
    expect(checked.checks?.evidence_snapshot_id).toBe(case03.REFRESHED_SNAPSHOT_ID);
    expect(gradeOutcome(c, checked).correct).toBe(true);
  });

  it("leaves other cases unchanged", async () => {
    const o = await runRules(byNumber(1));
    expect(await finalValidation(byNumber(1), o)).toBe(o);
  });
});

describe("gradeOutcome", () => {
  const base = async (): Promise<Outcome> => runRules(byNumber(2));

  it("reports every field that differs from the expected outcome", async () => {
    const o = { ...(await base()), final_status: "draft" as const };
    const g = gradeOutcome(byNumber(2), o);
    expect(g.correct).toBe(false);
    expect(g.failures).toContain("status draft, expected needs_verification");
  });

  it("derives finalize from a passing draft", async () => {
    const c = byNumber(1);
    const o = await runRules(c);
    expect(gradeOutcome(c, o).correct).toBe(true);
    expect(gradeOutcome(c, { ...o, final_status: "needs_verification" }).failures).toContain("finalize blocked, expected allowed");
  });

  it("grades whether specialists ran only for the 4-agent workflow", async () => {
    const o = await base();
    expect(gradeOutcome(byNumber(2), { ...o, specialists_run: false }).correct).toBe(true);
    const multi = { ...o, architecture: "multi" as const, specialists_run: false };
    expect(gradeOutcome(byNumber(2), multi).failures).toContain("specialists did not run, expected to run");
  });

  it("expects Case 11 to be rejected as invalid_output", () => {
    const c = byNumber(11);
    const rejected: Outcome = {
      architecture: "single", case_number: 11, final_status: null, plan: null, checks: null, specialists_run: null,
      revision_rounds: 0, agent_error: "invalid_output", cited_evidence_ids: [], usage: ZERO_USAGE,
      latency_ms: 0, agents: null, note: null,
    };
    expect(gradeOutcome(c, rejected).correct).toBe(true);
    expect(gradeOutcome(c, { ...rejected, agent_error: null, final_status: "draft" }).correct).toBe(false);
  });

  it("flags more revision rounds than the case allows", async () => {
    const g = gradeOutcome(byNumber(1), { ...(await runRules(byNumber(1))), revision_rounds: 1 });
    expect(g.failures).toContain("1 revision rounds, at most 0 expected");
  });
});

describe("runEvals in stub mode", () => {
  it("runs all three architectures, skips rules on Case 11, and summarizes", async () => {
    const run = await runEvals({ mode: "stub" });
    expect(run.outcomes).toHaveLength(12 * 3 - 1);
    const summaries = summarize(run);
    const multi = summaries.find((s) => s.architecture === "multi")!;
    // Stubs return the fixtures' ideal outputs, so the 4-agent workflow matches every expected outcome.
    expect(multi.correct).toBe(12);
    expect(multi.resolved).toBe(5);
    expect(multi.stub_agents).toEqual(["logistics", "planning", "reviewer", "workout"]);
    for (const s of summaries) {
      expect(s.hard_rule_violations).toBe(0);
      expect(s.invented_evidence).toBe(0);
      expect(s.hidden_gaps).toBe(0);
      expect(s.cost_usd).toBeNull();
    }
    expect(summaries.find((s) => s.architecture === "rules")!.graded).toBe(11);
    expect(multiAgentValue(summaries)?.additional_resolved).toBe(5);

    const md = toMarkdown(run, summaries, null);
    expect(md).toContain("| Correct outcomes | ≥ 11 of 12 |");
    expect(md).toContain("Stub agents in this run");
    expect(md).toContain("Fixture inputs, not live data");
  });

  it("computes cost from token prices when given", async () => {
    const run = await runEvals({ mode: "stub", architectures: ["rules"], cases: [byNumber(1)] });
    expect(summarize(run, { input_per_mtok: 1, output_per_mtok: 5 })[0].cost_usd).toBe(0);
  });
});
