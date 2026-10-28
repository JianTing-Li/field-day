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
 * PRD eval Case 6 — Approved workout substitution resolves an equipment conflict.
 * 45-minute kettlebell class for 14 adults at Park A, 9 a.m. The organizer no longer has
 * kettlebells (equipment list is empty). An approved 45-minute bodyweight template exists.
 * Conditions pass and stationary space at Park A is confirmed. Expected: Workout Adaptation
 * substitutes the bodyweight template; Logistics finds no place/time fix; the Reviewer
 * recommends the substitution and every critical check passes.
 * Both templates are fixture-only so changes to workouts.json never change this case.
 */

export const SNAPSHOT_ID = "snap-case-06";
const PARK = "park-a";
const CAND = { id: "cand-a-0900", park_id: PARK, start_time: "2026-10-30T09:00", end_time: "2026-10-30T09:45" };

export const KETTLEBELL = fixtureTemplate({
  id: "tpl-fx-kettlebell-45",
  name: "Kettlebell strength (fixture)",
  duration_minutes: 45,
  intensity: "moderate",
  exercises: [
    { name: "Warm-up and mobility", minutes: 8, intensity: "low" },
    { name: "Kettlebell swings and goblet squats", minutes: 30, intensity: "moderate" },
    { name: "Cool-down stretch", minutes: 7, intensity: "low" },
  ],
  equipment: ["kettlebell"],
  space: { layout: "stationary", min_area_sq_m: null },
  surfaces: ["grass", "paved"],
});

export const BODYWEIGHT = fixtureTemplate({
  id: "tpl-fx-bodyweight-45",
  name: "Bodyweight strength (fixture)",
  duration_minutes: 45,
  intensity: "moderate",
  exercises: [
    { name: "Warm-up and mobility", minutes: 8, intensity: "low" },
    { name: "Squats, lunges and push-ups", minutes: 30, intensity: "moderate" },
    { name: "Cool-down stretch", minutes: 7, intensity: "low" },
  ],
  equipment: [],
  space: { layout: "stationary", min_area_sq_m: null },
  surfaces: ["grass", "paved"],
});

export const expected: ExpectedOutcome = {
  case_number: 6,
  title: "Approved workout substitution resolves an equipment conflict",
  known_feasible: true,
  specialists_run: true,
  final_status: "draft",
  overall: "pass",
  checks: { "equipment.available": "pass", "duration.fits": "pass", "space_surface.space": "pass", "space_surface.surface": "pass" },
  finalize: "allowed",
  gate_failures: [],
  required_gaps: [],
  max_revision_rounds: 1,
  agent_error: null,
  notes: [
    "Recommended option swaps tpl-fx-kettlebell-45 for tpl-fx-bodyweight-45; park and time unchanged",
    "Only approved templates from the snapshot are used; no invented exercises or equipment",
  ],
};

export const brief: EventBrief = {
  title: "Kettlebell class (Case 6 fixture)",
  date: "2026-10-30",
  time_zone: "America/New_York",
  start_window: { earliest: "09:00", latest: "09:00" },
  duration_minutes: 45,
  group_size: 14,
  allowed_park_ids: [PARK],
  preferred_park_id: PARK,
  workout_template_id: KETTLEBELL.id,
  equipment_available: [],
  exercise_exclusions: [],
  instructor_limits: { max_temperature_f: 90, max_aqi: 100, notes: "Kettlebells unavailable this week" },
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
    workout_templates: [KETTLEBELL, BODYWEIGHT],
    items: [
      ...referenceEvidence(undefined, [KETTLEBELL, BODYWEIGHT]),
      evidence({ id: "ev-c6-temp-0900", metric: "temperature", value: 60, unit: "F", source: "NWS (fixture)", park_id: PARK, scope: "forecast_grid", valid_from: "2026-10-30T09:00", valid_to: "2026-10-30T10:00" }),
      evidence({
        id: "ev-c6-aqi",
        metric: "aqi",
        value: 35,
        unit: "AQI",
        category: "Good",
        pollutant: "PM2.5",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-10-30T00:00",
        valid_to: "2026-10-30T23:59",
        limitations: ["Regional reporting-area value, not a park-level measurement"],
      }),
      evidence({ id: "ev-c6-space-confirm", metric: "space_confirmation", evidence_type: "organizer_confirmation", value: true, source: "Organizer", park_id: PARK, confirms_check_id: "space_surface.space", category: "stationary" }),
      evidence({ id: "ev-c6-surface-confirm", metric: "surface_confirmation", evidence_type: "organizer_confirmation", value: "grass", source: "Organizer", park_id: PARK, confirms_check_id: "space_surface.surface" }),
    ],
    coverage_gaps: [],
  };
}

function plan(templateId: string) {
  return candidatePlan({
    candidate: CAND,
    workout_template_id: templateId,
    duration_minutes: 45,
    session_outline:
      templateId === KETTLEBELL.id
        ? ["Warm-up and mobility", "Kettlebell swings and goblet squats", "Cool-down stretch"]
        : ["Warm-up and mobility", "Squats, lunges and push-ups", "Cool-down stretch"],
  });
}

function checksFor(event_version: number, templateId: string) {
  const assessed = { park_id: PARK, start_time: CAND.start_time, workout_template_id: templateId };
  const needsKettlebells = templateId === KETTLEBELL.id;
  return checkResult(event_version, SNAPSHOT_ID, [
    check(assessed, { check_id: "event_constraints.start_window", area: "event_constraints", status: "pass", reason: "9:00 is within the allowed window" }),
    check(assessed, { check_id: "duration.fits", area: "duration", status: "pass", reason: "Template is 45 minutes" }),
    check(assessed, {
      check_id: "equipment.available",
      area: "equipment",
      status: needsKettlebells ? "fail" : "pass",
      reason: needsKettlebells ? "Template needs kettlebells; none are available" : "No equipment required",
      evidence_ids: [needsKettlebells ? KETTLEBELL.evidence_id : BODYWEIGHT.evidence_id],
    }),
    check(assessed, { check_id: "heat.max_temperature", area: "heat", status: "pass", reason: "60°F is below the 90°F fixture limit", evidence_ids: ["ev-c6-temp-0900"] }),
    check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "pass", reason: "Regional AQI 35 is below the 100 fixture limit", evidence_ids: ["ev-c6-aqi"] }),
    check(assessed, { check_id: "freshness.conditions", area: "freshness", status: "pass", reason: "Fixture evidence covers the full event interval" }),
    check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "pass", reason: "Organizer confirmed stationary space at Park A", evidence_ids: ["ev-c6-space-confirm"] }),
    check(assessed, { check_id: "space_surface.surface", area: "space_surface", status: "pass", reason: "Organizer confirmed a grass surface at Park A", evidence_ids: ["ev-c6-surface-confirm"] }),
    check(assessed, { check_id: "permissions.permit_review", area: "permissions", status: "unknown", reason: "Group of 14 is below the 20-or-more permit-review flag; group size alone does not show whether permission is needed, and permit status is not recorded", critical: false }),
  ]);
}

export function planningOutput(event_version: number): PlanningOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "needs_verification",
    plan: plan(KETTLEBELL.id),
    facts: [
      { claim: "The kettlebell template needs kettlebells; the organizer has none available", status: "verified", evidence_ids: [KETTLEBELL.evidence_id], missing_reason: null },
    ],
    rule_checks: checksFor(event_version, KETTLEBELL.id),
    concerns: [
      { id: "concern-equipment", description: "Required kettlebells are not available", blocking: true, related_check_ids: ["equipment.available"] },
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
      { id: "concern-log-equipment", description: "A park or time change does not supply kettlebells", blocking: true, related_check_ids: ["equipment.available"] },
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
        plan: plan(BODYWEIGHT.id),
        changes: [{ field: "workout", from: KETTLEBELL.id, to: BODYWEIGHT.id }],
        assumptions: ["Assessed at the current park and time: Park A, 9 a.m."],
        requirements: ["Stationary space at Park A"],
        dependencies: [],
        evidence_ids: [BODYWEIGHT.evidence_id, "ev-c6-space-confirm"],
        unknowns: [],
        checks: checksFor(event_version, BODYWEIGHT.id),
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
        plan: plan(BODYWEIGHT.id),
        changes_from_original: [{ field: "workout", from: KETTLEBELL.id, to: BODYWEIGHT.id }],
        tradeoffs: ["Bodyweight exercises replace kettlebell work", "Same park and time"],
        evidence_ids: [BODYWEIGHT.evidence_id, "ev-c6-temp-0900", "ev-c6-aqi", "ev-c6-space-confirm"],
        checks: checksFor(event_version, BODYWEIGHT.id),
        unknowns: [],
      },
    ],
    recommendation: { combined_option_id: "combo-1", reason: "Approved template with no equipment; passes every critical check" },
    revision_requests: [],
    blocking_issues: [],
    organizer_tasks: [],
  };
}
