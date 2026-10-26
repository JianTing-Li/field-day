import { z } from "zod";

/** Shared primitives used across all contracts. */

/** Every FieldDay event is in New York. Stored explicitly so it is never inferred. */
export const TIME_ZONE = "America/New_York" as const;
export const TimeZone = z.literal(TIME_ZONE);

/** Calendar date, e.g. "2026-10-29". */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** Wall-clock time in the event time zone, e.g. "08:00". */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24h)");

/** Local date-time in the event time zone, no offset, e.g. "2026-10-29T08:00". */
export const LocalDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, "Expected YYYY-MM-DDTHH:MM");

/** Absolute timestamp with offset, e.g. "2026-10-26T14:05:00Z". Used for retrieval/audit times. */
export const Timestamp = z.iso.datetime({ offset: true });

/** Result of a single validation check. Unknown is never treated as pass. */
export const CheckStatus = z.enum(["pass", "fail", "unknown"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

/** Whether data came from a live integration or a labeled fixture. */
export const DataOrigin = z.enum(["live", "fixture"]);
export type DataOrigin = z.infer<typeof DataOrigin>;

export const Id = z.string().min(1);
