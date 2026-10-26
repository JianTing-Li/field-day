import { TIME_ZONE } from "@/contracts";

/**
 * Converts between provider timestamps (with offsets) and the contracts' event-local
 * LocalDateTime ("YYYY-MM-DDTHH:MM", America/New_York). Use these instead of hand-rolled
 * offset math so daylight-saving changes are handled the same way everywhere.
 */

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2026-07-16T12:00:00Z" or "2026-07-16T08:00:00-04:00" -> "2026-07-16T08:00" (New York time). */
export function toLocalDateTime(timestamp: string | Date): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${String(timestamp)}`);
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "2026-07-16T08:00" (New York time) -> the matching instant as a Date. */
export function fromLocalDateTime(local: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`Invalid LocalDateTime: ${local}`);
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Offset of New York from UTC at (approximately) that instant, then correct once.
  const offsetAt = (ms: number) => Date.parse(`${toLocalDateTime(new Date(ms))}:00Z`) - ms;
  const guess = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(guess));
}
