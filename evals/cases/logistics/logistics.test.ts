import { describe, expect, it } from "vitest";
import { LogisticsOutput } from "@/contracts";
import { scenarioForSnapshot } from "@fixtures/scenarios";
import { logisticsStub } from "@/server/agents/logistics/stub";
import { createBudget } from "@/server/orchestrator/budget";
import { tools } from "@/server/tools";
import { contextFor, gradeCase, runAndGradeCase } from "./grade";
import { logisticsEvalCases } from "./index";

const byId = (id: string) => logisticsEvalCases.find((c) => c.id === id)!;
async function setup(id: string) {
  const c = byId(id);
  const { input, ctx } = await contextFor(c);
  const ideal = scenarioForSnapshot(ctx.snapshot.id)!;
  return { c, input, ctx, ideal: (ideal as { logisticsOutput: (v: number) => LogisticsOutput }).logisticsOutput(1) };
}
const failed = (r: ReturnType<typeof gradeCase>) => r.results.filter((x) => !x.passed).map((x) => x.id);

describe("logistics eval cases", () => {
  it.each(logisticsEvalCases.map((c) => [c.id] as const))("%s passes the scenario's ideal output", async (id) => {
    const { c, ctx, ideal } = await setup(id);
    const r = gradeCase(c, ideal, ctx, LogisticsOutput);
    expect(r.results.filter((x) => !x.passed && x.critical).map((x) => `${x.id}: ${x.detail}`)).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("covers 6 scenarios with unique IDs", () => {
    expect(new Set(logisticsEvalCases.map((c) => c.id)).size).toBe(6);
    expect(logisticsEvalCases.map((c) => c.scenario)).toEqual([2, 4, 5, 6, 8, 9]);
  });

  it("the stub passes every case through the same grading path", async () => {
    for (const c of logisticsEvalCases) {
      const r = await runAndGradeCase(c, logisticsStub, { tools, budget: createBudget() }, LogisticsOutput);
      expect(r.agent_error, c.id).toBeNull();
      expect(r.passed, c.id).toBe(true);
    }
  });
});

describe("logistics graders catch bad outputs", () => {
  it("a changed workout, an unmoved plan and an unsupplied candidate", async () => {
    const { c, ctx, ideal, input } = await setup("logistics-02-conflict");
    const o = ideal.options[0];
    const adapted = { ...o, plan: { ...o.plan, adaptation_ids: ["adapt-stationary-circuit"] } };
    expect(failed(gradeCase(c, { ...ideal, options: [adapted] }, ctx, LogisticsOutput))).toContain("keeps-workout");
    const unmoved = { ...o, park_time_candidate_ids: [input.current_plan.park_time_candidate_id!], plan: input.current_plan };
    expect(failed(gradeCase(c, { ...ideal, options: [unmoved] }, ctx, LogisticsOutput))).toContain("moves-place-or-time");
    const invented = { ...o, plan: { ...o.plan, park_time_candidate_id: "cand-z-0600" } };
    expect(failed(gradeCase(c, { ...ideal, options: [invented] }, ctx, LogisticsOutput))).toContain("real-candidate");
  });

  it("claims of passing checks that check_plan doesn't support", async () => {
    const { c, ctx, ideal } = await setup("logistics-02-conflict");
    const lie = ideal.options.map((o) => ({ ...o, checks: { ...o.checks, overall: "pass" as const, blockers: [], checks: o.checks.checks.map((x) => ({ ...x, status: "pass" as const })) } }));
    const f = failed(gradeCase(c, { ...ideal, options: lie }, ctx, LogisticsOutput));
    expect(f).toEqual(expect.arrayContaining(["honest-checks", "no-borrowed-space"]));
  });

  it("silent unknowns, made-up evidence and a borrowed confirmation", async () => {
    const { c, ctx, ideal } = await setup("logistics-02-conflict");
    const parkB = ideal.options.find((o) => o.plan.park_id === "park-b")!;
    const silent = { ...ideal, options: [{ ...parkB, unknowns: [] }], concerns: [], organizer_tasks: [] };
    expect(failed(gradeCase(c, silent, ctx, LogisticsOutput))).toContain("unknowns-visible");
    const madeUp = { ...ideal, options: [{ ...parkB, evidence_ids: [...parkB.evidence_ids, "ev-invented"] }] };
    expect(failed(gradeCase(c, madeUp, ctx, LogisticsOutput))).toContain("evidence-only");
    const parkAConfirmation = ctx.snapshot.items.find((i) => i.evidence_type === "organizer_confirmation" && i.applies_to.park_id === "park-a")!;
    const borrowed = { ...ideal, options: [{ ...parkB, evidence_ids: [...parkB.evidence_ids, parkAConfirmation.id] }] };
    expect(failed(gradeCase(c, borrowed, ctx, LogisticsOutput))).toContain("own-park-confirmations");
  });

  it("missing the fix when one exists, and claiming a fix when none does", async () => {
    const four = await setup("logistics-04-time-change");
    const noOptions = { ...four.ideal, status: "needs_verification" as const, options: [] };
    expect(failed(gradeCase(four.c, noOptions, four.ctx, LogisticsOutput))).toContain("finds-passing-time");

    const nine = await setup("logistics-09-no-feasible");
    expect(failed(gradeCase(nine.c, { ...nine.ideal, status: "options_proposed" }, nine.ctx, LogisticsOutput))).toContain("no-false-fix");
  });
});
