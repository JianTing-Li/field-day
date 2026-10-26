import { z } from "zod";
import { DataOrigin, Id, LocalDateTime, Timestamp } from "./common";

/**
 * Common evidence contract (PRD §3 "Common evidence contract").
 * Every fact an agent or the UI shows must trace back to one of these.
 */

export const EvidenceType = z.enum([
  "observation",
  "forecast",
  "organizer_confirmation",
  /** Static records: park listings, workout templates. */
  "reference",
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

/** What the evidence measures or records. Rules read evidence by metric. */
export const EvidenceMetric = z.enum([
  "temperature",
  "precipitation_probability",
  "wind_speed",
  "aqi",
  "park_record",
  "workout_template",
  "space_confirmation",
  "surface_confirmation",
  "permission_confirmation",
]);
export type EvidenceMetric = z.infer<typeof EvidenceMetric>;

export const EvidenceSource = z.object({
  /** e.g. "NWS", "AirNow", "NYC Parks Open Data", "Organizer", "FieldDay templates". */
  name: z.string().min(1),
  url: z.string().nullable(),
  /** Provider record ID where one exists (e.g. Parks property ID, NWS grid point). */
  record_id: z.string().nullable(),
});

export const EvidenceScope = z.enum(["park", "reporting_area", "forecast_grid", "event"]);

export const EvidenceApplicability = z.object({
  scope: EvidenceScope,
  /** Park this evidence was assessed for. Null for regional evidence not tied to one park. */
  park_id: Id.nullable(),
  /** AirNow reporting area, NWS grid ID, etc. */
  area_label: z.string().nullable(),
});

export const Freshness = z.object({
  status: z.enum(["fresh", "stale", "unknown"]),
  /** Set by the harness when it assesses freshness/coverage. */
  assessed_at: Timestamp.nullable(),
  note: z.string().nullable(),
});

export const EvidenceItem = z
  .object({
    id: Id,
    metric: EvidenceMetric,
    evidence_type: EvidenceType,
    origin: DataOrigin,
    source: EvidenceSource,
    /** Numeric/text/boolean value. Null only when missing_reason explains why. */
    value: z.union([z.number(), z.string(), z.boolean()]).nullable(),
    unit: z.string().nullable(),
    /** e.g. AQI category "Moderate". */
    category: z.string().nullable(),
    /** e.g. AQI pollutant "PM2.5". */
    pollutant: z.string().nullable(),
    missing_reason: z.string().nullable(),
    retrieved_at: Timestamp,
    /** Period the value applies to, in event-local time. Null for timeless records. */
    valid_from: LocalDateTime.nullable(),
    valid_to: LocalDateTime.nullable(),
    applies_to: EvidenceApplicability,
    freshness: Freshness,
    limitations: z.array(z.string()),
    /** Organizer confirmations only: the single check this confirmation resolves. */
    confirms_check_id: z.string().nullable(),
  })
  .refine((e) => e.value !== null || e.missing_reason !== null, {
    message: "Evidence with no value must give a missing_reason",
    path: ["missing_reason"],
  });
export type EvidenceItem = z.infer<typeof EvidenceItem>;

/** A concrete park + start time the harness allows agents to assess. */
export const ParkTimeCandidate = z.object({
  id: Id,
  park_id: Id,
  start_time: LocalDateTime,
  end_time: LocalDateTime,
});
export type ParkTimeCandidate = z.infer<typeof ParkTimeCandidate>;

export const ParkCandidate = z.object({
  id: Id,
  name: z.string().min(1),
  borough: z.string().min(1),
  acreage: z.number().nullable(),
  /** Reviewed coordinate used for NWS/AirNow lookups. Null if not yet reviewed. */
  location: z.object({ lat: z.number(), lon: z.number() }).nullable(),
  /** Links to the EvidenceItem (metric park_record) describing the source record. */
  evidence_id: Id,
  /** Known gaps, e.g. "usable space not confirmed". Acreage never proves space. */
  unknowns: z.array(z.string()),
});
export type ParkCandidate = z.infer<typeof ParkCandidate>;

export const Intensity = z.enum(["low", "moderate", "high"]);

export const WorkoutTemplate = z.object({
  id: Id,
  name: z.string().min(1),
  duration_minutes: z.number().int().positive(),
  intensity: Intensity,
  exercises: z.array(
    z.object({
      name: z.string().min(1),
      minutes: z.number().positive().nullable(),
      intensity: Intensity,
    }),
  ),
  equipment: z.array(z.string()),
  space: z.object({
    layout: z.enum(["stationary", "running_lane", "open_field", "loop_path"]),
    min_area_sq_m: z.number().positive().nullable(),
  }),
  surfaces: z.array(z.string()),
  group_size: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
  permitted_adaptations: z.array(
    z.object({
      id: Id,
      description: z.string().min(1),
      /** What the adaptation changes, e.g. "replaces running intervals with stationary circuit". */
      effect: z.string().min(1),
      resulting_layout: z.enum(["stationary", "running_lane", "open_field", "loop_path"]).nullable(),
      duration_delta_minutes: z.number().int(),
    }),
  ),
  review: z.object({
    status: z.enum(["placeholder", "pending_instructor_review", "reviewed"]),
    reviewer: z.string().nullable(),
    reviewed_at: Timestamp.nullable(),
  }),
  evidence_id: Id,
});
export type WorkoutTemplate = z.infer<typeof WorkoutTemplate>;

/**
 * Evidence snapshot: everything agents may read for one assessment.
 * Built by the harness; agent tools read it and never fetch newer data.
 */
export const EvidenceSnapshot = z.object({
  id: Id,
  event_id: Id,
  event_version: z.number().int().positive(),
  created_at: Timestamp,
  origin: DataOrigin,
  park_candidates: z.array(ParkCandidate),
  park_time_candidates: z.array(ParkTimeCandidate),
  workout_templates: z.array(WorkoutTemplate),
  items: z.array(EvidenceItem),
  coverage_gaps: z.array(z.string()),
});
export type EvidenceSnapshot = z.infer<typeof EvidenceSnapshot>;
