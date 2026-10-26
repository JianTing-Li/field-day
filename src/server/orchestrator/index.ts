import type {
  AgentDeps,
  AgentResult,
  CandidatePlan,
  Conflict,
  EventBrief,
  EvidenceSnapshot,
  RunContext,
} from "@/contracts";
import { logisticsAgent } from "@/server/agents/logistics";
import { planningAgent } from "@/server/agents/planning";
import { reviewerAgent } from "@/server/agents/reviewer";
import { workoutAgent } from "@/server/agents/workout";
import { tools } from "@/server/tools";
import { createBudget } from "./budget";

/**
 * Orchestrator (owner: JT, task JT-10). Code-controlled workflow; not a fifth agent.
 *
 * STUB: runs planning, and for conflicts runs both specialists in parallel then the
 * reviewer once. Not yet implemented: combination checks, the single revision round,
 * stale-output rejection and budget enforcement around agent runs.
 */

interface RunArgs {
  event_id: string;
  event_version: number;
  brief: EventBrief;
  snapshot: EvidenceSnapshot;
}

function setup(args: RunArgs): { context: RunContext; deps: AgentDeps } {
  return {
    context: {
      event_id: args.event_id,
      event_version: args.event_version,
      evidence_snapshot_id: args.snapshot.id,
      revision_round: 0,
      revision_available: true,
    },
    deps: {
      tools,
      tool_context: { snapshot: args.snapshot, brief: args.brief, event_version: args.event_version },
      budget: createBudget(),
    },
  };
}

export async function runPlanning(args: RunArgs): Promise<AgentResult<"planning">> {
  const { context, deps } = setup(args);
  return planningAgent.run({ context, brief: args.brief }, deps);
}

export type ConflictReviewResult =
  | { ok: true; review: Extract<AgentResult<"reviewer">, { ok: true }>["output"] }
  | { ok: false; message: string };

export async function runConflictReview(
  args: RunArgs & { current_plan: CandidatePlan; conflict: Conflict },
): Promise<ConflictReviewResult> {
  const { context, deps } = setup(args);
  const specialistInput = {
    context,
    brief: args.brief,
    current_plan: args.current_plan,
    conflict: args.conflict,
    park_time_candidate_ids: args.snapshot.park_time_candidates.map((c) => c.id),
    revision_requests: [],
  };
  const [logistics, workout] = await Promise.all([
    logisticsAgent.run(specialistInput, deps),
    workoutAgent.run(specialistInput, deps),
  ]);
  if (!logistics.ok) return { ok: false, message: logistics.error.message };
  if (!workout.ok) return { ok: false, message: workout.error.message };

  const review = await reviewerAgent.run(
    {
      context,
      brief: args.brief,
      original_plan: args.current_plan,
      conflict: args.conflict,
      logistics: logistics.output,
      workout: workout.output,
      combination_checks: [],
    },
    deps,
  );
  if (!review.ok) return { ok: false, message: review.error.message };
  return { ok: true, review: review.output };
}
