import type { EvidenceItem, ToolContext, ToolRegistry } from "@/contracts";
import { checkPlan } from "@/server/rules/check-plan";
import { findUncoveredIntervals, overlapsWindow } from "@/server/evidence/coverage";
import { fromLocalDateTime } from "@/server/time";

/**
 * Agent-facing tools (owner: JT, task JT-02). Read-only: they read the evidence snapshot
 * bound by the harness and never fetch newer data.
 */

type ConditionMetric = Extract<
  EvidenceItem["metric"],
  "temperature" | "precipitation_probability" | "wind_speed" | "aqi"
>;

interface TimeRangeInput {
  park_id: string;
  start_time: string;
  end_time: string;
}

const FORECAST_METRICS: ConditionMetric[] = [
  "temperature",
  "precipitation_probability",
  "wind_speed",
];

type Domain = "forecast" | "air_quality";

const AIR_QUALITY_TERMS = /\b(airnow|aqi|air quality|pm2\.5|pm10|ozone)\b/i;
const FORECAST_TERMS = /\b(nws|forecast|weather|temperature|precipitation|wind)\b/i;

/** Which condition domain a snapshot-level gap is about, or null for neither (parks, templates...). */
function gapDomain(gap: string): Domain | null {
  if (AIR_QUALITY_TERMS.test(gap)) return "air_quality";
  if (FORECAST_TERMS.test(gap)) return "forecast";
  return null;
}

/** True when `id` appears in `text` as a whole ID, not as part of a longer one (park-a vs park-ab). */
function mentionsId(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).test(text);
}

/**
 * Snapshot-level coverage_gaps relevant to this park and condition domain. Gaps about the other
 * domain or about neither (park records, templates) are dropped. A gap naming a park in the
 * snapshot is kept only when it names the requested park; gaps naming no park are regional and kept.
 */
function relevantSnapshotGaps(ctx: ToolContext, park_id: string, domain: Domain): string[] {
  const knownParks = new Set([
    ...ctx.snapshot.park_candidates.map((p) => p.id),
    ...ctx.snapshot.park_time_candidates.map((c) => c.park_id),
    ...ctx.snapshot.items.flatMap((e) => (e.applies_to.park_id ? [e.applies_to.park_id] : [])),
  ]);
  const otherParks = [...knownParks].filter((id) => id !== park_id);
  return ctx.snapshot.coverage_gaps.filter((gap) => {
    if (gapDomain(gap) !== domain) return false;
    if (mentionsId(gap, park_id)) return true;
    return !otherParks.some((id) => mentionsId(gap, id));
  });
}

function conditions(
  ctx: ToolContext,
  input: TimeRangeInput,
  metrics: ConditionMetric[],
  requiredMetrics: ConditionMetric[],
  domain: Domain,
) {
  const { park_id, start_time, end_time } = input;
  const reqStartMs = fromLocalDateTime(start_time).getTime();
  const reqEndMs = fromLocalDateTime(end_time).getTime();

  // Agent mistakes must never read as "covered": invalid requests return no evidence and a gap.
  if (reqEndMs <= reqStartMs) {
    return {
      items: [],
      coverage_gaps: [`Invalid window for ${park_id}: end_time ${end_time} is not after start_time ${start_time}`],
    };
  }
  if (!ctx.snapshot.park_candidates.some((p) => p.id === park_id)) {
    return {
      items: [],
      coverage_gaps: [`${park_id} is not a park candidate in this evidence snapshot`],
    };
  }

  const parkAndMetricItems = ctx.snapshot.items.filter(
    (e): e is EvidenceItem & { metric: ConditionMetric } =>
      metrics.includes(e.metric as ConditionMetric) &&
      (e.applies_to.park_id === park_id || e.applies_to.park_id === null),
  );

  const items = parkAndMetricItems.filter((e) => overlapsWindow(e, reqStartMs, reqEndMs));

  const coverage_gaps: string[] = [...relevantSnapshotGaps(ctx, park_id, domain)];
  const addGap = (msg: string) => {
    if (!coverage_gaps.includes(msg)) coverage_gaps.push(msg);
  };

  // Report explicit missing_reason from any overlapping item whose value is null
  for (const item of items) {
    if (item.value === null) {
      const period = `${item.valid_from ?? "open"} to ${item.valid_to ?? "open"}`;
      addGap(
        `${item.metric} missing for ${park_id} (${item.id}, ${period}): ${item.missing_reason ?? "no value"}`,
      );
    }
  }

  // Check interval coverage for required metrics and any optional metrics present in the snapshot for this park
  const metricsToCheck = metrics.filter(
    (m) => requiredMetrics.includes(m) || parkAndMetricItems.some((e) => e.metric === m),
  );

  for (const metric of metricsToCheck) {
    const metricItems = items.filter((e) => e.metric === metric);
    // Only forecasts cover a future window; observations never stand in for one (PRD §3a, AirNow).
    const coveringItems = metricItems.filter(
      (e) => e.value !== null && e.evidence_type === "forecast",
    );

    if (coveringItems.length === 0) {
      // Avoid duplicate gap if we already added an item-level missing_reason gap for this metric
      const alreadyReportedNullItem = metricItems.some((e) => e.value === null);
      if (metricItems.some((e) => e.value !== null)) {
        addGap(
          `No ${metric} forecast for ${park_id} covering ${start_time} to ${end_time}; observations do not count as forecast coverage`,
        );
      } else if (!alreadyReportedNullItem) {
        addGap(`No ${metric} evidence for ${park_id} covering ${start_time} to ${end_time}`);
      }
      continue;
    }

    const uncovered = findUncoveredIntervals(coveringItems, reqStartMs, reqEndMs);
    for (const gap of uncovered) {
      addGap(
        `Missing ${metric} coverage for ${park_id} from ${gap.start} to ${gap.end} (requested ${start_time} to ${end_time})`,
      );
    }
  }

  return { items, coverage_gaps };
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
    conditions(ctx, input, FORECAST_METRICS, ["temperature"], "forecast"),
  get_air_quality: (input, ctx) =>
    conditions(ctx, input, ["aqi"], ["aqi"], "air_quality"),
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
