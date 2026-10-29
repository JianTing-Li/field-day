import { z } from "zod";
import { Id } from "./common";
import { CheckPlanResult } from "./checks";
import { CandidatePlan, PlanChange } from "./plan";

/** Common specialist-option contract (PRD §3). Used by Logistics and Workout Adaptation. */
export const SpecialistOption = z.object({
  option_id: Id,
  specialist: z.enum(["logistics", "workout"]),
  /** ParkTimeCandidate IDs this option was assessed for. Never silently extend to others. */
  park_time_candidate_ids: z.array(Id).min(1),
  plan: CandidatePlan,
  changes: z.array(PlanChange),
  /** Logistics: workout assumptions used. Workout: place/time assumptions used. */
  assumptions: z.array(z.string()),
  requirements: z.array(z.string()),
  /** e.g. "requires stationary workout adaptation" or "requires Park B space confirmation". */
  dependencies: z.array(z.string()),
  evidence_ids: z.array(Id),
  unknowns: z.array(z.string()),
  checks: CheckPlanResult,
});
export type SpecialistOption = z.infer<typeof SpecialistOption>;

/** A complete location + time + workout combination ranked by the Reviewer. */
export const CombinedOption = z.object({
  combined_option_id: Id,
  logistics_option_id: Id.nullable(),
  workout_option_id: Id.nullable(),
  park_time_candidate_id: Id.nullable(),
  plan: CandidatePlan,
  changes_from_original: z.array(PlanChange),
  tradeoffs: z.array(z.string()),
  evidence_ids: z.array(Id),
  /** Combination-level checks. Individually passing proposals do not prove these. */
  checks: CheckPlanResult,
  unknowns: z.array(z.string()),
});
export type CombinedOption = z.infer<typeof CombinedOption>;

export const RevisionRequest = z.object({
  specialist: z.enum(["logistics", "workout"]),
  option_ids: z.array(Id),
  issue: z.string().min(1),
  required_correction: z.string().min(1),
});
export type RevisionRequest = z.infer<typeof RevisionRequest>;

/** Harness-computed check of one logistics option x workout option pairing. */
export const CombinationCheck = z.object({
  logistics_option_id: Id.nullable(),
  workout_option_id: Id.nullable(),
  park_time_candidate_id: Id,
  plan: CandidatePlan,
  result: CheckPlanResult,
});
export type CombinationCheck = z.infer<typeof CombinationCheck>;
