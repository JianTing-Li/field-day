import { z } from "zod";
import { CheckId, Id, LocalDateTime, Timestamp } from "./common";
import { EventBrief } from "./brief";
import { CheckPlanResult } from "./checks";
import { ReviewerOutput } from "./agents";
import { WorkoutTemplate } from "./evidence";
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
  /** "recheck": created when refreshed evidence (a new snapshot) revalidated the previous plan. */
  source: z.enum(["brief", "planning", "review", "organizer_edit", "recheck"]),
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
  /**
   * The workout layout the plan needed when this was confirmed. Space and surface confirmations
   * only resolve checks for a plan with the same layout; null or missing = layout not known, so
   * they never resolve a space or surface check.
   */
  layout: WorkoutTemplate.shape.space.shape.layout.nullable().optional(),
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
  /** Key of the finalize request that saved this record; repeats return this record. */
  idempotency_key: z.string().min(1).optional(),
  /**
   * True when the record rests on something not reviewed for real use: the demo environmental
   * policy, a workout template pending instructor review, or fixture data (D-JT24-2).
   */
  demo_only: z.boolean().optional(),
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

/** What the organizer can report as changed ("Report a problem"). */
export const ChangeKind = z.enum(["time_unavailable", "park_issue", "workout_issue", "conditions", "other"]);

/** An organizer's report, kept on the event so it isn't lost after the review runs. */
export const ChangeReportRecord = z.object({
  /** Set on reports made since JT-24, so one can be removed. */
  id: Id.optional(),
  at: Timestamp,
  /** The plan version the report was about. */
  version: z.number().int().positive(),
  kind: ChangeKind,
  description: z.string().min(1),
  /** The check this report fails, at `park_id` (null = every park) and `start_time` (null = any time). */
  check_id: CheckId.nullable().optional(),
  park_id: Id.nullable().optional(),
  start_time: LocalDateTime.nullable().optional(),
  /** For space and surface: the workout layout the report was about, like confirmations (D-JT22-1). */
  layout: WorkoutTemplate.shape.space.shape.layout.nullable().optional(),
});

/** The checks an organizer report can fail (D-JT24-12): things a person can see or know first. */
export const REPORTABLE_CHECK_IDS = [
  "space_surface.space",
  "space_surface.surface",
  "weather.rain",
  "event_constraints.start_window",
] as const satisfies readonly CheckId[];
export type ChangeReportRecord = z.infer<typeof ChangeReportRecord>;

/** The last failed lock-in attempt, so its explanation survives a reload. */
export const LastGate = z.object({
  version: z.number().int().positive(),
  at: Timestamp,
  gate: z.array(GateCheck),
});

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
  /** Organizer change reports, oldest first. Optional so older stored events still parse. */
  change_reports: z.array(ChangeReportRecord).optional(),
  /** The last lock-in attempt that did not pass the save gate; cleared by any later change. */
  last_gate: LastGate.nullable().optional(),
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
