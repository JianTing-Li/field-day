import { z } from "zod";
import { Id, LocalDateTime, TimeZone } from "./common";

/** A park + time + workout combination. Null fields are unknown, never guessed. */
export const CandidatePlan = z.object({
  /** ParkTimeCandidate ID from the snapshot, when the plan matches one. */
  park_time_candidate_id: Id.nullable(),
  park_id: Id.nullable(),
  start_time: LocalDateTime.nullable(),
  time_zone: TimeZone,
  duration_minutes: z.number().int().positive().nullable(),
  workout_template_id: Id.nullable(),
  /** IDs from the template's permitted_adaptations. */
  adaptation_ids: z.array(Id),
  session_outline: z.array(z.string()),
});
export type CandidatePlan = z.infer<typeof CandidatePlan>;

/** A claim shown to the organizer, tied to evidence. */
export const Fact = z.object({
  claim: z.string().min(1),
  status: z.enum(["verified", "unverified", "missing"]),
  evidence_ids: z.array(Id),
  missing_reason: z.string().nullable(),
});
export type Fact = z.infer<typeof Fact>;

export const Concern = z.object({
  id: Id,
  description: z.string().min(1),
  blocking: z.boolean(),
  related_check_ids: z.array(z.string()),
});
export type Concern = z.infer<typeof Concern>;

/** A specific question or verification step for the organizer. */
export const OrganizerTask = z.object({
  id: Id,
  description: z.string().min(1),
  /** The single check this task resolves, if any. */
  resolves_check_id: z.string().nullable(),
});
export type OrganizerTask = z.infer<typeof OrganizerTask>;

/** One before/after change between plans. */
export const PlanChange = z.object({
  field: z.enum(["park", "start_time", "duration", "workout", "adaptation", "session"]),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type PlanChange = z.infer<typeof PlanChange>;
