import type {
  CandidatePlan,
  CheckResult,
  EventBrief,
  EvidenceSnapshot,
  LogisticsOutput,
  PlanningOutput,
  ReviewerOutput,
  WorkoutOutput,
} from "@/contracts";
import {
  check,
  checkResult,
  evidence,
  curatedParks,
  placeholderTemplates,
  referenceEvidence,
} from "./helpers";

/**
 * PRD eval Case 2 — Conflicting conditions and workout requirements.
 * Existing 45-minute run-interval class at McCarren Park for 18 adults at 10 a.m. (window 8–10).
 * Updated evidence blocks 10 a.m. on heat; 8 a.m. passes. Organizer reports McCarren Park's
 * running lane is unusable. Workout proposes a stationary adaptation (assessed at McCarren Park);
 * Logistics proposes Astoria Park at 8 a.m. Astoria Park space/surface for the stationary session is
 * unverified, so the result is needs_verification and finalization stays blocked.
 * PRD "Park A" = McCarren Park (park-b058), "Park B" = Astoria Park (park-q004).
 */

export const SNAPSHOT_ID = "snap-case-02";
const RUN = "tpl-run-intervals-45";
const ADAPT = "adapt-stationary-circuit";
const A_0800 = { id: "cand-a-0800", park_id: "park-b058", start_time: "2026-07-16T08:00", end_time: "2026-07-16T08:45" };
const A_1000 = { id: "cand-a-1000", park_id: "park-b058", start_time: "2026-07-16T10:00", end_time: "2026-07-16T10:45" };
const B_0800 = { id: "cand-b-0800", park_id: "park-q004", start_time: "2026-07-16T08:00", end_time: "2026-07-16T08:45" };

export const brief: EventBrief = {
  title: "Summer run club intervals (Case 2 fixture)",
  date: "2026-07-16",
  time_zone: "America/New_York",
  start_window: { earliest: "08:00", latest: "10:00" },
  duration_minutes: 45,
  group_size: 18,
  allowed_park_ids: ["park-b058", "park-q004"],
  preferred_park_id: "park-b058",
  workout_template_id: RUN,
  equipment_available: [],
  exercise_exclusions: [],
  instructor_limits: { max_temperature_f: 90, max_aqi: 100, notes: null },
  priorities: ["Keep the same park if possible"],
};

export function snapshot(event_id: string, event_version: number): EvidenceSnapshot {
  return {
    id: SNAPSHOT_ID,
    event_id,
    event_version,
    created_at: "2026-10-28T12:00:00Z",
    origin: "fixture",
    park_candidates: curatedParks.filter((p) => brief.allowed_park_ids.includes(p.id)),
    park_time_candidates: [A_0800, A_1000, B_0800],
    workout_templates: placeholderTemplates,
    items: [
      ...referenceEvidence(),
      ...(["park-b058", "park-q004"] as const).flatMap((park) => [
        evidence({
          id: `ev-c2-temp-0800-${park}`,
          metric: "temperature",
          value: 82,
          unit: "F",
          source: "NWS (fixture)",
          park_id: park,
          scope: "forecast_grid",
          valid_from: "2026-07-16T08:00",
          valid_to: "2026-07-16T09:00",
        }),
        evidence({
          id: `ev-c2-temp-1000-${park}`,
          metric: "temperature",
          value: 93,
          unit: "F",
          source: "NWS (fixture)",
          park_id: park,
          scope: "forecast_grid",
          valid_from: "2026-07-16T10:00",
          valid_to: "2026-07-16T11:00",
        }),
      ]),
      evidence({
        id: "ev-c2-aqi",
        metric: "aqi",
        value: 45,
        unit: "AQI",
        category: "Good",
        pollutant: "Ozone",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-07-16T00:00",
        valid_to: "2026-07-16T23:59",
        limitations: ["Regional reporting-area value, not a park-level measurement"],
      }),
      evidence({
        id: "ev-c2-lane-unusable",
        metric: "surface_confirmation",
        evidence_type: "organizer_confirmation",
        value: false,
        source: "Organizer",
        park_id: "park-b058",
        confirms_check_id: "space_surface.space",
        limitations: ["Organizer report: McCarren Park running lane is unusable"],
      }),
    ],
    coverage_gaps: [],
  };
}

function plan(c: { id: string; park_id: string; start_time: string }, adapted: boolean): CandidatePlan {
  return {
    park_time_candidate_id: c.id,
    park_id: c.park_id,
    start_time: c.start_time,
    time_zone: "America/New_York",
    duration_minutes: 45,
    workout_template_id: RUN,
    adaptation_ids: adapted ? [ADAPT] : [],
    session_outline: adapted
      ? ["Easy warm-up", "Stationary circuit (replaces running intervals)", "Cool-down walk"]
      : ["Easy jog warm-up", "Running intervals", "Cool-down walk"],
  };
}

function checksFor(
  event_version: number,
  c: { id: string; park_id: string; start_time: string },
  adapted: boolean,
): ReturnType<typeof checkResult> {
  const assessed = { park_id: c.park_id, start_time: c.start_time, workout_template_id: RUN };
  const hot = c.start_time.endsWith("10:00");
  const tempId = `ev-c2-temp-${hot ? "1000" : "0800"}-${c.park_id}`;
  const parkName = c.park_id === "park-b058" ? "McCarren Park" : "Astoria Park";
  const checks: CheckResult[] = [
    check(assessed, { check_id: "event_constraints.start_window", area: "event_constraints", status: "pass", reason: "Start time is within 8–10 a.m." }),
    check(assessed, { check_id: "heat.max_temperature", area: "heat", status: hot ? "fail" : "pass", reason: hot ? "93°F exceeds the 90°F fixture limit" : "82°F is below the 90°F fixture limit", evidence_ids: [tempId] }),
    check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "pass", reason: "Regional AQI 45 is below the 100 fixture limit", evidence_ids: ["ev-c2-aqi"] }),
    adapted
      ? check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "unknown", reason: `Stationary space at ${parkName} is not confirmed` })
      : c.park_id === "park-b058"
        ? check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "fail", reason: "Organizer reported McCarren Park's running lane is unusable", evidence_ids: ["ev-c2-lane-unusable"] })
        : check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "unknown", reason: "Running lane at Astoria Park is not confirmed" }),
    check(assessed, { check_id: "permissions.permit_review", area: "permissions", status: "unknown", reason: "Group of 18 is close to the 20-person permit-review flag; permit status not recorded", critical: false }),
  ];
  return checkResult(event_version, SNAPSHOT_ID, checks);
}

export function planningOutput(event_version: number): PlanningOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "needs_verification",
    plan: plan(A_1000, false),
    facts: [
      { claim: "Forecast temperature at 10 a.m. is 93°F", status: "verified", evidence_ids: ["ev-c2-temp-1000-park-b058"], missing_reason: null },
      { claim: "Organizer reported McCarren Park's running lane is unusable", status: "verified", evidence_ids: ["ev-c2-lane-unusable"], missing_reason: null },
    ],
    rule_checks: checksFor(event_version, A_1000, false),
    concerns: [
      { id: "concern-heat", description: "10 a.m. fails the heat policy", blocking: true, related_check_ids: ["heat.max_temperature"] },
      { id: "concern-lane", description: "Running intervals need a running lane; McCarren Park's is unusable", blocking: true, related_check_ids: ["space_surface.space"] },
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
        changes: [
          { field: "park", from: "park-b058", to: "park-q004" },
          { field: "start_time", from: A_1000.start_time, to: B_0800.start_time },
        ],
        assumptions: ["Workout unchanged: running intervals"],
        requirements: ["Running lane at Astoria Park"],
        dependencies: ["If the workout becomes stationary, Astoria Park stationary space must be confirmed"],
        evidence_ids: ["ev-c2-temp-0800-park-q004", "ev-c2-aqi"],
        unknowns: ["Astoria Park running lane and space are unverified"],
        checks: checksFor(event_version, B_0800, false),
      },
      {
        option_id: "log-2",
        specialist: "logistics",
        park_time_candidate_ids: [A_0800.id],
        plan: plan(A_0800, false),
        changes: [{ field: "start_time", from: A_1000.start_time, to: A_0800.start_time }],
        assumptions: ["Workout unchanged: running intervals"],
        requirements: ["Running lane at McCarren Park"],
        dependencies: ["Requires a workout that does not need McCarren Park's running lane"],
        evidence_ids: ["ev-c2-temp-0800-park-b058", "ev-c2-lane-unusable"],
        unknowns: [],
        checks: checksFor(event_version, A_0800, false),
      },
    ],
    concerns: [
      { id: "concern-log-dep", description: "Both options assume the running workout; a stationary adaptation changes space needs", blocking: false, related_check_ids: ["space_surface.space"] },
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
        park_time_candidate_ids: [A_1000.id],
        plan: plan(A_1000, true),
        changes: [{ field: "adaptation", from: null, to: ADAPT }],
        assumptions: ["Assessed at the current park and time: McCarren Park, 10 a.m."],
        requirements: ["Open stationary space", "No running lane needed"],
        dependencies: ["10 a.m. still fails the heat policy; an earlier time is required. Lowering intensity does not change that."],
        evidence_ids: ["ev-c2-temp-1000-park-b058", "ev-tpl-run-intervals-45"],
        unknowns: ["Stationary space at McCarren Park is not confirmed"],
        checks: checksFor(event_version, A_1000, true),
      },
    ],
    concerns: [
      { id: "concern-wo-heat", description: "Stationary adaptation does not resolve the 10 a.m. heat block", blocking: true, related_check_ids: ["heat.max_temperature"] },
    ],
    organizer_tasks: [],
  };
}

export function reviewerOutput(event_version: number): ReviewerOutput {
  const original = plan(A_1000, false);
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "needs_verification",
    ranked_options: [
      {
        combined_option_id: "combo-1",
        logistics_option_id: "log-2",
        workout_option_id: "wo-1",
        park_time_candidate_id: A_0800.id,
        plan: plan(A_0800, true),
        changes_from_original: [
          { field: "start_time", from: original.start_time, to: A_0800.start_time },
          { field: "adaptation", from: null, to: ADAPT },
        ],
        tradeoffs: ["Keeps McCarren Park (organizer priority)", "Stationary circuit replaces running intervals"],
        evidence_ids: ["ev-c2-temp-0800-park-b058", "ev-c2-aqi"],
        checks: checksFor(event_version, A_0800, true),
        unknowns: ["Stationary space at McCarren Park is not confirmed"],
      },
      {
        combined_option_id: "combo-2",
        logistics_option_id: "log-1",
        workout_option_id: "wo-1",
        park_time_candidate_id: B_0800.id,
        plan: plan(B_0800, true),
        changes_from_original: [
          { field: "park", from: "park-b058", to: "park-q004" },
          { field: "start_time", from: original.start_time, to: B_0800.start_time },
          { field: "adaptation", from: null, to: ADAPT },
        ],
        tradeoffs: ["Moves to Astoria Park", "Stationary circuit replaces running intervals"],
        evidence_ids: ["ev-c2-temp-0800-park-q004", "ev-c2-aqi"],
        checks: checksFor(event_version, B_0800, true),
        unknowns: ["Stationary space and surface at Astoria Park are not confirmed; McCarren Park's assessment does not apply"],
      },
    ],
    recommendation: null,
    revision_requests: [],
    blocking_issues: [
      "Stationary space is unverified at both McCarren Park and Astoria Park; a specialist revision cannot resolve this",
    ],
    organizer_tasks: [
      { id: "task-space-a", description: "Confirm there is open stationary space for 18 people at McCarren Park at 8 a.m.", resolves_check_id: "space_surface.space", park_id: "park-b058", start_time: A_0800.start_time },
      { id: "task-space-b", description: "Confirm there is open stationary space and a suitable surface at Astoria Park at 8 a.m.", resolves_check_id: "space_surface.space", park_id: "park-q004", start_time: B_0800.start_time },
    ],
  };
}
