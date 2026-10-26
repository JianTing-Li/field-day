import type { EvidenceItem, ToolContext, ToolRegistry } from "@/contracts";
import { checkPlan } from "@/server/rules/check-plan";

/**
 * Agent-facing tools (owner: JT, task JT-02). Read-only: they read the evidence snapshot
 * bound by the harness and never fetch newer data.
 *
 * STUB: filters by park and metric only; time-window filtering and coverage gaps are JT-02.
 */

function conditions(ctx: ToolContext, park_id: string, metrics: EvidenceItem["metric"][]) {
  const items = ctx.snapshot.items.filter(
    (e) =>
      metrics.includes(e.metric) &&
      (e.applies_to.park_id === park_id || e.applies_to.park_id === null),
  );
  return { items, coverage_gaps: ctx.snapshot.coverage_gaps };
}

export const tools: ToolRegistry = {
  get_park_candidates: (input, ctx) => {
    const keep = (id: string) => input.park_ids === null || input.park_ids.includes(id);
    return {
      park_candidates: ctx.snapshot.park_candidates.filter((p) => keep(p.id)),
      park_time_candidates: ctx.snapshot.park_time_candidates.filter((c) => keep(c.park_id)),
    };
  },
  get_forecast: (input, ctx) =>
    conditions(ctx, input.park_id, ["temperature", "precipitation_probability", "wind_speed"]),
  get_air_quality: (input, ctx) => conditions(ctx, input.park_id, ["aqi"]),
  get_workout_templates: (input, ctx) => ({
    templates: ctx.snapshot.workout_templates.filter(
      (t) => input.template_ids === null || input.template_ids.includes(t.id),
    ),
  }),
  check_plan: (input, ctx) =>
    checkPlan({
      plan: input.plan,
      brief: ctx.brief,
      snapshot: ctx.snapshot,
      event_version: ctx.event_version,
    }),
};
