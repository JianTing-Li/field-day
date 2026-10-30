import { z } from "zod";
import { CheckId, CheckStatus, Id, LocalDateTime } from "./common";
import type { EventBrief } from "./brief";
import type { EvidenceSnapshot } from "./evidence";
import type { CandidatePlan } from "./plan";

/** Policy areas from PRD §3 "Validation Policies". */
export const PolicyArea = z.enum([
  "event_constraints",
  "equipment",
  "duration",
  "heat",
  "rain",
  "air_quality",
  "freshness",
  "space_surface",
  "permissions",
]);
export type PolicyArea = z.infer<typeof PolicyArea>;

/**
 * The only checks an organizer confirmation can resolve (D-JT24-1): things a person can see at the
 * park. Heat, air quality, freshness and every rule check need provider evidence or a plan change;
 * a typed sentence never turns them into a pass.
 */
export const CONFIRMABLE_CHECK_IDS = [
  "space_surface.space",
  "space_surface.surface",
  "permissions.permit_review",
] as const satisfies readonly CheckId[];

export function isConfirmableCheck(id: CheckId): boolean {
  return (CONFIRMABLE_CHECK_IDS as readonly CheckId[]).includes(id);
}

export const CheckResult = z.object({
  /** Organizer confirmations and tasks reference it, together with the assessed park/time. */
  check_id: CheckId,
  area: PolicyArea,
  status: CheckStatus,
  /** Critical failed/unknown checks block finalization. */
  critical: z.boolean(),
  reason: z.string().min(1),
  evidence_ids: z.array(Id),
  policy_version: z.string().min(1),
  /** The exact combination this check assessed. Never extend it to another candidate. */
  assessed: z.object({
    park_id: Id.nullable(),
    start_time: LocalDateTime.nullable(),
    workout_template_id: Id.nullable(),
  }),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const CheckPlanResult = z.object({
  event_version: z.number().int().positive(),
  evidence_snapshot_id: Id,
  /**
   * fail if any critical check fails; unknown if any critical check is unknown; otherwise pass.
   * Non-critical checks (e.g. permit-review warnings) never change overall.
   */
  overall: CheckStatus,
  checks: z.array(CheckResult),
  /** check_ids of critical checks that failed or are unknown. */
  blockers: z.array(CheckId),
});
export type CheckPlanResult = z.infer<typeof CheckPlanResult>;

/** What every rule module receives. Supplied by the harness, not by agents. */
export interface RuleInput {
  plan: CandidatePlan;
  brief: EventBrief;
  snapshot: EvidenceSnapshot;
  event_version: number;
}

/**
 * A rule module (environment, workout, logistics, freshness) is a pure function.
 * check_plan combines the results of all rule modules.
 */
export type RuleFn = (input: RuleInput) => CheckResult[];
