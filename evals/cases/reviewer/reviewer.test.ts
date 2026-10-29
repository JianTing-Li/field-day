import { describe, expect, it } from "vitest";
import { ReviewerOutput } from "@/contracts";
import { scenarioForSnapshot } from "@fixtures/scenarios";
import { reviewerStub } from "@/server/agents/reviewer/stub";
import { createBudget } from "@/server/orchestrator/budget";
import { tools } from "@/server/tools";
import { contextFor, gradeCase, runAndGradeCase } from "../logistics/grade";
import { reviewerEvalCases } from "./index";

const byId = (id: string) => reviewerEvalCases.find((c) => c.id === id)!;
async function setup(id: string) {
  const c = byId(id);
  const { input, ctx } = await contextFor(c);
  const s = scenarioForSnapshot(ctx.snapshot.id) as unknown as { reviewerOutput: (v: number) => ReviewerOutput };
  return { c, input, ctx, ideal: s.reviewerOutput(1) };
}
const failed = (r: ReturnType<typeof gradeCase>) => r.results.filter((x) => !x.passed).map((x) => x.id);

describe("reviewer eval cases", () => {
  it.each(reviewerEvalCases.map((c) => [c.id] as const))("%s passes the scenario's ideal output", async (id) => {
    const { c, ctx, ideal } = await setup(id);
    const r = gradeCase(c, ideal, ctx, ReviewerOutput);
    expect(r.results.filter((x) => !x.passed && x.critical).map((x) => `${x.id}: ${x.detail}`)).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("covers 6 scenarios with unique IDs", () => {
    expect(new Set(reviewerEvalCases.map((c) => c.id)).size).toBe(6);
    expect(reviewerEvalCases.map((c) => c.scenario)).toEqual([2, 4, 5, 6, 8, 9]);
  });

  it("gives the Reviewer the harness's combination checks", async () => {
    const { input } = await setup("reviewer-08-combined");
    expect(input.combination_checks.length).toBeGreaterThan(0);
    expect(input.combination_checks.some((x) => x.logistics_option_id && x.workout_option_id && x.result.overall === "pass")).toBe(true);
  });

  it("the stub passes every case through the same grading path", async () => {
    for (const c of reviewerEvalCases) {
      const r = await runAndGradeCase(c, reviewerStub, { tools, budget: createBudget() }, ReviewerOutput);
      expect(r.agent_error, c.id).toBeNull();
      expect(r.passed, c.id).toBe(true);
    }
  });
});

describe("reviewer graders catch bad outputs", () => {
  it("recommending a combination that doesn't pass, and a draft without a recommendation", async () => {
    const { c, ctx, ideal } = await setup("reviewer-02-conflict");
    const rec = { ...ideal, status: "draft" as const, recommendation: { combined_option_id: ideal.ranked_options[0].combined_option_id, reason: "x" } };
    expect(failed(gradeCase(c, rec, ctx, ReviewerOutput))).toEqual(expect.arrayContaining(["recommends-only-passing", "no-recommendation-while-unverified"]));
    const four = await setup("reviewer-04-time-change");
    const empty = { ...four.ideal, recommendation: null };
    expect(failed(gradeCase(four.c, empty, four.ctx, ReviewerOutput))).toEqual(expect.arrayContaining(["draft-needs-recommendation", "recommends"]));
  });

  it("an invented park or workout, and checks it can't back up", async () => {
    const { c, ctx, ideal } = await setup("reviewer-08-combined");
    const top = ideal.ranked_options[0];
    const noLogistics = { ...top, logistics_option_id: null, workout_option_id: null };
    expect(failed(gradeCase(c, { ...ideal, ranked_options: [noLogistics] }, ctx, ReviewerOutput))).toContain("no-invented-combination");
    const twoStep = await setup("reviewer-02-conflict");
    const lie = twoStep.ideal.ranked_options.map((o) => ({ ...o, checks: { ...o.checks, overall: "pass" as const, blockers: [], checks: o.checks.checks.map((x) => ({ ...x, status: "pass" as const })) } }));
    expect(failed(gradeCase(twoStep.c, { ...twoStep.ideal, ranked_options: lie }, twoStep.ctx, ReviewerOutput))).toContain("honest-checks");
  });

  it("calling missing evidence infeasible, and hiding what blocks the result", async () => {
    const { c, ctx, ideal } = await setup("reviewer-02-conflict");
    expect(failed(gradeCase(c, { ...ideal, status: "no_feasible_option" }, ctx, ReviewerOutput))).toContain("infeasible-only-when-shown");
    expect(failed(gradeCase(c, { ...ideal, blocking_issues: [], organizer_tasks: [] }, ctx, ReviewerOutput))).toContain("blockers-visible");
  });

  it("a revision request for an option nobody proposed", async () => {
    const { c, ctx, ideal } = await setup("reviewer-02-conflict");
    const r = { ...ideal, status: "revision_requested" as const, revision_requests: [{ specialist: "logistics" as const, option_ids: ["log-9"], issue: "x", required_correction: "y" }] };
    expect(failed(gradeCase(c, r, ctx, ReviewerOutput))).toContain("revision-only-when-available");
  });

  it("a recommendation when nothing is feasible", async () => {
    const { c, ctx, ideal } = await setup("reviewer-09-no-feasible");
    const r = { ...ideal, recommendation: { combined_option_id: ideal.ranked_options[0].combined_option_id, reason: "x" } };
    expect(failed(gradeCase(c, r, ctx, ReviewerOutput))).toEqual(expect.arrayContaining(["no-feasible", "recommends-only-passing"]));
  });
});
