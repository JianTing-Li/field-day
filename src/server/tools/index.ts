import type { EvidenceItem, ToolContext, ToolRegistry } from "@/contracts";
import { checkPlan } from "@/server/rules/check-plan";
import { fromLocalDateTime, toLocalDateTime } from "@/server/time";

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

/** True when [itemFrom, itemTo] overlaps [reqStart, reqEnd]. */
function overlapsWindow(
  item: EvidenceItem,
  reqStartMs: number,
  reqEndMs: number,
): boolean {
  const fromMs = item.valid_from !== null ? fromLocalDateTime(item.valid_from).getTime() : null;
  const toMs = item.valid_to !== null ? fromLocalDateTime(item.valid_to).getTime() : null;

  if (fromMs === null && toMs === null) return true;
  if (fromMs !== null && toMs === null) return fromMs < reqEndMs;
  if (fromMs === null && toMs !== null) return toMs > reqStartMs;

  if (fromMs === toMs) {
    return fromMs! >= reqStartMs && fromMs! <= reqEndMs;
  }
  return fromMs! < reqEndMs && toMs! > reqStartMs;
}

/**
 * Computes any sub-intervals within [reqStartMs, reqEndMs] not covered by the union of
 * valid (non-null value) items that have both valid_from and valid_to.
 */
function findUncoveredIntervals(
  items: EvidenceItem[],
  reqStartMs: number,
  reqEndMs: number,
): Array<{ start: string; end: string }> {
  if (reqEndMs <= reqStartMs) {
    const hasCoveringPoint = items.some((e) => {
      if (e.value === null || e.valid_from === null || e.valid_to === null) return false;
      const s = fromLocalDateTime(e.valid_from).getTime();
      const t = fromLocalDateTime(e.valid_to).getTime();
      return s <= reqStartMs && t >= reqEndMs;
    });
    return hasCoveringPoint
      ? []
      : [{ start: toLocalDateTime(new Date(reqStartMs)), end: toLocalDateTime(new Date(reqEndMs)) }];
  }

  const spans = items
    .filter((e) => e.value !== null && e.valid_from !== null && e.valid_to !== null)
    .map((e) => ({
      start: Math.max(reqStartMs, fromLocalDateTime(e.valid_from!).getTime()),
      end: Math.min(reqEndMs, fromLocalDateTime(e.valid_to!).getTime()),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const gaps: Array<{ start: string; end: string }> = [];
  let cursor = reqStartMs;

  for (const span of spans) {
    if (span.start > cursor) {
      gaps.push({
        start: toLocalDateTime(new Date(cursor)),
        end: toLocalDateTime(new Date(span.start)),
      });
    }
    if (span.end > cursor) {
      cursor = span.end;
    }
  }

  if (cursor < reqEndMs) {
    gaps.push({
      start: toLocalDateTime(new Date(cursor)),
      end: toLocalDateTime(new Date(reqEndMs)),
    });
  }

  return gaps;
}

/** Filters snapshot-level coverage_gaps to those relevant to the park and condition domain. */
function relevantSnapshotGaps(
  snapshotGaps: string[],
  park_id: string,
  domain: "forecast" | "air_quality",
): string[] {
  const otherParks = new Set<string>();
  for (const g of snapshotGaps) {
    const matches = g.match(/\bpark-[a-z0-9-]+\b/gi) ?? [];
    for (const m of matches) {
      if (m !== park_id) otherParks.add(m);
    }
  }

  return snapshotGaps.filter((gap) => {
    const lower = gap.toLowerCase();
    // Exclude gaps explicitly about the other condition domain
    if (domain === "forecast" && (lower.includes("airnow") || lower.includes("aqi") || lower.includes("air quality"))) {
      return false;
    }
    if (domain === "air_quality" && (lower.includes("nws") || lower.includes("forecast") || lower.includes("weather") || lower.includes("temperature"))) {
      // Note: "forecast" can appear in "AQI forecast", so only exclude if not air/aqi
      if (!lower.includes("airnow") && !lower.includes("aqi") && !lower.includes("air")) {
        return false;
      }
    }
    // If the gap mentions a specific park_id, keep it only if it mentions the requested park_id
    if (gap.includes(park_id)) return true;
    for (const other of otherParks) {
      if (gap.includes(other)) return false;
    }
    return true;
  });
}

function conditions(
  ctx: ToolContext,
  input: TimeRangeInput,
  metrics: ConditionMetric[],
  requiredMetrics: ConditionMetric[],
  domain: "forecast" | "air_quality",
) {
  const { park_id, start_time, end_time } = input;
  const reqStartMs = fromLocalDateTime(start_time).getTime();
  const reqEndMs = fromLocalDateTime(end_time).getTime();

  const parkAndMetricItems = ctx.snapshot.items.filter(
    (e): e is EvidenceItem & { metric: ConditionMetric } =>
      metrics.includes(e.metric as ConditionMetric) &&
      (e.applies_to.park_id === park_id || e.applies_to.park_id === null),
  );

  const items = parkAndMetricItems.filter((e) => overlapsWindow(e, reqStartMs, reqEndMs));

  const coverage_gaps: string[] = [...relevantSnapshotGaps(ctx.snapshot.coverage_gaps, park_id, domain)];
  const addGap = (msg: string) => {
    if (!coverage_gaps.includes(msg)) coverage_gaps.push(msg);
  };

  // Report explicit missing_reason from any overlapping item whose value is null
  for (const item of items) {
    if (item.value === null) {
      addGap(
        `${item.metric} missing for ${park_id} (${start_time} to ${end_time}): ${item.missing_reason ?? "no value"}`,
      );
    }
  }

  // Check interval coverage for required metrics and any optional metrics present in the snapshot for this park
  const metricsToCheck = metrics.filter(
    (m) => requiredMetrics.includes(m) || parkAndMetricItems.some((e) => e.metric === m),
  );

  for (const metric of metricsToCheck) {
    const metricItems = items.filter((e) => e.metric === metric);
    const validMetricItems = metricItems.filter((e) => e.value !== null);

    if (validMetricItems.length === 0) {
      // Avoid duplicate gap if we already added an item-level missing_reason gap for this metric
      const alreadyReportedNullItem = metricItems.some((e) => e.value === null);
      if (!alreadyReportedNullItem) {
        addGap(`No ${metric} evidence for ${park_id} covering ${start_time} to ${end_time}`);
      }
      continue;
    }

    const uncovered = findUncoveredIntervals(validMetricItems, reqStartMs, reqEndMs);
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
