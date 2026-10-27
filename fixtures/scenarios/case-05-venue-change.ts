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
 * PRD eval Case 5 — Feasible venue change resolves a location requirement.
 * 45-minute running-interval class for 12 adults at 8 a.m., Park A preferred, Park B allowed.
 * Conditions pass at both parks. The organizer reports Park A's running lane is unusable and has
 * confirmed a usable paved running lane at Park B. Expected: Logistics proposes Park B at 8 a.m.
 * with the same workout; the Reviewer recommends it and every critical check passes. Park A's
 * report is never used as evidence for Park B, and Park B's confirmation never for Park A.
 */

export const SNAPSHOT_ID = "snap-case-05";
const RUN = "tpl-run-intervals-45";
const ADAPT = "adapt-stationary-circuit";
const A_0800 = { id: "cand-a-0800", park_id: "park-a", start_time: "2026-10-31T08:00", end_time: "2026-10-31T08:45" };
const B_0800 = { id: "cand-b-0800", park_id: "park-b", start_time: "2026-10-31T08:00", end_time: "2026-10-31T08:45" };

export const expected: ExpectedOutcome = {
  case_number: 5,
  title: "Feasible venue change resolves a location requirement",
  known_feasible: true,
  specialists_run: true,
  final_status: "draft",
  overall: "pass",
  checks: { "space_surface.space": "pass", "space_surface.surface": "pass", "event_constraints.allowed_park": "pass" },
  finalize: "allowed",
  gate_failures: [],
  required_gaps: [],
  max_revision_rounds: 1,
  agent_error: null,
  notes: [
    "Recommended option moves to Park B at 8 a.m. with the running workout unchanged",
    "Park B's lane confirmation is never applied to Park A, and Park A's report never to Park B",
    "The stationary option at Park A stays unknown because Park A stationary space is unconfirmed",
  ],
};

export const brief: EventBrief = {
  title: "Saturday run club intervals (Case 5 fixture)",
  date: "2026-10-31",
  time_zone: "America/New_York",
  start_window: { earliest: "08:00", latest: "08:00" },
  duration_minutes: 45,
  group_size: 12,
  allowed_park_ids: ["park-a", "park-b"],
  preferred_park_id: "park-a",
  workout_template_id: RUN,
  equipment_available: [],
  exercise_exclusions: [],
  instructor_limits: { max_temperature_f: 90, max_aqi: 100, notes: null },
  priorities: ["Keep running intervals"],
};

export function snapshot(event_id: string, event_version: number): EvidenceSnapshot {
  return {
    id: SNAPSHOT_ID,
    event_id,
    event_version,
    created_at: "2026-10-28T12:00:00Z",
    origin: "fixture",
    park_candidates: placeholderParks,
    park_time_candidates: [A_0800, B_0800],
    workout_templates: placeholderTemplates,
    items: [
      ...referenceEvidence(),
      ...(["park-a", "park-b"] as const).map((park) =>
        evidence({ id: `ev-c5-temp-${park}`, metric: "temperature", value: 58, unit: "F", source: "NWS (fixture)", park_id: park, scope: "forecast_grid", valid_from: "2026-10-31T08:00", valid_to: "2026-10-31T09:00" }),
      ),
      evidence({
        id: "ev-c5-aqi",
        metric: "aqi",
        value: 30,
        unit: "AQI",
        category: "Good",
        pollutant: "PM2.5",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-10-31T00:00",
        valid_to: "2026-10-31T23:59",
        limitations: ["Regional reporting-area value, not a park-level measurement"],
      }),
      evidence({ id: "ev-c5-lane-a-unusable", metric: "space_confirmation", evidence_type: "organizer_confirmation", value: false, source: "Organizer", park_id: "park-a", confirms_check_id: "space_surface.space", limitations: ["Layout: running_lane", "Organizer report: Park A running lane is unusable"] }),
      evidence({ id: "ev-c5-lane-b-confirm", metric: "space_confirmation", evidence_type: "organizer_confirmation", value: true, source: "Organizer", park_id: "park-b", confirms_check_id: "space_surface.space", limitations: ["Layout: running_lane"] }),
      evidence({ id: "ev-c5-surface-b-confirm", metric: "surface_confirmation", evidence_type: "organizer_confirmation", value: "paved", source: "Organizer", park_id: "park-b", confirms_check_id: "space_surface.surface" }),
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
  const assessed = { park_id: c.park_id, start_time: c.start_time, workout_template_id: RUN };
  const atB = c.park_id === "park-b";
  const space: CheckResult = adapted
    ? check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "unknown", reason: `Stationary space at ${atB ? "Park B" : "Park A"} is not confirmed` })
    : atB
      ? check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "pass", reason: "Organizer confirmed a usable running lane at Park B", evidence_ids: ["ev-c5-lane-b-confirm"] })
      : check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "fail", reason: "Organizer reported Park A's running lane is unusable", evidence_ids: ["ev-c5-lane-a-unusable"] });
  const surface: CheckResult = atB
    ? check(assessed, { check_id: "space_surface.surface", area: "space_surface", status: "pass", reason: "Organizer confirmed a paved surface at Park B", evidence_ids: ["ev-c5-surface-b-confirm"] })
    : check(assessed, { check_id: "space_surface.surface", area: "space_surface", status: "unknown", reason: "Surface at Park A is not confirmed" });
  return checkResult(event_version, SNAPSHOT_ID, [
    check(assessed, { check_id: "event_constraints.start_window", area: "event_constraints", status: "pass", reason: "8:00 is within the allowed window" }),
    check(assessed, { check_id: "event_constraints.allowed_park", area: "event_constraints", status: "pass", reason: `${atB ? "Park B" : "Park A"} is an allowed park` }),
    check(assessed, { check_id: "duration.fits", area: "duration", status: "pass", reason: "Template is 45 minutes" }),
    check(assessed, { check_id: "equipment.available", area: "equipment", status: "pass", reason: "No equipment required" }),
    check(assessed, { check_id: "heat.max_temperature", area: "heat", status: "pass", reason: "58°F is below the 90°F fixture limit", evidence_ids: [`ev-c5-temp-${c.park_id}`] }),
    check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "pass", reason: "Regional AQI 30 is below the 100 fixture limit", evidence_ids: ["ev-c5-aqi"] }),
    check(assessed, { check_id: "freshness.conditions", area: "freshness", status: "pass", reason: "Fixture evidence covers the full event interval" }),
    space,
    surface,
    check(assessed, { check_id: "permissions.permit_review", area: "permissions", status: "pass", reason: "Group of 12 is below the 20-person permit-review flag", critical: false }),
  ]);
}

export function planningOutput(event_version: number): PlanningOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "needs_verification",
    plan: plan(A_0800, false),
    facts: [
      { claim: "Organizer reported Park A's running lane is unusable", status: "verified", evidence_ids: ["ev-c5-lane-a-unusable"], missing_reason: null },
    ],
    rule_checks: checksFor(event_version, A_0800, false),
    concerns: [
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
        park_time_candidate_ids: [B_0800.id],
        plan: plan(B_0800, false),
        changes: [{ field: "park", from: "park-a", to: "park-b" }],
        assumptions: ["Workout unchanged: running intervals"],
        requirements: ["Running lane at Park B"],
        dependencies: [],
        evidence_ids: ["ev-c5-temp-park-b", "ev-c5-aqi", "ev-c5-lane-b-confirm", "ev-c5-surface-b-confirm"],
        unknowns: [],
        checks: checksFor(event_version, B_0800, false),
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
        park_time_candidate_ids: [A_0800.id],
        plan: plan(A_0800, true),
        changes: [{ field: "adaptation", from: null, to: ADAPT }],
        assumptions: ["Assessed at the current park and time: Park A, 8 a.m."],
        requirements: ["Open stationary space at Park A"],
        dependencies: ["Requires confirmed stationary space at Park A"],
        evidence_ids: ["ev-c5-temp-park-a", "ev-c5-aqi", "ev-tpl-run-intervals-45"],
        unknowns: ["Stationary space at Park A is not confirmed"],
        checks: checksFor(event_version, A_0800, true),
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
        logistics_option_id: "log-1",
        workout_option_id: null,
        park_time_candidate_id: B_0800.id,
        plan: plan(B_0800, false),
        changes_from_original: [{ field: "park", from: "park-a", to: "park-b" }],
        tradeoffs: ["Moves to Park B", "Keeps running intervals (organizer priority)"],
        evidence_ids: ["ev-c5-temp-park-b", "ev-c5-aqi", "ev-c5-lane-b-confirm", "ev-c5-surface-b-confirm"],
        checks: checksFor(event_version, B_0800, false),
        unknowns: [],
      },
      {
        combined_option_id: "combo-2",
        logistics_option_id: null,
        workout_option_id: "wo-1",
        park_time_candidate_id: A_0800.id,
        plan: plan(A_0800, true),
        changes_from_original: [{ field: "adaptation", from: null, to: ADAPT }],
        tradeoffs: ["Keeps Park A", "Stationary circuit replaces running intervals"],
        evidence_ids: ["ev-c5-temp-park-a", "ev-c5-aqi"],
        checks: checksFor(event_version, A_0800, true),
        unknowns: ["Stationary space and surface at Park A are not confirmed"],
      },
    ],
    recommendation: { combined_option_id: "combo-1", reason: "Passes every critical check and keeps the running workout" },
    revision_requests: [],
    blocking_issues: [],
    organizer_tasks: [],
  };
}
