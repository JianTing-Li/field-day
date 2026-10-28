import type { CandidatePlan, EvidenceItem } from "@/contracts";
import { fromLocalDateTime, toLocalDateTime } from "@/server/time";

/**
 * Time-window coverage helpers (owner: JT). Shared by the agent tools (JT-02), the freshness
 * rule (JT-03) and the heat/AQI rules (JT-04) so every caller agrees on what "covered" means.
 * Valid periods are half-open [valid_from, valid_to) in New York local time (D-019).
 */

export interface Window {
  startMs: number;
  endMs: number;
}

/**
 * True when the item's valid period overlaps [startMs, endMs). An hour ending at 09:00 does not
 * overlap a window starting at 09:00. Missing bounds are open-ended.
 */
export function overlapsWindow(item: EvidenceItem, startMs: number, endMs: number): boolean {
  const fromMs = item.valid_from !== null ? fromLocalDateTime(item.valid_from).getTime() : null;
  const toMs = item.valid_to !== null ? fromLocalDateTime(item.valid_to).getTime() : null;

  if (fromMs !== null && toMs !== null && fromMs === toMs) {
    // Point-in-time value (e.g. an observation): include it when it falls inside the window.
    return fromMs >= startMs && fromMs < endMs;
  }
  return (fromMs === null || fromMs < endMs) && (toMs === null || toMs > startMs);
}

/**
 * Sub-intervals of [startMs, endMs) not covered by the union of the given items' valid
 * periods. Items without both bounds, and point-in-time items, cover nothing.
 */
export function findUncoveredIntervals(
  items: EvidenceItem[],
  startMs: number,
  endMs: number,
): Array<{ start: string; end: string }> {
  const spans = items
    .filter((e) => e.valid_from !== null && e.valid_to !== null)
    .map((e) => ({
      start: Math.max(startMs, fromLocalDateTime(e.valid_from!).getTime()),
      end: Math.min(endMs, fromLocalDateTime(e.valid_to!).getTime()),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const gaps: Array<{ start: string; end: string }> = [];
  let cursor = startMs;

  for (const span of spans) {
    if (span.start > cursor) {
      gaps.push({ start: toLocalDateTime(new Date(cursor)), end: toLocalDateTime(new Date(span.start)) });
    }
    if (span.end > cursor) cursor = span.end;
  }

  if (cursor < endMs) {
    gaps.push({ start: toLocalDateTime(new Date(cursor)), end: toLocalDateTime(new Date(endMs)) });
  }

  return gaps;
}

/** The event interval a plan occupies, or null when park, start time or duration is unknown. */
export function planWindow(plan: CandidatePlan): Window | null {
  if (plan.park_id === null || plan.start_time === null || plan.duration_minutes === null) return null;
  const startMs = fromLocalDateTime(plan.start_time).getTime();
  return { startMs, endMs: startMs + plan.duration_minutes * 60_000 };
}

/** "2026-10-29T09:00" + 45 -> "2026-10-29T09:45", across daylight-saving changes. */
export function addMinutes(local: string, minutes: number): string {
  return toLocalDateTime(new Date(fromLocalDateTime(local).getTime() + minutes * 60_000));
}

/** Evidence of one metric for a park: the park's own items plus regional items tied to no park. */
export function itemsForPark(items: EvidenceItem[], park_id: string, metric: EvidenceItem["metric"]): EvidenceItem[] {
  return items.filter(
    (e) => e.metric === metric && (e.applies_to.park_id === park_id || e.applies_to.park_id === null),
  );
}
