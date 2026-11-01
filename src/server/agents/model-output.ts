import { z } from "zod";
import {
  CheckPlanResult,
  CombinedOption,
  LogisticsOutput,
  ReviewerOutput,
  SpecialistOption,
  WorkoutOutput,
} from "@/contracts";

/**
 * What the specialists and the Reviewer write (owner: JT, task JT-24, D-JT24-3). The contracts
 * carry a full check_plan result on every option, but the harness re-runs check_plan on every
 * option after the model answers and throws the model's copy away. Writing it out cost thousands
 * of output tokens per answer and cut Reviewer answers off at the token limit. So the model leaves
 * `checks` out; parsing fills in a pending placeholder that the enforce step always replaces.
 */

const pending = (o: { event_version: number; evidence_snapshot_id: string }): CheckPlanResult => ({
  event_version: o.event_version,
  evidence_snapshot_id: o.evidence_snapshot_id,
  overall: "unknown",
  checks: [],
  blockers: [],
});

const withPending = <O extends { checks?: CheckPlanResult }>(
  echo: { event_version: number; evidence_snapshot_id: string },
  options: O[],
) => options.map((o) => ({ ...o, checks: o.checks ?? pending(echo) }));

const LogisticsOption = SpecialistOption.extend({ specialist: z.literal("logistics") });
const WorkoutOption = SpecialistOption.extend({ specialist: z.literal("workout") });

/** Parses a Logistics answer; `checks` may be left out. */
export const LogisticsModelOutput: z.ZodType<LogisticsOutput> = LogisticsOutput.extend({
  options: z.array(LogisticsOption.extend({ checks: CheckPlanResult.optional() })).max(3),
}).transform((o) => ({ ...o, options: withPending(o, o.options) }));

/** Parses a Workout Adaptation answer; `checks` may be left out. */
export const WorkoutModelOutput: z.ZodType<WorkoutOutput> = WorkoutOutput.extend({
  options: z.array(WorkoutOption.extend({ checks: CheckPlanResult.optional() })).max(3),
}).transform((o) => ({ ...o, options: withPending(o, o.options) }));

/** Parses a Reviewer answer; `checks` may be left out. */
export const ReviewerModelOutput: z.ZodType<ReviewerOutput> = ReviewerOutput.extend({
  ranked_options: z.array(CombinedOption.extend({ checks: CheckPlanResult.optional() })),
}).transform((o) => ({ ...o, ranked_options: withPending(o, o.ranked_options) }));

/** The shapes shown to the model: the same, without `checks`. */
export const LOGISTICS_SCHEMA_JSON = JSON.stringify(
  z.toJSONSchema(LogisticsOutput.extend({ options: z.array(LogisticsOption.omit({ checks: true })).max(3) }), { io: "input" }),
);
export const WORKOUT_SCHEMA_JSON = JSON.stringify(
  z.toJSONSchema(WorkoutOutput.extend({ options: z.array(WorkoutOption.omit({ checks: true })).max(3) }), { io: "input" }),
);
export const REVIEWER_SCHEMA_JSON = JSON.stringify(
  z.toJSONSchema(ReviewerOutput.extend({ ranked_options: z.array(CombinedOption.omit({ checks: true })).max(3) }), {
    io: "input",
  }),
);
