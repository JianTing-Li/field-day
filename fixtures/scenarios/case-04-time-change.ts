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
  placeholderParks,
  placeholderTemplates,
  referenceEvidence,
} from "./helpers";
import type { ExpectedOutcome } from "./expected";

/**
 * PRD eval Case 4 — Feasible time change resolves an environmental conflict.
 * Existing 45-minute bodyweight class at Park A for 16 adults at 11 a.m. (window 7–11 a.m.).
 * The forecast blocks 11 a.m. on heat; 8 a.m. passes. Stationary space at Park A is confirmed.
 * Expected: Logistics proposes Park A at 8 a.m.; Workout Adaptation finds no workout change that
 * lifts a heat block; the Reviewer recommends the 8 a.m. option and every critical check passes.
 */

export const SNAPSHOT_ID = "snap-case-04";
const PARK = "park-a";
const TEMPLATE = "tpl-bodyweight-45";
const RETRIEVED = "2026-07-21T12:00:00Z";
const A_0800 = { id: "cand-a-0800", park_id: PARK, start_time: "2026-07-23T08:00", end_time: "2026-07-23T08:45" };
const A_1100 = { id: "cand-a-1100", park_id: PARK, start_time: "2026-07-23T11:00", end_time: "2026-07-23T11:45" };

export const expected: ExpectedOutcome = {
  case_number: 4,
  title: "Feasible time change resolves an environmental conflict",
  known_feasible: true,
  specialists_run: true,
  final_status: "draft",
  overall: "pass",
  checks: { "heat.max_temperature": "pass", "event_constraints.start_window": "pass", "space_surface.space": "pass", "space_surface.surface": "pass" },
  finalize: "allowed",
  gate_failures: [],
  required_gaps: [],
  max_revision_rounds: 1,
  agent_error: null,
  notes: [
    "Recommended option moves 11 a.m. to 8 a.m. at Park A with the same workout",
    "Lowering intensity is never offered as a fix for the 11 a.m. heat block",
    "The time change is a material revision and needs organizer approval of the new version",
  ],
};

export const brief: EventBrief = {
  title: "Late-morning bodyweight class (Case 4 fixture)",
  date: "2026-07-23",
  time_zone: "America/New_York",
  start_window: { earliest: "07:00", latest: "11:00" },
  duration_minutes: 45,
  group_size: 16,
  allowed_park_ids: [PARK],
  preferred_park_id: PARK,
  workout_template_id: TEMPLATE,
  equipment_available: [],
  exercise_exclusions: [],
  instructor_limits: { max_temperature_f: 90, max_aqi: 100, notes: null },
  priorities: ["Keep Park A"],
};

export function snapshot(event_id: string, event_version: number): EvidenceSnapshot {
  return {
    id: SNAPSHOT_ID,
    event_id,
    event_version,
    created_at: RETRIEVED,
    origin: "fixture",
    park_candidates: placeholderParks.filter((p) => p.id === PARK),
    park_time_candidates: [A_0800, A_1100],
    workout_templates: placeholderTemplates,
    items: [
      ...referenceEvidence(RETRIEVED),
      evidence({ id: "ev-c4-temp-0800", metric: "temperature", value: 80, unit: "F", source: "NWS (fixture)", park_id: PARK, scope: "forecast_grid", valid_from: "2026-07-23T08:00", valid_to: "2026-07-23T09:00", retrieved_at: RETRIEVED }),
      evidence({ id: "ev-c4-temp-1100", metric: "temperature", value: 94, unit: "F", source: "NWS (fixture)", park_id: PARK, scope: "forecast_grid", valid_from: "2026-07-23T11:00", valid_to: "2026-07-23T12:00", retrieved_at: RETRIEVED }),
      evidence({
        id: "ev-c4-aqi",
        metric: "aqi",
        value: 52,
        unit: "AQI",
        category: "Moderate",
        pollutant: "Ozone",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-07-23T00:00",
        valid_to: "2026-07-23T23:59",
        limitations: ["Regional reporting-area value, not a park-level measurement"],
        retrieved_at: RETRIEVED,
      }),
      evidence({ id: "ev-c4-space-confirm", metric: "space_confirmation", evidence_type: "organizer_confirmation", value: true, source: "Organizer", park_id: PARK, confirms_check_id: "space_surface.space", category: "stationary", retrieved_at: RETRIEVED }),
      evidence({ id: "ev-c4-surface-confirm", metric: "surface_confirmation", evidence_type: "organizer_confirmation", value: "grass", source: "Organizer", park_id: PARK, confirms_check_id: "space_surface.surface", retrieved_at: RETRIEVED }),
    ],
    coverage_gaps: [],
  };
}

function plan(c: typeof A_0800) {
  return candidatePlan({
    candidate: c,
    workout_template_id: TEMPLATE,
    duration_minutes: 45,
    session_outline: ["Warm-up walk and mobility", "Bodyweight circuit", "Cool-down stretch"],
  });
}

function checksFor(event_version: number, c: typeof A_0800) {
  const assessed = { park_id: PARK, start_time: c.start_time, workout_template_id: TEMPLATE };
  const hot = c.id === A_1100.id;
  return checkResult(event_version, SNAPSHOT_ID, [
    check(assessed, { check_id: "event_constraints.start_window", area: "event_constraints", status: "pass", reason: "Start time is within 7–11 a.m." }),
    check(assessed, { check_id: "duration.fits", area: "duration", status: "pass", reason: "Template is 45 minutes" }),
    check(assessed, { check_id: "equipment.available", area: "equipment", status: "pass", reason: "No equipment required" }),
    check(assessed, { check_id: "heat.max_temperature", area: "heat", status: hot ? "fail" : "pass", reason: hot ? "94°F exceeds the 90°F fixture limit" : "80°F is below the 90°F fixture limit", evidence_ids: [hot ? "ev-c4-temp-1100" : "ev-c4-temp-0800"] }),
    check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "pass", reason: "Regional AQI 52 is below the 100 fixture limit", evidence_ids: ["ev-c4-aqi"] }),
    check(assessed, { check_id: "freshness.conditions", area: "freshness", status: "pass", reason: "Fixture evidence covers the full event interval" }),
    check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "pass", reason: "Organizer confirmed stationary space at Park A", evidence_ids: ["ev-c4-space-confirm"] }),
    check(assessed, { check_id: "space_surface.surface", area: "space_surface", status: "pass", reason: "Organizer confirmed a grass surface at Park A", evidence_ids: ["ev-c4-surface-confirm"] }),
    check(assessed, { check_id: "permissions.permit_review", area: "permissions", status: "pass", reason: "Group of 16 is below the 20-person permit-review flag", critical: false }),
  ]);
}

export function planningOutput(event_version: number): PlanningOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "needs_verification",
    plan: plan(A_1100),
    facts: [
      { claim: "Forecast temperature at 11 a.m. is 94°F", status: "verified", evidence_ids: ["ev-c4-temp-1100"], missing_reason: null },
    ],
    rule_checks: checksFor(event_version, A_1100),
    concerns: [
      { id: "concern-heat", description: "11 a.m. fails the heat policy", blocking: true, related_check_ids: ["heat.max_temperature"] },
    ],
    organizer_tasks: [],
  };
}

export function logisticsOutput(event_version: number): LogisticsOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "options_proposed",
    options: [
      {
        option_id: "log-1",
        specialist: "logistics",
        park_time_candidate_ids: [A_0800.id],
        plan: plan(A_0800),
        changes: [{ field: "start_time", from: A_1100.start_time, to: A_0800.start_time }],
        assumptions: ["Workout unchanged: bodyweight circuit"],
        requirements: ["Stationary space at Park A"],
        dependencies: [],
        evidence_ids: ["ev-c4-temp-0800", "ev-c4-aqi", "ev-c4-space-confirm"],
        unknowns: [],
        checks: checksFor(event_version, A_0800),
      },
    ],
    concerns: [],
    organizer_tasks: [],
  };
}

export function workoutOutput(event_version: number): WorkoutOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "no_feasible_option",
    options: [],
    concerns: [
      { id: "concern-wo-heat", description: "No workout change makes 11 a.m. acceptable; lowering intensity does not lift a heat block", blocking: true, related_check_ids: ["heat.max_temperature"] },
    ],
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
        logistics_option_id: "log-1",
        workout_option_id: null,
        park_time_candidate_id: A_0800.id,
        plan: plan(A_0800),
        changes_from_original: [{ field: "start_time", from: A_1100.start_time, to: A_0800.start_time }],
        tradeoffs: ["Starts 3 hours earlier", "Keeps Park A and the same workout"],
        evidence_ids: ["ev-c4-temp-0800", "ev-c4-aqi", "ev-c4-space-confirm"],
        checks: checksFor(event_version, A_0800),
        unknowns: [],
      },
    ],
    recommendation: { combined_option_id: "combo-1", reason: "Only option that passes every critical check; keeps Park A" },
    revision_requests: [],
    blocking_issues: [],
    organizer_tasks: [],
  };
}
