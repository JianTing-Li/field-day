import type { EventBrief, EvidenceSnapshot, PlanningOutput } from "@/contracts";
import {
  candidatePlan,
  check,
  checkResult,
  evidence,
  placeholderParks,
  placeholderTemplates,
  referenceEvidence,
} from "./helpers";
import type { ExpectedOutcome } from "./expected";

/**
 * PRD eval Case 10 — The event falls outside available forecast coverage.
 * 45-minute bodyweight class for 15 adults at Park A, 9 a.m. on 2026-11-12, planned on 2026-10-28.
 * NWS hourly forecasts and AirNow forecasts do not reach that date. Space and permission are
 * confirmed. Expected: heat, AQI and freshness checks are unknown (never guessed from climate
 * or today's values), both gaps are shown, the result is needs_verification with a recheck task,
 * and finalization is blocked. No conflict, so no specialist review.
 */

export const SNAPSHOT_ID = "snap-case-10";
const PARK = "park-a";
const START = "2026-11-12T09:00";
const TEMPLATE = "tpl-bodyweight-45";
const CAND = { id: "cand-a-0900", park_id: PARK, start_time: START, end_time: "2026-11-12T09:45" };
const NWS_GAP = "Temperature for 2026-11-12 09:00–09:45: outside the NWS hourly forecast range";
const AQI_GAP = "AQI for 2026-11-12: outside the AirNow forecast range";

export const expected: ExpectedOutcome = {
  case_number: 10,
  title: "The event falls outside available forecast coverage",
  known_feasible: false,
  specialists_run: false,
  final_status: "needs_verification",
  overall: "unknown",
  checks: { "heat.max_temperature": "unknown", "air_quality.max_aqi": "unknown", "freshness.conditions": "unknown" },
  finalize: "blocked",
  gate_failures: ["current_evidence", "hard_constraints"],
  required_gaps: [NWS_GAP, AQI_GAP],
  max_revision_rounds: 0,
  agent_error: null,
  notes: [
    "No temperature or AQI value is invented, estimated from climate, or copied from another date",
    "Organizer task says when to recheck (once the forecast covers the event)",
  ],
};

export const brief: EventBrief = {
  title: "November bodyweight class (Case 10 fixture)",
  date: "2026-11-12",
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
    park_time_candidates: [CAND],
    workout_templates: placeholderTemplates,
    items: [
      ...referenceEvidence(),
      evidence({
        id: "ev-c10-temp-missing",
        metric: "temperature",
        value: null,
        missing_reason: "Event is outside the NWS hourly forecast range",
        source: "NWS (fixture)",
        park_id: PARK,
        scope: "forecast_grid",
        valid_from: START,
        valid_to: "2026-11-12T10:00",
      }),
      evidence({
        id: "ev-c10-aqi-missing",
        metric: "aqi",
        value: null,
        missing_reason: "Event is outside the AirNow forecast range",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-11-12T00:00",
        valid_to: "2026-11-12T23:59",
      }),
      evidence({ id: "ev-c10-space-confirm", metric: "space_confirmation", evidence_type: "organizer_confirmation", value: true, source: "Organizer", park_id: PARK, confirms_check_id: "space_surface.space", limitations: ["Layout: stationary"] }),
      evidence({ id: "ev-c10-permit-confirm", metric: "permission_confirmation", evidence_type: "organizer_confirmation", value: true, source: "Organizer", park_id: PARK, confirms_check_id: "permissions.permit_review" }),
    ],
    coverage_gaps: [NWS_GAP, AQI_GAP],
  };
}

export function planningOutput(event_version: number): PlanningOutput {
  const assessed = { park_id: PARK, start_time: START, workout_template_id: TEMPLATE };
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "needs_verification",
    plan: candidatePlan({
      candidate: CAND,
      workout_template_id: TEMPLATE,
      duration_minutes: 45,
      session_outline: ["Warm-up walk and mobility", "Bodyweight circuit", "Cool-down stretch"],
    }),
    facts: [
      { claim: "Forecast temperature at 9 a.m. on Nov 12", status: "missing", evidence_ids: ["ev-c10-temp-missing"], missing_reason: "Event is outside the NWS hourly forecast range" },
      { claim: "Regional AQI on Nov 12", status: "missing", evidence_ids: ["ev-c10-aqi-missing"], missing_reason: "Event is outside the AirNow forecast range" },
      { claim: "Organizer confirmed stationary workout space at Park A", status: "verified", evidence_ids: ["ev-c10-space-confirm"], missing_reason: null },
    ],
    rule_checks: checkResult(event_version, SNAPSHOT_ID, [
      check(assessed, { check_id: "event_constraints.start_window", area: "event_constraints", status: "pass", reason: "9:00 is within the allowed window" }),
      check(assessed, { check_id: "duration.fits", area: "duration", status: "pass", reason: "Template is 45 minutes" }),
      check(assessed, { check_id: "equipment.available", area: "equipment", status: "pass", reason: "No equipment required" }),
      check(assessed, { check_id: "heat.max_temperature", area: "heat", status: "unknown", reason: "No forecast covers the event yet", evidence_ids: ["ev-c10-temp-missing"] }),
      check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "unknown", reason: "No AQI forecast covers the event yet", evidence_ids: ["ev-c10-aqi-missing"] }),
      check(assessed, { check_id: "freshness.conditions", area: "freshness", status: "unknown", reason: "Conditions evidence does not cover the event interval" }),
      check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "pass", reason: "Organizer confirmed stationary space", evidence_ids: ["ev-c10-space-confirm"] }),
      check(assessed, { check_id: "permissions.permit_review", area: "permissions", status: "pass", reason: "Organizer recorded permit review", evidence_ids: ["ev-c10-permit-confirm"], critical: false }),
    ]),
    concerns: [
      { id: "concern-coverage", description: "Weather and AQI forecasts do not reach the event date", blocking: true, related_check_ids: ["heat.max_temperature", "air_quality.max_aqi", "freshness.conditions"] },
    ],
    organizer_tasks: [
      { id: "task-recheck", description: "Recheck conditions once forecasts cover Nov 12 (NWS hourly reaches about 7 days ahead)", resolves_check_id: "freshness.conditions", park_id: PARK, start_time: START },
    ],
  };
}
