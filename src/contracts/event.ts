import { z } from "zod";
import { CheckId, Id, LocalDateTime, Timestamp } from "./common";
import { EventBrief } from "./brief";
import { CheckPlanResult } from "./checks";
import { ReviewerOutput } from "./agents";
import { CandidatePlan, Concern, Fact, OrganizerTask } from "./plan";
import { Usage } from "./runner";

/** Event lifecycle (PRD §2 "Event lifecycle"). Agent statuses are not lifecycle states. */
export const LifecycleStatus = z.enum([
  "draft",
  "needs_verification",
  "ready_for_approval",
  "approved",
  "finalized",
  "no_feasible_option",
]);
export type LifecycleStatus = z.infer<typeof LifecycleStatus>;

/** One organizer-visible plan version. Never mutated after a newer version exists. */
export const PlanVersion = z.object({
  version: z.number().int().positive(),
  based_on_version: z.number().int().positive().nullable(),
  created_at: Timestamp,
  source: z.enum(["brief", "planning", "review", "organizer_edit"]),
  status: LifecycleStatus,
  /** Null until a plan is generated. */
  plan: CandidatePlan.nullable(),
  evidence_snapshot_id: Id.nullable(),
  checks: CheckPlanResult.nullable(),
  facts: z.array(Fact),
  concerns: z.array(Concern),
  organizer_tasks: z.array(OrganizerTask),
  /** Reviewer result for the conflict review that produced or follows this version. */
  alternatives: ReviewerOutput.nullable(),
});
export type PlanVersion = z.infer<typeof PlanVersion>;

/**
 * Organizer confirmation: resolves exactly one check at one park (and time, if given).
 * It never proves permission by itself and never applies to a different park.
 */
export const OrganizerConfirmation = z.object({
  id: Id,
  check_id: CheckId,
  park_id: Id,
  /** Null = applies at this park for any time; otherwise only to that start time. */
  start_time: LocalDateTime.nullable(),
  statement: z.string().min(1),
  confirmed_by: z.string().min(1),
  confirmed_at: Timestamp,
  note: z.string().nullable(),
});
export type OrganizerConfirmation = z.infer<typeof OrganizerConfirmation>;

export const Approval = z.object({
  version: z.number().int().positive(),
  evidence_snapshot_id: Id,
  approved_at: Timestamp,
});
export type Approval = z.infer<typeof Approval>;

/** Final save gate checks (PRD §3c). */
export const GateCheckId = z.enum([
  "complete_inputs",
  "correct_version",
  "current_evidence",
  "hard_constraints",
  "required_confirmations",
]);

export const GateCheck = z.object({
  id: GateCheckId,
  status: z.enum(["pass", "fail"]),
  reason: z.string().min(1),
});
export type GateCheck = z.infer<typeof GateCheck>;

export const FinalizedRecord = z.object({
  version: z.number().int().positive(),
  evidence_snapshot_id: Id,
  finalized_at: Timestamp,
  gate: z.array(GateCheck),
});
export type FinalizedRecord = z.infer<typeof FinalizedRecord>;

/** Human-readable progress shown in the UI (never raw tool calls or agent chatter). */
export const ProgressStep = z.object({ at: Timestamp, message: z.string().min(1) });

export const RunState = z.object({
  run_id: Id,
  status: z.enum(["running", "completed", "failed", "budget_exhausted"]),
  revision_count: z.number().int().min(0).max(1),
  usage: Usage,
  progress: z.array(ProgressStep),
});
export type RunState = z.infer<typeof RunState>;

export const FieldDayEvent = z.object({
  id: Id,
  created_at: Timestamp,
  updated_at: Timestamp,
  brief: EventBrief,
  versions: z.array(PlanVersion).min(1),
  current_version: z.number().int().positive(),
  approval: Approval.nullable(),
  confirmations: z.array(OrganizerConfirmation),
  /** The finalized version stays unchanged when later drafts are created. */
  finalized: FinalizedRecord.nullable(),
  last_run: RunState.nullable(),
});
export type FieldDayEvent = z.infer<typeof FieldDayEvent>;

export const EventSummary = z.object({
  id: Id,
  title: z.string(),
  date: z.string(),
  status: LifecycleStatus,
  current_version: z.number().int().positive(),
  finalized_version: z.number().int().positive().nullable(),
  updated_at: Timestamp,
});
export type EventSummary = z.infer<typeof EventSummary>;
