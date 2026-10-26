import { z } from "zod";
import { Id } from "./common";
import { EventBrief } from "./brief";
import { EvidenceSnapshot } from "./evidence";
import { EventSummary, FieldDayEvent, GateCheck } from "./event";

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
      "upstream_unavailable",
      "internal",
    ]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

const EventResponse = z.object({ event: FieldDayEvent });

/** Organizer's "Something changed" report. */
export const ChangeReport = z.object({
  kind: z.enum(["time_unavailable", "park_issue", "workout_issue", "conditions", "other"]),
  description: z.string().min(1),
});
export type ChangeReport = z.infer<typeof ChangeReport>;

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
  /** POST /api/events/:id/review — organizer requests conflict review without a new change. */
  requestReview: {
    method: "POST",
    path: "/api/events/:id/review",
    request: z.object({ version: z.number().int().positive() }),
    response: EventResponse,
  },
  /** POST /api/events/:id/apply-option — adopts a reviewed combined option as a new draft version. */
  applyOption: {
    method: "POST",
    path: "/api/events/:id/apply-option",
    request: z.object({ version: z.number().int().positive(), combined_option_id: Id }),
    response: EventResponse,
  },
  /** POST /api/events/:id/confirmations — records a confirmation for one check. */
  addConfirmation: {
    method: "POST",
    path: "/api/events/:id/confirmations",
    request: z.object({
      version: z.number().int().positive(),
      check_id: z.string().min(1),
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
