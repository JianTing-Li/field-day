import { describe, expect, it } from "vitest";
import { PlanningOutput } from "@/contracts";
import { scenarioForSnapshot } from "@fixtures/scenarios";
import { INJECTED_TEXT } from "@fixtures/scenarios/case-12-untrusted-text";
import { planningStub } from "@/server/agents/planning/stub";
import { createBudget } from "@/server/orchestrator/budget";
import { tools } from "@/server/tools";
import { planningEvalCases } from "./index";
import { grade, runAndGrade, type AgentEvalCase } from "./rubric";
import { testCheckPlan } from "./test-check-plan";

function setup(c: AgentEvalCase<"planning">) {
  const { input, snapshot, brief } = c.build(1);
  const ctx = { snapshot, brief, event_version: 1, checkPlan: testCheckPlan(snapshot, brief, 1) };
  const ideal = scenarioForSnapshot(snapshot.id)!.planningOutput(1) as PlanningOutput;
  return { input, ctx, ideal };
}
const byId = (id: string) => planningEvalCases.find((c) => c.id === id)!;
const failed = (r: ReturnType<typeof grade>) => r.results.filter((x) => !x.passed).map((x) => x.id);
/** Critical failures only; advisory criteria are reported but never fail a case. */
const criticalFailed = (r: ReturnType<typeof grade>) => r.results.filter((x) => !x.passed && x.critical).map((x) => x.id);

describe("planning eval cases", () => {
  it.each(planningEvalCases.map((c) => [c.id, c] as const))("%s passes the scenario's ideal output", (_id, c) => {
    const { ctx, ideal } = setup(c);
    const r = grade(c, ideal, ctx, PlanningOutput);
    expect(criticalFailed(r)).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("covers 5 scenarios with unique IDs", () => {
    expect(new Set(planningEvalCases.map((c) => c.id)).size).toBe(5);
    expect(planningEvalCases.map((c) => c.scenario)).toEqual([1, 2, 9, 10, 12]);
  });
});

describe("planning graders catch bad outputs", () => {
  it("a ready draft for the heat conflict", () => {
    const c = byId("planning-02-conflict");
    const { ctx, ideal } = setup(c);
    const r = grade(c, { ...ideal, status: "draft" }, ctx, PlanningOutput);
    expect(r.passed).toBe(false);
    expect(failed(r)).toEqual(expect.arrayContaining(["not-ready", "honest-status"]));
  });

  it("checks claimed as pass that the rules fail", () => {
    const c = byId("planning-02-conflict");
    const { ctx, ideal } = setup(c);
    const lie = { ...ideal.rule_checks!, overall: "pass" as const, blockers: [], checks: ideal.rule_checks!.checks.map((x) => ({ ...x, status: "pass" as const })) };
    expect(failed(grade(c, { ...ideal, rule_checks: lie }, ctx, PlanningOutput))).toContain("honest-checks");
  });

  it("made-up evidence and verified claims without evidence", () => {
    const c = byId("planning-01-normal");
    const { ctx, ideal } = setup(c);
    const facts = [
      ...ideal.facts,
      { claim: "Shade all morning", status: "verified" as const, evidence_ids: ["ev-invented"], missing_reason: null },
      { claim: "Lawn is flat", status: "verified" as const, evidence_ids: [], missing_reason: null },
    ];
    expect(failed(grade(c, { ...ideal, facts }, ctx, PlanningOutput))).toEqual(
      expect.arrayContaining(["evidence-only", "verified-has-evidence"]),
    );
  });

  it("a park the organizer didn't allow, or a time that isn't a candidate", () => {
    const c = byId("planning-01-normal");
    const { ctx, ideal } = setup(c);
    const moved = { ...ideal, plan: { ...ideal.plan, start_time: "2026-10-29T09:30" } };
    expect(failed(grade(c, moved, ctx, PlanningOutput))).toContain("real-candidate");
  });

  it("repeating the planted instruction", () => {
    const c = byId("planning-12-untrusted-text");
    const { ctx, ideal } = setup(c);
    const echoed = { ...ideal, concerns: [...ideal.concerns, { id: "x", description: INJECTED_TEXT, blocking: false, related_check_ids: [] }] };
    expect(failed(grade(c, echoed, ctx, PlanningOutput))).toContain("no-echo");
  });

  it("guessing conditions with no forecast", () => {
    const c = byId("planning-10-outside-forecast");
    const { ctx, ideal } = setup(c);
    const guess = { ...ideal, facts: [{ claim: "Temperature will be about 55°F", status: "verified" as const, evidence_ids: [ctx.snapshot.items[0].id], missing_reason: null }] };
    expect(failed(grade(c, guess, ctx, PlanningOutput))).toContain("no-invented-conditions");
  });

  it("an output that doesn't match the contract fails at once", () => {
    const c = byId("planning-01-normal");
    const { ctx } = setup(c);
    const r = grade(c, { status: "draft" }, ctx, PlanningOutput);
    expect(r.passed).toBe(false);
    expect(r.results.map((x) => x.id)).toEqual(["schema"]);
  });
});

describe("runAndGrade", () => {
  it("runs an agent on a case and grades it (stub agent, no API calls)", async () => {
    const c = byId("planning-12-untrusted-text");
    const { snapshot, brief } = c.build(1);
    const r = await runAndGrade(c, planningStub, { tools, budget: createBudget() }, {
      schema: PlanningOutput,
      checkPlan: testCheckPlan(snapshot, brief, 1),
    });
    expect(r.agent_error).toBeNull();
    expect(r.passed).toBe(true);
  });
});

describe("advisory criteria", () => {
  it("report a permit review claimed as pass without failing the case", () => {
    const c = byId("planning-12-untrusted-text");
    const { ctx, ideal } = setup(c);
    const r = grade(c, ideal, ctx, PlanningOutput);
    expect(r.passed).toBe(true);
    expect(r.results.find((x) => x.id === "honest-advisory")).toMatchObject({ passed: false, critical: false });
  });
});
