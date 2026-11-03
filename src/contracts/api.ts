import { z } from "zod";
import { CheckId, Id, IsoDate, LocalDateTime, LocalTime } from "./common";
import { EventBrief } from "./brief";
import { EvidenceSnapshot } from "./evidence";
import { ChangeKind, EventSummary, FieldDayEvent, GateCheck } from "./event";

/**
 * HTTP API between the UI (Yadan) and the harness (JT). Routes live in src/app/api/.
 * Drafts are saved on every successful call; there is no separate "save draft" request.
 */

export const ApiError = z.object({
  error: z.object({
    code: z.enum([
      "invalid_request",
      "not_found",
      "stale_version",
      "blocked",
      "budget_exhausted",
      /** Too many agent runs from this visitor or for the demo today (JT-19). */
      "rate_limited",
      "upstream_unavailable",
      "internal",
    ]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

const EventResponse = z.object({ event: FieldDayEvent });

/**
 * Organizer's "Something changed" report. With `check_id` it is a fact the checks use (D-JT24-12):
 * that check fails at `park_id` (null = every park) and `start_time` (null = any time). Without it,
 * it is context for the agents only.
 */
export const ChangeReport = z.object({
  kind: ChangeKind,
  description: z.string().min(1),
  check_id: CheckId.nullable().optional(),
  park_id: Id.nullable().optional(),
  start_time: LocalDateTime.nullable().optional(),
});
export type ChangeReport = z.infer<typeof ChangeReport>;

/**
 * One change read from what the organizer typed under "Something changed?" (JT-28, D-JT28-1).
 * `said` is the part of their words it came from. A `note` is something FieldDay can't act on;
 * `reply` says so in plain words. The organizer sees the whole list and confirms before anything
 * changes.
 */
const said = z.string().min(1).max(300);
export const ChangeItem = z.discriminatedUnion("type", [
  /** Fails one reportable check at the plan's park (space, ground) or time (rain, time). */
  z.object({ type: z.literal("report"), what: z.enum(["space", "ground", "rain", "time"]), said }),
  z.object({ type: z.literal("start_window"), earliest: LocalTime, latest: LocalTime, said }),
  z.object({ type: z.literal("date"), date: IsoDate, said }),
  z.object({ type: z.literal("group_size"), group_size: z.number().int().positive(), said }),
  z.object({ type: z.literal("duration"), duration_minutes: z.number().int().positive(), said }),
  /** Values from the brief's equipment list. */
  z.object({ type: z.literal("equipment_missing"), equipment: z.array(z.string().min(1)).min(1).max(20), said }),
  z.object({ type: z.literal("avoid_exercises"), exercises: z.array(z.string().min(1).max(100)).min(1).max(10), said }),
  /** One of the brief's allowed parks, dropped from the list. */
  z.object({ type: z.literal("avoid_park"), park_id: Id, said }),
  z.object({ type: z.literal("note"), said, reply: z.string().min(1).max(300) }),
]);
export type ChangeItem = z.infer<typeof ChangeItem>;

export const Api = {
  /** GET /api/events */
  listEvents: {
    method: "GET",
    path: "/api/events",
    request: z.void(),
    response: z.object({ events: z.array(EventSummary) }),
  },
  /** POST /api/events — creates an event with version 1 (status draft, no plan yet). */
  createEvent: {
    method: "POST",
    path: "/api/events",
    request: z.object({ brief: EventBrief }),
    response: EventResponse,
  },
  /** GET /api/events/:id */
  getEvent: {
    method: "GET",
    path: "/api/events/:id",
    request: z.void(),
    response: z.object({ event: FieldDayEvent, snapshot: EvidenceSnapshot.nullable() }),
  },
  /** PUT /api/events/:id/brief — editing creates a new draft version and invalidates approval. */
  updateBrief: {
    method: "PUT",
    path: "/api/events/:id/brief",
    request: z.object({ brief: EventBrief, based_on_version: z.number().int().positive() }),
    response: EventResponse,
  },
  /** POST /api/events/:id/generate — runs the Planning Agent. */
  generateDraft: {
    method: "POST",
    path: "/api/events/:id/generate",
    request: z.object({ version: z.number().int().positive() }),
    response: EventResponse,
  },
  /** POST /api/events/:id/recheck — refreshes evidence and revalidates the current plan. */
  recheck: {
    method: "POST",
    path: "/api/events/:id/recheck",
    request: z.object({ version: z.number().int().positive() }),
    response: EventResponse,
  },
  /** POST /api/events/:id/changes — organizer reports a change; triggers conflict review. */
  reportChange: {
    method: "POST",
    path: "/api/events/:id/changes",
    request: z.object({ version: z.number().int().positive(), change: ChangeReport }),
    response: EventResponse,
  },
  /**
   * POST /api/events/:id/changes/read — reads what the organizer typed into a list of changes
   * (JT-28). Changes nothing; the organizer confirms the list with applyChanges.
   */
  readChanges: {
    method: "POST",
    path: "/api/events/:id/changes/read",
    request: z.object({ version: z.number().int().positive(), text: z.string().min(1).max(1000) }),
    response: z.object({ items: z.array(ChangeItem), read_by: z.enum(["model", "rules"]) }),
  },
  /**
   * POST /api/events/:id/changes/apply — applies confirmed changes in one go (JT-28): brief changes
   * re-plan once, reports re-check and look for a fix, and notes are only kept.
   */
  applyChanges: {
    method: "POST",
    path: "/api/events/:id/changes/apply",
    request: z.object({ version: z.number().int().positive(), items: z.array(ChangeItem).min(1).max(20) }),
    response: EventResponse,
  },
  /** POST /api/events/:id/review — organizer requests conflict review without a new change. */
  requestReview: {
    method: "POST",
    path: "/api/events/:id/review",
    request: z.object({ version: z.number().int().positive() }),
    response: EventResponse,
  },
  /** POST /api/events/:id/changes/remove — withdraws a report; the plan is checked again as a new version. */
  removeReport: {
    method: "POST",
    path: "/api/events/:id/changes/remove",
    request: z.object({ version: z.number().int().positive(), report_id: Id }),
    response: EventResponse,
  },
  /** POST /api/events/:id/apply-option — adopts a reviewed combined option as a new draft version. */
  applyOption: {
    method: "POST",
    path: "/api/events/:id/apply-option",
    request: z.object({ version: z.number().int().positive(), combined_option_id: Id }),
    response: EventResponse,
  },
  /** POST /api/events/:id/confirmations — records a confirmation for one check at one park (and time). */
  addConfirmation: {
    method: "POST",
    path: "/api/events/:id/confirmations",
    request: z.object({
      version: z.number().int().positive(),
      check_id: CheckId,
      park_id: Id,
      start_time: LocalDateTime.nullable(),
      statement: z.string().min(1),
      note: z.string().nullable(),
    }),
    response: EventResponse,
  },
  /** POST /api/events/:id/approve — approves an exact version + snapshot. */
  approve: {
    method: "POST",
    path: "/api/events/:id/approve",
    request: z.object({ version: z.number().int().positive(), evidence_snapshot_id: Id }),
    response: EventResponse,
  },
  /** POST /api/events/:id/finalize — runs the final save gate. Idempotent per approved version. */
  finalize: {
    method: "POST",
    path: "/api/events/:id/finalize",
    request: z.object({ version: z.number().int().positive(), idempotency_key: z.string().min(1) }),
    response: z.object({ event: FieldDayEvent, gate: z.array(GateCheck), finalized: z.boolean() }),
  },
} as const;

export type ApiName = keyof typeof Api;
export type ApiRequest<N extends ApiName> = z.infer<(typeof Api)[N]["request"]>;
export type ApiResponse<N extends ApiName> = z.infer<(typeof Api)[N]["response"]>;
