import type { z } from "zod";
import type {
  AgentDeps,
  AgentImpl,
  AgentIO,
  CandidatePlan,
  CheckPlanResult,
  EventBrief,
  EvidenceSnapshot,
} from "@/contracts";

/**
 * Agent eval framework for the Planning and Workout eval cases (owner: Yadan, task YT-13).
 * A case is an input plus a rubric of criteria. Each criterion grades one agent output and returns
 * null (pass) or a short reason (fail). Criteria judge the output against the harness's own
 * check_plan, so a case never hard-codes a rule result the harness would compute differently.
 * Written before the cases' first runs (PRD §3d); never tuned after seeing results.
 */

export type EvalAgent = "planning" | "workout";

export interface EvalContext {
  snapshot: EvidenceSnapshot;
  brief: EventBrief;
  event_version: number;
  /** The harness check_plan for this snapshot and brief (the eval runner supplies it). */
  checkPlan: (plan: CandidatePlan) => CheckPlanResult;
}

export interface Criterion<O> {
  id: string;
  description: string;
  /** A failed critical criterion fails the case. Non-critical ones are reported only. */
  critical: boolean;
  check: (output: O, ctx: EvalContext) => string | null;
}

export interface AgentEvalCase<N extends EvalAgent> {
  id: string;
  title: string;
  agent: N;
  /** PRD eval case number the scenario comes from (fixtures/scenarios). */
  scenario: number;
  /** Builds the agent input and the context it is graded in. */
  build: (event_version: number) => { input: AgentIO[N]["input"]; snapshot: EvidenceSnapshot; brief: EventBrief };
  criteria: Criterion<AgentIO[N]["output"]>[];
}

export interface CriterionResult {
  id: string;
  description: string;
  critical: boolean;
  passed: boolean;
  detail: string | null;
}

export interface CaseResult {
  case_id: string;
  /** True when every critical criterion passes. */
  passed: boolean;
  results: CriterionResult[];
}

/** Grades one output. An output that fails its schema fails the case without running other criteria. */
export function grade<N extends EvalAgent>(
  evalCase: AgentEvalCase<N>,
  output: unknown,
  ctx: EvalContext,
  schema: z.ZodType<AgentIO[N]["output"]>,
): CaseResult {
  const parsed = schema.safeParse(output);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    return {
      case_id: evalCase.id,
      passed: false,
      results: [{ id: "schema", description: "Output matches the agent's contract", critical: true, passed: false, detail }],
    };
  }
  const results: CriterionResult[] = [
    { id: "schema", description: "Output matches the agent's contract", critical: true, passed: true, detail: null },
    ...evalCase.criteria.map((c) => {
      let detail: string | null;
      try {
        detail = c.check(parsed.data, ctx);
      } catch (err) {
        detail = `Grader error: ${err instanceof Error ? err.message : String(err)}`;
      }
      return { id: c.id, description: c.description, critical: c.critical, passed: detail === null, detail };
    }),
  ];
  return { case_id: evalCase.id, passed: results.every((r) => r.passed || !r.critical), results };
}

/**
 * Runs an agent on a case and grades the result. The eval runner (JT-17) can call this with the
 * stub, the real agent with a fake runner, or the real agent live.
 */
export async function runAndGrade<N extends EvalAgent>(
  evalCase: AgentEvalCase<N>,
  agent: AgentImpl<N>,
  deps: Omit<AgentDeps, "tool_context">,
  options: { event_version?: number; schema: z.ZodType<AgentIO[N]["output"]>; checkPlan: EvalContext["checkPlan"] },
): Promise<CaseResult & { agent_error: string | null }> {
  const event_version = options.event_version ?? 1;
  const { input, snapshot, brief } = evalCase.build(event_version);
  const result = await agent.run(input, { ...deps, tool_context: { snapshot, brief, event_version } });
  if (!result.ok) {
    return {
      case_id: evalCase.id,
      passed: false,
      agent_error: `${result.error.kind}: ${result.error.message}`,
      results: [],
    };
  }
  const graded = grade(evalCase, result.output, { snapshot, brief, event_version, checkPlan: options.checkPlan }, options.schema);
  return { ...graded, agent_error: null };
}

// ---- Helpers shared by the Planning and Workout criteria ----------------------------------------

export const fail = (reason: string) => reason;

/** Evidence IDs in the output that aren't in the snapshot. */
export function unknownEvidence(ids: string[], snapshot: EvidenceSnapshot): string[] {
  const known = new Set(snapshot.items.map((i) => i.id));
  return ids.filter((id) => !known.has(id));
}

/** Why a plan's template or adaptations aren't usable from this snapshot, or null. */
export function templateProblem(plan: CandidatePlan, snapshot: EvidenceSnapshot): string | null {
  if (plan.workout_template_id === null) return null;
  const t = snapshot.workout_templates.find((x) => x.id === plan.workout_template_id);
  if (!t) return `template ${plan.workout_template_id} is not in the snapshot`;
  const bad = plan.adaptation_ids.filter((a) => !t.permitted_adaptations.some((p) => p.id === a));
  return bad.length > 0 ? `adaptation(s) ${bad.join(", ")} are not permitted for ${t.id}` : null;
}

/** Why a plan isn't exactly one of the snapshot's park/time candidates, or null. */
export function candidateProblem(plan: CandidatePlan, snapshot: EvidenceSnapshot, allowed?: string[]): string | null {
  if (plan.park_time_candidate_id === null) return "plan names no park/time candidate";
  const c = snapshot.park_time_candidates.find((x) => x.id === plan.park_time_candidate_id);
  if (!c) return `candidate ${plan.park_time_candidate_id} is not in the snapshot`;
  if (allowed && !allowed.includes(c.id)) return `candidate ${c.id} was not supplied to the agent`;
  if (plan.park_id !== c.park_id || plan.start_time !== c.start_time) {
    return `plan says ${plan.park_id} at ${plan.start_time} but candidate ${c.id} is ${c.park_id} at ${c.start_time}`;
  }
  return null;
}

/**
 * Check IDs a result calls "pass" that the harness says are fail or unknown. `critical` picks the
 * critical checks (true) or the advisory ones (false), as the harness classifies them.
 */
export function overclaimed(claimed: CheckPlanResult, truth: CheckPlanResult, critical = true): string[] {
  return claimed.checks
    .filter((c) => c.status === "pass")
    .filter((c) => {
      const real = truth.checks.find((t) => t.check_id === c.check_id);
      return real !== undefined && real.critical === critical && real.status !== "pass";
    })
    .map((c) => c.check_id);
}

/**
 * Whether the output tells the organizer about a check: a blocking concern or an organizer task for
 * that check or another check in the same area (e.g. one space concern covers space and surface).
 */
export function covered(
  id: string,
  concerns: { blocking: boolean; related_check_ids: string[] }[],
  tasks: { resolves_check_id: string | null }[],
): boolean {
  const area = id.split(".")[0];
  const sameArea = (x: string | null) => x !== null && (x === id || x.split(".")[0] === area);
  return concerns.some((c) => c.blocking && c.related_check_ids.some(sameArea)) || tasks.some((t) => sameArea(t.resolves_check_id));
}

export function statusOf(result: CheckPlanResult, id: string) {
  return result.checks.find((c) => c.check_id === id)?.status ?? null;
}
