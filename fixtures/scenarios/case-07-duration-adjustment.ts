import type {
  EventBrief,
  EvidenceSnapshot,
  LogisticsOutput,
  PlanningOutput,
  ReviewerOutput,
  WorkoutOutput,
} from "@/contracts";
import {
  candidatePlan,
  check,
  checkResult,
  evidence,
  fixtureTemplate,
  placeholderParks,
  referenceEvidence,
} from "./helpers";
import type { ExpectedOutcome } from "./expected";

/**
 * PRD eval Case 7 — Approved session adjustment resolves a duration conflict.
 * The organizer picks a 60-minute strength template but the class is 45 minutes (Park A, 7:30 a.m.,
 * 10 adults). The template permits an approved adjustment that drops one 15-minute block.
 * Conditions pass and stationary space is confirmed. Expected: Workout Adaptation applies the
 * adjustment so the session is 45 minutes; Logistics finds no place/time fix; the Reviewer
 * recommends it and every critical check passes. The template is fixture-only.
 */

export const SNAPSHOT_ID = "snap-case-07";
const PARK = "park-a";
const ADJUST = "adapt-fx-drop-block-15";
const CAND = { id: "cand-a-0730", park_id: PARK, start_time: "2026-11-02T07:30", end_time: "2026-11-02T08:15" };

export const STRENGTH = fixtureTemplate({
  id: "tpl-fx-strength-60",
  name: "Full-body strength, 60 minutes (fixture)",
  duration_minutes: 60,
  intensity: "moderate",
  exercises: [
    { name: "Warm-up and mobility", minutes: 10, intensity: "low" },
    { name: "Lower-body block", minutes: 15, intensity: "moderate" },
    { name: "Upper-body block", minutes: 15, intensity: "moderate" },
    { name: "Core block", minutes: 15, intensity: "moderate" },
    { name: "Cool-down stretch", minutes: 5, intensity: "low" },
  ],
  equipment: [],
  space: { layout: "stationary", min_area_sq_m: null },
  surfaces: ["grass", "paved"],
  permitted_adaptations: [
    {
      id: ADJUST,
      description: "Drop the core block",
      effect: "Removes one 15-minute block; warm-up and cool-down unchanged",
      resulting_layout: null,
      duration_delta_minutes: -15,
    },
  ],
});

export const expected: ExpectedOutcome = {
  case_number: 7,
  title: "Approved session adjustment resolves a duration conflict",
  known_feasible: true,
  specialists_run: true,
  final_status: "draft",
  overall: "pass",
  checks: { "duration.fits": "pass", "equipment.available": "pass", "space_surface.space": "pass", "space_surface.surface": "pass" },
  finalize: "allowed",
  gate_failures: [],
  required_gaps: [],
  max_revision_rounds: 1,
  agent_error: null,
  notes: [
    "Recommended option applies adapt-fx-drop-block-15 (60 − 15 = 45 minutes); warm-up and cool-down are kept",
    "No unapproved shortening (e.g. cutting the warm-up) is proposed",
  ],
};

export const brief: EventBrief = {
  title: "Early strength class (Case 7 fixture)",
  date: "2026-11-02",
  time_zone: "America/New_York",
  start_window: { earliest: "07:30", latest: "07:30" },
  duration_minutes: 45,
  group_size: 10,
  allowed_park_ids: [PARK],
  preferred_park_id: PARK,
  workout_template_id: STRENGTH.id,
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
    workout_templates: [STRENGTH],
    items: [
      ...referenceEvidence(undefined, [STRENGTH]),
      evidence({ id: "ev-c7-temp-0730", metric: "temperature", value: 49, unit: "F", source: "NWS (fixture)", park_id: PARK, scope: "forecast_grid", valid_from: "2026-11-02T07:00", valid_to: "2026-11-02T09:00" }),
      evidence({
        id: "ev-c7-aqi",
        metric: "aqi",
        value: 28,
        unit: "AQI",
        category: "Good",
        pollutant: "PM2.5",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-11-02T00:00",
        valid_to: "2026-11-02T23:59",
        limitations: ["Regional reporting-area value, not a park-level measurement"],
      }),
      evidence({ id: "ev-c7-space-confirm", metric: "space_confirmation", evidence_type: "organizer_confirmation", value: true, source: "Organizer", park_id: PARK, confirms_check_id: "space_surface.space", category: "stationary" }),
      evidence({ id: "ev-c7-surface-confirm", metric: "surface_confirmation", evidence_type: "organizer_confirmation", value: "grass", source: "Organizer", park_id: PARK, confirms_check_id: "space_surface.surface" }),
    ],
    coverage_gaps: [],
  };
}

function plan(adjusted: boolean) {
  return candidatePlan({
    candidate: CAND,
    workout_template_id: STRENGTH.id,
    duration_minutes: adjusted ? 45 : 60,
    adaptation_ids: adjusted ? [ADJUST] : [],
    session_outline: adjusted
      ? ["Warm-up and mobility", "Lower-body block", "Upper-body block", "Cool-down stretch"]
      : ["Warm-up and mobility", "Lower-body block", "Upper-body block", "Core block", "Cool-down stretch"],
  });
}

function checksFor(event_version: number, adjusted: boolean) {
  const assessed = { park_id: PARK, start_time: CAND.start_time, workout_template_id: STRENGTH.id };
  return checkResult(event_version, SNAPSHOT_ID, [
    check(assessed, { check_id: "event_constraints.start_window", area: "event_constraints", status: "pass", reason: "7:30 is within the allowed window" }),
    check(assessed, {
      check_id: "duration.fits",
      area: "duration",
      status: adjusted ? "pass" : "fail",
      reason: adjusted ? "60-minute template minus the approved 15-minute adjustment is 45 minutes" : "Template is 60 minutes; the class is 45",
      evidence_ids: [STRENGTH.evidence_id],
    }),
    check(assessed, { check_id: "equipment.available", area: "equipment", status: "pass", reason: "No equipment required" }),
    check(assessed, { check_id: "heat.max_temperature", area: "heat", status: "pass", reason: "49°F is below the 90°F fixture limit", evidence_ids: ["ev-c7-temp-0730"] }),
    check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "pass", reason: "Regional AQI 28 is below the 100 fixture limit", evidence_ids: ["ev-c7-aqi"] }),
    check(assessed, { check_id: "freshness.conditions", area: "freshness", status: "pass", reason: "Fixture evidence covers the full event interval" }),
    check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "pass", reason: "Organizer confirmed stationary space at Park A", evidence_ids: ["ev-c7-space-confirm"] }),
    check(assessed, { check_id: "space_surface.surface", area: "space_surface", status: "pass", reason: "Organizer confirmed a grass surface at Park A", evidence_ids: ["ev-c7-surface-confirm"] }),
    check(assessed, { check_id: "permissions.permit_review", area: "permissions", status: "unknown", reason: "Group of 10 is below the 20-or-more permit-review flag; group size alone does not show whether permission is needed, and permit status is not recorded", critical: false }),
  ]);
}

export function planningOutput(event_version: number): PlanningOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "needs_verification",
    plan: plan(false),
    facts: [
      { claim: "The selected template runs 60 minutes; the class is 45 minutes", status: "verified", evidence_ids: [STRENGTH.evidence_id], missing_reason: null },
    ],
    rule_checks: checksFor(event_version, false),
    concerns: [
      { id: "concern-duration", description: "Template is 15 minutes longer than the class", blocking: true, related_check_ids: ["duration.fits"] },
    ],
    organizer_tasks: [],
  };
}

export function logisticsOutput(event_version: number): LogisticsOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "no_feasible_option",
    options: [],
    concerns: [
      { id: "concern-log-duration", description: "A park or time change does not shorten the session", blocking: true, related_check_ids: ["duration.fits"] },
    ],
    organizer_tasks: [],
  };
}

export function workoutOutput(event_version: number): WorkoutOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "options_proposed",
    options: [
      {
        option_id: "wo-1",
        specialist: "workout",
        park_time_candidate_ids: [CAND.id],
        plan: plan(true),
        changes: [
          { field: "adaptation", from: null, to: ADJUST },
          { field: "duration", from: "60", to: "45" },
        ],
        assumptions: ["Assessed at the current park and time: Park A, 7:30 a.m."],
        requirements: ["Stationary space at Park A"],
        dependencies: [],
        evidence_ids: [STRENGTH.evidence_id, "ev-c7-space-confirm"],
        unknowns: [],
        checks: checksFor(event_version, true),
      },
    ],
    concerns: [],
    organizer_tasks: [],
  };
}

export function reviewerOutput(event_version: number): ReviewerOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "draft",
    ranked_options: [
      {
        combined_option_id: "combo-1",
        logistics_option_id: null,
        workout_option_id: "wo-1",
        park_time_candidate_id: CAND.id,
        plan: plan(true),
        changes_from_original: [
          { field: "adaptation", from: null, to: ADJUST },
          { field: "duration", from: "60", to: "45" },
        ],
        tradeoffs: ["Core block dropped", "Same park and time"],
        evidence_ids: [STRENGTH.evidence_id, "ev-c7-temp-0730", "ev-c7-aqi", "ev-c7-space-confirm"],
        checks: checksFor(event_version, true),
        unknowns: [],
      },
    ],
    recommendation: { combined_option_id: "combo-1", reason: "Approved adjustment fits the 45-minute class; passes every critical check" },
    revision_requests: [],
    blocking_issues: [],
    organizer_tasks: [],
  };
}
