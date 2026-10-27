import type { EventBrief, EvidenceSnapshot, PlanningOutput } from "@/contracts";
import {
  check,
  checkResult,
  evidence,
  placeholderParks,
  placeholderTemplates,
  referenceEvidence,
} from "./helpers";
import type { ExpectedOutcome } from "./expected";

/**
 * PRD eval Case 1 — Normal planning and successful finalization.
 * 45-minute bodyweight class for 15 adults at 9 a.m. Space and permission confirmed,
 * conditions pass. Expected: one evidence-linked draft, no specialist review,
 * finalization succeeds once, repeated finalize creates no duplicate.
 */

export const SNAPSHOT_ID = "snap-case-01";

export const expected: ExpectedOutcome = {
  case_number: 1,
  title: "Normal planning and successful finalization",
  known_feasible: false,
  specialists_run: false,
  final_status: "draft",
  overall: "pass",
  checks: {
    "duration.fits": "pass",
    "equipment.available": "pass",
    "event_constraints.start_window": "pass",
    "heat.max_temperature": "pass",
    "air_quality.max_aqi": "pass",
    "space_surface.space": "pass",
  },
  finalize: "allowed",
  gate_failures: [],
  required_gaps: [],
  max_revision_rounds: 0,
  agent_error: null,
  notes: [
    "Reopening FieldDay preserves the saved draft",
    "Repeated finalize for the same approved version creates exactly 1 finalized event",
    "No booking, publishing or attendee message",
  ],
};
const PARK = "park-a";
const START = "2026-10-29T09:00";
const END = "2026-10-29T09:45";
const TEMPLATE = "tpl-bodyweight-45";

export const brief: EventBrief = {
  title: "Thursday bodyweight class (Case 1 fixture)",
  date: "2026-10-29",
  time_zone: "America/New_York",
  start_window: { earliest: "09:00", latest: "09:00" },
  duration_minutes: 45,
  group_size: 15,
  allowed_park_ids: [PARK],
  preferred_park_id: PARK,
  workout_template_id: TEMPLATE,
  equipment_available: [],
  exercise_exclusions: [],
  instructor_limits: { max_temperature_f: 90, max_aqi: 100, notes: null },
  priorities: [],
};

export function snapshot(event_id: string, event_version: number): EvidenceSnapshot {
  return {
    id: SNAPSHOT_ID,
    event_id,
    event_version,
    created_at: "2026-10-28T12:00:00Z",
    origin: "fixture",
    park_candidates: placeholderParks.filter((p) => p.id === PARK),
    park_time_candidates: [{ id: "cand-a-0900", park_id: PARK, start_time: START, end_time: END }],
    workout_templates: placeholderTemplates,
    items: [
      ...referenceEvidence(),
      evidence({
        id: "ev-c1-temp-0900",
        metric: "temperature",
        value: 62,
        unit: "F",
        source: "NWS (fixture)",
        park_id: PARK,
        scope: "forecast_grid",
        valid_from: START,
        valid_to: "2026-10-29T10:00",
      }),
      evidence({
        id: "ev-c1-aqi-0900",
        metric: "aqi",
        value: 32,
        unit: "AQI",
        category: "Good",
        pollutant: "PM2.5",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-10-29T00:00",
        valid_to: "2026-10-29T23:59",
        limitations: ["Regional reporting-area value, not a park-level measurement"],
      }),
      evidence({
        id: "ev-c1-space-confirm",
        metric: "space_confirmation",
        evidence_type: "organizer_confirmation",
        value: true,
        source: "Organizer",
        park_id: PARK,
        confirms_check_id: "space_surface.space",
      }),
      evidence({
        id: "ev-c1-permit-confirm",
        metric: "permission_confirmation",
        evidence_type: "organizer_confirmation",
        value: true,
        source: "Organizer",
        park_id: PARK,
        confirms_check_id: "permissions.permit_review",
      }),
    ],
    coverage_gaps: [],
  };
}

export function planningOutput(event_version: number): PlanningOutput {
  const assessed = { park_id: PARK, start_time: START, workout_template_id: TEMPLATE };
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "draft",
    plan: {
      park_time_candidate_id: "cand-a-0900",
      park_id: PARK,
      start_time: START,
      time_zone: "America/New_York",
      duration_minutes: 45,
      workout_template_id: TEMPLATE,
      adaptation_ids: [],
      session_outline: ["Warm-up walk and mobility", "Bodyweight circuit", "Cool-down stretch"],
    },
    facts: [
      {
        claim: "Forecast temperature at 9 a.m. is 62°F",
        status: "verified",
        evidence_ids: ["ev-c1-temp-0900"],
        missing_reason: null,
      },
      {
        claim: "Regional AQI is 32 (Good) for New York City",
        status: "verified",
        evidence_ids: ["ev-c1-aqi-0900"],
        missing_reason: null,
      },
      {
        claim: "Organizer confirmed stationary workout space at Park A",
        status: "verified",
        evidence_ids: ["ev-c1-space-confirm"],
        missing_reason: null,
      },
    ],
    rule_checks: checkResult(event_version, SNAPSHOT_ID, [
      check(assessed, { check_id: "event_constraints.start_window", area: "event_constraints", status: "pass", reason: "9:00 is within the allowed window" }),
      check(assessed, { check_id: "duration.fits", area: "duration", status: "pass", reason: "Template is 45 minutes" }),
      check(assessed, { check_id: "equipment.available", area: "equipment", status: "pass", reason: "No equipment required" }),
      check(assessed, { check_id: "heat.max_temperature", area: "heat", status: "pass", reason: "62°F is below the 90°F fixture limit", evidence_ids: ["ev-c1-temp-0900"] }),
      check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "pass", reason: "AQI 32 is below the 100 fixture limit", evidence_ids: ["ev-c1-aqi-0900"] }),
      check(assessed, { check_id: "freshness.conditions", area: "freshness", status: "pass", reason: "Fixture evidence covers the full event interval" }),
      check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "pass", reason: "Organizer confirmed stationary space", evidence_ids: ["ev-c1-space-confirm"] }),
      check(assessed, { check_id: "permissions.permit_review", area: "permissions", status: "pass", reason: "Organizer recorded permit review", evidence_ids: ["ev-c1-permit-confirm"], critical: false }),
    ]),
    concerns: [],
    organizer_tasks: [],
  };
}
