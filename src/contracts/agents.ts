import { z } from "zod";
import { CheckId, Id } from "./common";
import { EventBrief } from "./brief";
import { CheckPlanResult } from "./checks";
import { CombinationCheck, CombinedOption, RevisionRequest, SpecialistOption } from "./options";
import { CandidatePlan, Concern, Fact, OrganizerTask } from "./plan";

/** Inputs and outputs for the 4 agents (PRD §3b output sections). */

export const AgentName = z.enum(["planning", "logistics", "workout", "reviewer"]);
export type AgentName = z.infer<typeof AgentName>;

/** Version context every agent receives and must echo back. */
export const RunContext = z.object({
  event_id: Id,
  event_version: z.number().int().positive(),
  evidence_snapshot_id: Id,
  /** 0 for the first pass, 1 for the single permitted revision round. */
  revision_round: z.number().int().min(0).max(1),
  revision_available: z.boolean(),
});
export type RunContext = z.infer<typeof RunContext>;

/** What triggered specialist review. */
export const Conflict = z.object({
  source: z.enum(["harness", "organizer"]),
  description: z.string().min(1),
  check_ids: z.array(CheckId),
});
export type Conflict = z.infer<typeof Conflict>;

const Echo = {
  event_version: z.number().int().positive(),
  evidence_snapshot_id: Id,
};

// ---- Planning -------------------------------------------------------------

export const PlanningInput = z.object({ context: RunContext, brief: EventBrief });
export type PlanningInput = z.infer<typeof PlanningInput>;

export const PlanningOutput = z.object({
  ...Echo,
  status: z.enum(["draft", "needs_verification", "no_feasible_option"]),
  plan: CandidatePlan,
  facts: z.array(Fact),
  rule_checks: CheckPlanResult.nullable(),
  concerns: z.array(Concern),
  organizer_tasks: z.array(OrganizerTask),
});
export type PlanningOutput = z.infer<typeof PlanningOutput>;

// ---- Specialists (Logistics, Workout Adaptation) --------------------------

export const SpecialistInput = z.object({
  context: RunContext,
  brief: EventBrief,
  current_plan: CandidatePlan,
  conflict: Conflict,
  /** ParkTimeCandidate IDs the specialist may assess. */
  park_time_candidate_ids: z.array(Id),
  /** Present only in the revision round. */
  revision_requests: z.array(RevisionRequest),
});
export type SpecialistInput = z.infer<typeof SpecialistInput>;

const SpecialistOutputBase = {
  ...Echo,
  status: z.enum(["options_proposed", "needs_verification", "no_feasible_option"]),
  concerns: z.array(Concern),
  organizer_tasks: z.array(OrganizerTask),
};

export const LogisticsOutput = z.object({
  ...SpecialistOutputBase,
  options: z.array(SpecialistOption.extend({ specialist: z.literal("logistics") })).max(3),
});
export type LogisticsOutput = z.infer<typeof LogisticsOutput>;

export const WorkoutOutput = z.object({
  ...SpecialistOutputBase,
  options: z.array(SpecialistOption.extend({ specialist: z.literal("workout") })).max(3),
});
export type WorkoutOutput = z.infer<typeof WorkoutOutput>;

// ---- Reviewer -------------------------------------------------------------

export const ReviewerInput = z.object({
  context: RunContext,
  brief: EventBrief,
  original_plan: CandidatePlan,
  conflict: Conflict,
  logistics: LogisticsOutput,
  workout: WorkoutOutput,
  combination_checks: z.array(CombinationCheck),
});
export type ReviewerInput = z.infer<typeof ReviewerInput>;

export const ReviewerOutput = z.object({
  ...Echo,
  status: z.enum(["draft", "revision_requested", "needs_verification", "no_feasible_option"]),
  ranked_options: z.array(CombinedOption),
  recommendation: z
    .object({ combined_option_id: Id, reason: z.string().min(1) })
    .nullable(),
  revision_requests: z.array(RevisionRequest),
  blocking_issues: z.array(z.string()),
  organizer_tasks: z.array(OrganizerTask),
});
export type ReviewerOutput = z.infer<typeof ReviewerOutput>;

/** Maps each agent to its input/output types. */
export interface AgentIO {
  planning: { input: PlanningInput; output: PlanningOutput };
  logistics: { input: SpecialistInput; output: LogisticsOutput };
  workout: { input: SpecialistInput; output: WorkoutOutput };
  reviewer: { input: ReviewerInput; output: ReviewerOutput };
}
