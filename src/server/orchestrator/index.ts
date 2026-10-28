import {
  ZERO_USAGE,
  type AgentDeps,
  type AgentErrorKind,
  type AgentIO,
  type AgentName,
  type AgentResult,
  type BudgetTracker,
  type CandidatePlan,
  type CheckPlanResult,
  type CombinationCheck,
  type Conflict,
  type EventBrief,
  type EvidenceSnapshot,
  type LogisticsOutput,
  type PlanningOutput,
  type ReviewerOutput,
  type RevisionRequest,
  type RunContext,
  type ToolRegistry,
  type Usage,
  type WorkoutOutput,
} from "@/contracts";
import { tools as defaultTools } from "@/server/tools";
import { agentKinds, selectAgents, type AgentSet } from "./agents";
import { createBudget } from "./budget";

/**
 * Orchestrator (owner: JT, task JT-10). Code-controlled workflow; not a fifth agent.
 *
 * Planning drafts a plan. A critical check that fails, or an organizer report, is a conflict:
 * Event Logistics and Workout Adaptation then run in parallel, the harness checks every complete
 * park + time + workout combination of their options, and the Independent Reviewer ranks them.
 * The Reviewer may ask for 1 targeted revision; only the named specialists run again, then a
 * final review. A critical check that is only unknown is not a conflict: specialists cannot
 * supply missing evidence, so the plan goes to the organizer as needs_verification.
 *
 * Every run shares one budget. At most 7 agent executions and 1 revision round per run (PRD);
 * running out returns an explicit unresolved result, never a finalized event. Results that echo
 * another event version or evidence snapshot are rejected.
 */

export const MAX_AGENT_EXECUTIONS = 7;
export const MAX_REVISION_ROUNDS = 1;

interface RunArgs {
  event_id: string;
  event_version: number;
  brief: EventBrief;
  snapshot: EvidenceSnapshot;
}

export interface RunOptions {
  /** Defaults to selectAgents() (FIELDDAY_AGENTS). */
  agents?: AgentSet;
  /** Shared across every agent in the run. Defaults to a new budget with the configured limits. */
  budget?: BudgetTracker;
  tools?: ToolRegistry;
}

/** State shared by every step of one run. */
interface Run {
  args: RunArgs;
  agents: AgentSet;
  deps: AgentDeps;
  executions: number;
  usage: Usage;
}

function startRun(args: RunArgs, opts: RunOptions = {}): Run {
  return {
    args,
    agents: opts.agents ?? selectAgents(),
    deps: {
      tools: opts.tools ?? defaultTools,
      tool_context: { snapshot: args.snapshot, brief: args.brief, event_version: args.event_version },
      budget: opts.budget ?? createBudget(),
    },
    executions: 0,
    usage: { ...ZERO_USAGE },
  };
}

function context(run: Run, revision_round: number): RunContext {
  return {
    event_id: run.args.event_id,
    event_version: run.args.event_version,
    evidence_snapshot_id: run.args.snapshot.id,
    revision_round,
    revision_available: revision_round < MAX_REVISION_ROUNDS,
  };
}

function addUsage(total: Usage, delta: Usage): Usage {
  const out = { ...total };
  for (const k of Object.keys(delta) as (keyof Usage)[]) out[k] += delta[k];
  return out;
}

/** Runs one agent, counting it against the run's 7 executions and rejecting stale output. */
async function execute<N extends AgentName>(run: Run, name: N, input: AgentIO[N]["input"]): Promise<AgentResult<N>> {
  if (run.executions >= MAX_AGENT_EXECUTIONS) {
    return {
      ok: false,
      error: { kind: "budget_exhausted", message: `Agent execution limit (${MAX_AGENT_EXECUTIONS}) reached before running ${name}` },
      usage: ZERO_USAGE,
    };
  }
  run.executions += 1;
  const agent = run.agents[name] as AgentSet[N];
  const result = (await agent.run(input as never, run.deps)) as AgentResult<N>;
  run.usage = addUsage(run.usage, result.usage);
  if (!result.ok) return result;

  const out = result.output as { event_version: number; evidence_snapshot_id: string };
  if (out.event_version !== run.args.event_version || out.evidence_snapshot_id !== run.args.snapshot.id) {
    return {
      ok: false,
      error: {
        kind: "stale_context",
        message: `${name} answered for version ${out.event_version} / ${out.evidence_snapshot_id}, not version ${run.args.event_version} / ${run.args.snapshot.id}`,
      },
      usage: result.usage,
    };
  }
  if (name === "planning") {
    const problem = planningReferenceProblem(result.output as PlanningOutput, run.args.snapshot);
    if (problem) return { ok: false, error: { kind: "invalid_output", message: `planning ${problem}` }, usage: result.usage };
  }
  return result;
}

/**
 * Why a Planning answer refers to something the snapshot doesn't contain, or null. Such an answer
 * is rejected, never repaired (PRD Case 11). The specialists' and Reviewer's own harness checks
 * drop options with bad references instead, so their results can still be partly used.
 */
export function planningReferenceProblem(output: PlanningOutput, snapshot: EvidenceSnapshot): string | null {
  const { plan } = output;
  if (plan.park_time_candidate_id !== null) {
    const slot = snapshot.park_time_candidates.find((c) => c.id === plan.park_time_candidate_id);
    if (!slot) return `cites park/time candidate ${plan.park_time_candidate_id}, which is not in the snapshot`;
    if (slot.park_id !== plan.park_id || slot.start_time !== plan.start_time) {
      return `plans ${plan.park_id} at ${plan.start_time}, but candidate ${slot.id} is ${slot.park_id} at ${slot.start_time}`;
    }
  }
  const known = new Set(snapshot.items.map((i) => i.id));
  const unknown = output.facts.flatMap((f) => f.evidence_ids).filter((id) => !known.has(id));
  return unknown.length > 0 ? `cites evidence that is not in the snapshot: ${[...new Set(unknown)].join(", ")}` : null;
}

/**
 * The harness's conflict trigger: critical checks that failed. Unknown alone is not a conflict
 * (D-JT10-2). An organizer report is passed to runConflictReview directly.
 */
export function findConflict(checks: CheckPlanResult): Conflict | null {
  const failed = checks.checks.filter((c) => c.critical && c.status === "fail");
  if (failed.length === 0) return null;
  return {
    source: "harness",
    description: failed.map((c) => `${c.check_id}: ${c.reason}`).join("; "),
    check_ids: failed.map((c) => c.check_id),
  };
}

const workoutPart = (p: CandidatePlan) => ({
  workout_template_id: p.workout_template_id,
  adaptation_ids: p.adaptation_ids,
  duration_minutes: p.duration_minutes,
  session_outline: p.session_outline,
});
const placePart = (p: CandidatePlan) => ({
  park_time_candidate_id: p.park_time_candidate_id,
  park_id: p.park_id,
  start_time: p.start_time,
});

/**
 * Every complete combination the Reviewer may rank: each Logistics option with each Workout
 * option (park and time from Logistics, workout from Workout Adaptation), each Logistics option
 * with the original workout, and each Workout option at its own park and time. Each combination
 * is checked as a whole; individually passing options prove nothing about the pair.
 */
export async function combinationChecks(
  original: CandidatePlan,
  logistics: LogisticsOutput,
  workout: WorkoutOutput,
  deps: AgentDeps,
): Promise<CombinationCheck[]> {
  const pairs: Array<{ logistics_option_id: string | null; workout_option_id: string | null; plan: CandidatePlan }> = [];
  for (const lo of logistics.options) {
    pairs.push({ logistics_option_id: lo.option_id, workout_option_id: null, plan: { ...original, ...placePart(lo.plan) } });
    for (const wo of workout.options) {
      pairs.push({
        logistics_option_id: lo.option_id,
        workout_option_id: wo.option_id,
        plan: { ...original, ...placePart(lo.plan), ...workoutPart(wo.plan) },
      });
    }
  }
  for (const wo of workout.options) {
    pairs.push({ logistics_option_id: null, workout_option_id: wo.option_id, plan: { ...original, ...placePart(wo.plan), ...workoutPart(wo.plan) } });
  }

  const checks: CombinationCheck[] = [];
  for (const p of pairs) {
    if (p.plan.park_time_candidate_id === null) continue;
    const result = await deps.tools.check_plan({ plan: p.plan }, deps.tool_context);
    checks.push({ ...p, park_time_candidate_id: p.plan.park_time_candidate_id, result });
  }
  return checks;
}

export type AgentKinds = Record<AgentName, "stub" | "real">;

export async function runPlanning(args: RunArgs, opts: RunOptions = {}): Promise<AgentResult<"planning">> {
  const run = startRun(args, opts);
  return execute(run, "planning", { context: context(run, 0), brief: args.brief });
}

export type ConflictReviewResult =
  | { ok: true; review: ReviewerOutput; revision_rounds: number; usage: Usage; agents: AgentKinds }
  | { ok: false; kind: AgentErrorKind; message: string; usage: Usage; agents: AgentKinds };

interface ConflictArgs extends RunArgs {
  current_plan: CandidatePlan;
  conflict: Conflict;
}

export async function runConflictReview(args: ConflictArgs, opts: RunOptions = {}): Promise<ConflictReviewResult> {
  return conflictReview(startRun(args, opts), args);
}

async function conflictReview(run: Run, args: ConflictArgs): Promise<ConflictReviewResult> {
  const agents = agentKinds(run.agents);
  const fail = (kind: AgentErrorKind, message: string): ConflictReviewResult => ({ ok: false, kind, message, usage: run.usage, agents });
  const candidateIds = args.snapshot.park_time_candidates.map((c) => c.id);
  const specialistInput = (round: number, revision_requests: RevisionRequest[]) => ({
    context: context(run, round),
    brief: args.brief,
    current_plan: args.current_plan,
    conflict: args.conflict,
    park_time_candidate_ids: candidateIds,
    revision_requests,
  });

  // Round 0: both specialists in parallel, then the combination checks and the first review.
  const [lr, wr] = await Promise.all([
    execute(run, "logistics", specialistInput(0, [])),
    execute(run, "workout", specialistInput(0, [])),
  ]);
  if (!lr.ok) return fail(lr.error.kind, `Event Logistics: ${lr.error.message}`);
  if (!wr.ok) return fail(wr.error.kind, `Workout Adaptation: ${wr.error.message}`);
  let logistics = lr.output;
  let workout = wr.output;

  const reviewOnce = async (round: number) =>
    execute(run, "reviewer", {
      context: context(run, round),
      brief: args.brief,
      original_plan: args.current_plan,
      conflict: args.conflict,
      logistics,
      workout,
      combination_checks: await combinationChecks(args.current_plan, logistics, workout, run.deps),
    });

  const first = await reviewOnce(0);
  if (!first.ok) return fail(first.error.kind, `Independent Reviewer: ${first.error.message}`);
  if (first.output.status !== "revision_requested" || first.output.revision_requests.length === 0) {
    return { ok: true, review: settle(first.output), revision_rounds: 0, usage: run.usage, agents };
  }

  // Round 1: only the specialists the Reviewer named run again; then the final review.
  const requests = first.output.revision_requests;
  const forL = requests.filter((r) => r.specialist === "logistics");
  const forW = requests.filter((r) => r.specialist === "workout");
  const [lr2, wr2] = await Promise.all([
    forL.length > 0 ? execute(run, "logistics", specialistInput(1, forL)) : null,
    forW.length > 0 ? execute(run, "workout", specialistInput(1, forW)) : null,
  ]);
  if (lr2 && !lr2.ok) return fail(lr2.error.kind, `Event Logistics revision: ${lr2.error.message}`);
  if (wr2 && !wr2.ok) return fail(wr2.error.kind, `Workout Adaptation revision: ${wr2.error.message}`);
  if (lr2) logistics = lr2.output;
  if (wr2) workout = wr2.output;

  const final = await reviewOnce(1);
  if (!final.ok) return fail(final.error.kind, `Independent Reviewer (final): ${final.error.message}`);
  return { ok: true, review: settle(final.output), revision_rounds: 1, usage: run.usage, agents };
}

/**
 * The revision round is spent once a review comes back. A review that still asks for a revision
 * becomes needs_verification with its requests listed as blockers, never another loop.
 */
function settle(review: ReviewerOutput): ReviewerOutput {
  if (review.status !== "revision_requested") return { ...review, revision_requests: [] };
  return {
    ...review,
    status: "needs_verification",
    revision_requests: [],
    blocking_issues: [
      ...review.blocking_issues,
      ...review.revision_requests.map((r) => `Unresolved after review (${r.specialist}): ${r.issue}`),
    ],
  };
}

export type WorkflowResult =
  | {
      ok: true;
      planning: PlanningOutput;
      /** The harness's check_plan result for the drafted plan. */
      checks: CheckPlanResult;
      conflict: Conflict | null;
      review: ConflictReviewResult | null;
      usage: Usage;
      agents: AgentKinds;
    }
  | { ok: false; kind: AgentErrorKind; message: string; usage: Usage; agents: AgentKinds };

/**
 * The whole workflow in one run and one budget: Planning, the conflict check, then (only on a
 * conflict) specialists, combination checks and review. Used by the evals and the real API (JT-14).
 */
export async function runWorkflow(args: RunArgs, opts: RunOptions = {}): Promise<WorkflowResult> {
  const run = startRun(args, opts);
  const agents = agentKinds(run.agents);
  const planned = await execute(run, "planning", { context: context(run, 0), brief: args.brief });
  if (!planned.ok) return { ok: false, kind: planned.error.kind, message: `Planning: ${planned.error.message}`, usage: run.usage, agents };

  const checks = await run.deps.tools.check_plan({ plan: planned.output.plan }, run.deps.tool_context);
  const conflict = findConflict(checks);
  const review = conflict ? await conflictReview(run, { ...args, current_plan: planned.output.plan, conflict }) : null;
  return { ok: true, planning: planned.output, checks, conflict, review, usage: run.usage, agents };
}
