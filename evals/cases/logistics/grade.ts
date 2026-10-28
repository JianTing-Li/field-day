import type { z } from "zod";
import type { AgentDeps, AgentImpl, AgentName, CandidatePlan, CheckPlanResult } from "@/contracts";
import { checkPlan } from "@/server/rules/check-plan";
import type { CaseResult, CriterionResult, EvalContext } from "../planning/rubric";
import type { SpecialistEvalCase } from "./index";

/**
 * Grading for the Logistics and Reviewer eval cases (owner: JT, task JT-18). Same result shape as
 * the Planning/Workout rubric's `grade`: the schema first, then every criterion; a case passes when
 * every critical criterion passes.
 */

export async function contextFor<I, O>(c: SpecialistEvalCase<I, O>, event_version = 1) {
  const { input, snapshot, brief } = await c.build(event_version);
  const ctx: EvalContext = {
    snapshot,
    brief,
    event_version,
    checkPlan: (plan: CandidatePlan): CheckPlanResult => checkPlan({ plan, brief, snapshot, event_version }),
  };
  return { input, ctx };
}

export function gradeCase<I, O>(c: SpecialistEvalCase<I, O>, output: unknown, ctx: EvalContext, schema: z.ZodType<O>): CaseResult {
  const parsed = schema.safeParse(output);
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    return { case_id: c.id, passed: false, results: [{ id: "schema", description: "Output matches the agent's contract", critical: true, passed: false, detail }] };
  }
  const results: CriterionResult[] = [
    { id: "schema", description: "Output matches the agent's contract", critical: true, passed: true, detail: null },
    ...c.criteria.map((cr) => {
      let detail: string | null;
      try {
        detail = cr.check(parsed.data, ctx);
      } catch (err) {
        detail = `Grader error: ${err instanceof Error ? err.message : String(err)}`;
      }
      return { id: cr.id, description: cr.description, critical: cr.critical, passed: detail === null, detail };
    }),
  ];
  return { case_id: c.id, passed: results.every((r) => r.passed || !r.critical), results };
}

/** Runs an agent (stub, fake-runner or live) on a case and grades its answer. */
export async function runAndGradeCase<N extends Extract<AgentName, "logistics" | "reviewer">, I, O>(
  c: SpecialistEvalCase<I, O>,
  agent: AgentImpl<N>,
  deps: Omit<AgentDeps, "tool_context">,
  schema: z.ZodType<O>,
): Promise<CaseResult & { agent_error: string | null }> {
  const { input, ctx } = await contextFor(c);
  const result = await agent.run(input as never, { ...deps, tool_context: { snapshot: ctx.snapshot, brief: ctx.brief, event_version: ctx.event_version } });
  if (!result.ok) return { case_id: c.id, passed: false, agent_error: `${result.error.kind}: ${result.error.message}`, results: [] };
  return { ...gradeCase(c, result.output, ctx, schema), agent_error: null };
}
