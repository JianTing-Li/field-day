import { z } from "zod";
import { Id, LocalDateTime } from "./common";
import type { EventBrief } from "./brief";
import { CheckPlanResult } from "./checks";
import { EvidenceItem, ParkCandidate, ParkTimeCandidate, WorkoutTemplate } from "./evidence";
import type { EvidenceSnapshot } from "./evidence";
import { CandidatePlan } from "./plan";

/**
 * Agent-facing tools (PRD §3a). All are read-only and read the evidence snapshot.
 * Tools never fetch newer evidence.
 */

export const ToolName = z.enum([
  "get_park_candidates",
  "get_forecast",
  "get_air_quality",
  "get_workout_templates",
  "check_plan",
]);
export type ToolName = z.infer<typeof ToolName>;

const TimeRange = {
  park_id: Id,
  start_time: LocalDateTime,
  end_time: LocalDateTime,
};

export const ToolSchemas = {
  get_park_candidates: {
    input: z.object({ park_ids: z.array(Id).nullable() }),
    output: z.object({
      park_candidates: z.array(ParkCandidate),
      park_time_candidates: z.array(ParkTimeCandidate),
    }),
  },
  get_forecast: {
    input: z.object(TimeRange),
    output: z.object({ items: z.array(EvidenceItem), coverage_gaps: z.array(z.string()) }),
  },
  get_air_quality: {
    input: z.object(TimeRange),
    output: z.object({ items: z.array(EvidenceItem), coverage_gaps: z.array(z.string()) }),
  },
  get_workout_templates: {
    input: z.object({ template_ids: z.array(Id).nullable() }),
    output: z.object({ templates: z.array(WorkoutTemplate) }),
  },
  check_plan: {
    input: z.object({ plan: CandidatePlan }),
    output: CheckPlanResult,
  },
} as const;

export type ToolInput<T extends ToolName> = z.infer<(typeof ToolSchemas)[T]["input"]>;
export type ToolOutput<T extends ToolName> = z.infer<(typeof ToolSchemas)[T]["output"]>;

/** Context the harness binds to every tool call. Agents never supply it. */
export interface ToolContext {
  snapshot: EvidenceSnapshot;
  brief: EventBrief;
  event_version: number;
}

export type ToolHandler<T extends ToolName> = (
  input: ToolInput<T>,
  ctx: ToolContext,
) => ToolOutput<T> | Promise<ToolOutput<T>>;

export type ToolRegistry = { [T in ToolName]: ToolHandler<T> };
