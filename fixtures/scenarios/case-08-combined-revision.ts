import type {
  CheckResult,
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
 * PRD eval Case 8 — A combined logistics/workout revision resolves interacting constraints.
 * 45-minute run-interval class at Park A for 18 adults at 10 a.m. (window 8–10, Park A only).
 * 10 a.m. fails the heat policy; 8 a.m. passes. Park A's running lane is unusable, but the
 * organizer has confirmed open stationary space at Park A. Neither fix works alone: 8 a.m. with
 * running intervals fails on space, and the stationary circuit at 10 a.m. fails on heat.
 * Expected: the Reviewer combines the Logistics time change with the Workout adaptation
 * (Park A, 8 a.m., stationary circuit); the combination passes every critical check.
 */

export const SNAPSHOT_ID = "snap-case-08";
const PARK = "park-a";
const RUN = "tpl-run-intervals-45";
const ADAPT = "adapt-stationary-circuit";
const RETRIEVED = "2026-07-22T12:00:00Z";
const A_0800 = { id: "cand-a-0800", park_id: PARK, start_time: "2026-07-24T08:00", end_time: "2026-07-24T08:45" };
const A_1000 = { id: "cand-a-1000", park_id: PARK, start_time: "2026-07-24T10:00", end_time: "2026-07-24T10:45" };

export const expected: ExpectedOutcome = {
  case_number: 8,
  title: "A combined logistics/workout revision resolves interacting constraints",
  known_feasible: true,
  specialists_run: true,
  final_status: "draft",
  overall: "pass",
  checks: { "heat.max_temperature": "pass", "space_surface.space": "pass" },
  finalize: "allowed",
  gate_failures: [],
  required_gaps: [],
  max_revision_rounds: 1,
  agent_error: null,
  notes: [
    "Recommended option is Park A, 8 a.m., with adapt-stationary-circuit",
    "The harness checks the complete combination; individually failing proposals are not discarded before combining",
    "The stationary adaptation never makes 10 a.m. acceptable on heat",
  ],
};

export const brief: EventBrief = {
  title: "Summer run club intervals (Case 8 fixture)",
  date: "2026-07-24",
  time_zone: "America/New_York",
  start_window: { earliest: "08:00", latest: "10:00" },
  duration_minutes: 45,
  group_size: 18,
  allowed_park_ids: [PARK],
  preferred_park_id: PARK,
  workout_template_id: RUN,
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
    park_time_candidates: [A_0800, A_1000],
    workout_templates: placeholderTemplates,
    items: [
      ...referenceEvidence(RETRIEVED),
      evidence({ id: "ev-c8-temp-0800", metric: "temperature", value: 81, unit: "F", source: "NWS (fixture)", park_id: PARK, scope: "forecast_grid", valid_from: "2026-07-24T08:00", valid_to: "2026-07-24T09:00", retrieved_at: RETRIEVED }),
      evidence({ id: "ev-c8-temp-1000", metric: "temperature", value: 93, unit: "F", source: "NWS (fixture)", park_id: PARK, scope: "forecast_grid", valid_from: "2026-07-24T10:00", valid_to: "2026-07-24T11:00", retrieved_at: RETRIEVED }),
      evidence({
        id: "ev-c8-aqi",
        metric: "aqi",
        value: 47,
        unit: "AQI",
        category: "Good",
        pollutant: "Ozone",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-07-24T00:00",
        valid_to: "2026-07-24T23:59",
        limitations: ["Regional reporting-area value, not a park-level measurement"],
        retrieved_at: RETRIEVED,
      }),
      evidence({ id: "ev-c8-lane-unusable", metric: "space_confirmation", evidence_type: "organizer_confirmation", value: false, source: "Organizer", park_id: PARK, confirms_check_id: "space_surface.space", limitations: ["Layout: running_lane", "Organizer report: Park A running lane is unusable"], retrieved_at: RETRIEVED }),
      evidence({ id: "ev-c8-stationary-confirm", metric: "space_confirmation", evidence_type: "organizer_confirmation", value: true, source: "Organizer", park_id: PARK, confirms_check_id: "space_surface.space", limitations: ["Layout: stationary", "Open stationary area for 18 people"], retrieved_at: RETRIEVED }),
    ],
    coverage_gaps: [],
  };
}

function plan(c: typeof A_0800, adapted: boolean) {
  return candidatePlan({
    candidate: c,
    workout_template_id: RUN,
    duration_minutes: 45,
    adaptation_ids: adapted ? [ADAPT] : [],
    session_outline: adapted
      ? ["Easy warm-up", "Stationary circuit (replaces running intervals)", "Cool-down walk"]
      : ["Easy jog warm-up", "Running intervals", "Cool-down walk"],
  });
}

function checksFor(event_version: number, c: typeof A_0800, adapted: boolean) {
  const assessed = { park_id: PARK, start_time: c.start_time, workout_template_id: RUN };
  const hot = c.id === A_1000.id;
  const space: CheckResult = adapted
    ? check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "pass", reason: "Organizer confirmed open stationary space at Park A", evidence_ids: ["ev-c8-stationary-confirm"] })
    : check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "fail", reason: "Organizer reported Park A's running lane is unusable", evidence_ids: ["ev-c8-lane-unusable"] });
  return checkResult(event_version, SNAPSHOT_ID, [
    check(assessed, { check_id: "event_constraints.start_window", area: "event_constraints", status: "pass", reason: "Start time is within 8–10 a.m." }),
    check(assessed, { check_id: "duration.fits", area: "duration", status: "pass", reason: "Template and adaptation total 45 minutes" }),
    check(assessed, { check_id: "equipment.available", area: "equipment", status: "pass", reason: "No equipment required" }),
    check(assessed, { check_id: "heat.max_temperature", area: "heat", status: hot ? "fail" : "pass", reason: hot ? "93°F exceeds the 90°F fixture limit" : "81°F is below the 90°F fixture limit", evidence_ids: [hot ? "ev-c8-temp-1000" : "ev-c8-temp-0800"] }),
    check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "pass", reason: "Regional AQI 47 is below the 100 fixture limit", evidence_ids: ["ev-c8-aqi"] }),
    check(assessed, { check_id: "freshness.conditions", area: "freshness", status: "pass", reason: "Fixture evidence covers the full event interval" }),
    space,
    check(assessed, { check_id: "permissions.permit_review", area: "permissions", status: "unknown", reason: "Group of 18 is close to the 20-person permit-review flag; permit status not recorded", critical: false }),
  ]);
}

export function planningOutput(event_version: number): PlanningOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "needs_verification",
    plan: plan(A_1000, false),
    facts: [
      { claim: "Forecast temperature at 10 a.m. is 93°F", status: "verified", evidence_ids: ["ev-c8-temp-1000"], missing_reason: null },
      { claim: "Organizer reported Park A's running lane is unusable", status: "verified", evidence_ids: ["ev-c8-lane-unusable"], missing_reason: null },
    ],
    rule_checks: checksFor(event_version, A_1000, false),
    concerns: [
      { id: "concern-heat", description: "10 a.m. fails the heat policy", blocking: true, related_check_ids: ["heat.max_temperature"] },
      { id: "concern-lane", description: "Running intervals need a running lane; Park A's is unusable", blocking: true, related_check_ids: ["space_surface.space"] },
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
        plan: plan(A_0800, false),
        changes: [{ field: "start_time", from: A_1000.start_time, to: A_0800.start_time }],
        assumptions: ["Workout unchanged: running intervals"],
        requirements: ["Running lane at Park A"],
        dependencies: ["Requires a workout that does not need Park A's running lane"],
        evidence_ids: ["ev-c8-temp-0800", "ev-c8-aqi", "ev-c8-lane-unusable"],
        unknowns: [],
        checks: checksFor(event_version, A_0800, false),
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
    status: "options_proposed",
    options: [
      {
        option_id: "wo-1",
        specialist: "workout",
        park_time_candidate_ids: [A_1000.id],
        plan: plan(A_1000, true),
        changes: [{ field: "adaptation", from: null, to: ADAPT }],
        assumptions: ["Assessed at the current park and time: Park A, 10 a.m."],
        requirements: ["Open stationary space at Park A"],
        dependencies: ["10 a.m. still fails the heat policy; an earlier time is required. Lowering intensity does not change that."],
        evidence_ids: ["ev-c8-temp-1000", "ev-c8-stationary-confirm", "ev-tpl-run-intervals-45"],
        unknowns: [],
        checks: checksFor(event_version, A_1000, true),
      },
    ],
    concerns: [],
    organizer_tasks: [],
  };
}

export function reviewerOutput(event_version: number): ReviewerOutput {
  const original = plan(A_1000, false);
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "draft",
    ranked_options: [
      {
        combined_option_id: "combo-1",
        logistics_option_id: "log-1",
        workout_option_id: "wo-1",
        park_time_candidate_id: A_0800.id,
        plan: plan(A_0800, true),
        changes_from_original: [
          { field: "start_time", from: original.start_time, to: A_0800.start_time },
          { field: "adaptation", from: null, to: ADAPT },
        ],
        tradeoffs: ["Starts 2 hours earlier", "Stationary circuit replaces running intervals", "Keeps Park A"],
        evidence_ids: ["ev-c8-temp-0800", "ev-c8-aqi", "ev-c8-stationary-confirm"],
        checks: checksFor(event_version, A_0800, true),
        unknowns: [],
      },
    ],
    recommendation: { combined_option_id: "combo-1", reason: "Only combination that passes every critical check" },
    revision_requests: [],
    blocking_issues: [],
    organizer_tasks: [],
  };
}
