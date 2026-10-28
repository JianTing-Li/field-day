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
 * PRD eval Case 9 — Every available combination fails a hard constraint.
 * 45-minute bootcamp for 20 adults on a heat-advisory day: Park A or Park B, 9–11 a.m.
 * Every allowed park and start time is at or above 92°F. The template permits a low-intensity
 * adaptation. Expected: no_feasible_option, no recommendation, finalization blocked. The
 * low-intensity option keeps the heat check as fail (lowering intensity never lifts a heat block),
 * and the Reviewer requests no revision because none could resolve it. The template is fixture-only.
 */

export const SNAPSHOT_ID = "snap-case-09";
const LOW = "adapt-fx-low-intensity";
const RETRIEVED = "2026-07-25T12:00:00Z";
const CANDS = (["park-a", "park-b"] as const).flatMap((park) =>
  (["09:00", "11:00"] as const).map((t) => ({
    id: `cand-${park.slice(-1)}-${t.replace(":", "")}`,
    park_id: park,
    start_time: `2026-07-27T${t}`,
    end_time: `2026-07-27T${t === "09:00" ? "09:45" : "11:45"}`,
  })),
);
const TEMPS: Record<string, number> = { "cand-a-0900": 92, "cand-a-1100": 96, "cand-b-0900": 92, "cand-b-1100": 95 };
const cand = (id: string) => CANDS.find((c) => c.id === id)!;

export const BOOTCAMP = fixtureTemplate({
  id: "tpl-fx-bootcamp-45",
  name: "Outdoor bootcamp (fixture)",
  duration_minutes: 45,
  intensity: "high",
  exercises: [
    { name: "Warm-up", minutes: 8, intensity: "low" },
    { name: "Sprint and burpee circuit", minutes: 30, intensity: "high" },
    { name: "Cool-down", minutes: 7, intensity: "low" },
  ],
  equipment: [],
  space: { layout: "open_field", min_area_sq_m: null },
  surfaces: ["grass"],
  permitted_adaptations: [
    {
      id: LOW,
      description: "Low-intensity version: walking intervals and mobility",
      effect: "Lowers intensity; does not change exposure time or heat policy",
      resulting_layout: null,
      duration_delta_minutes: 0,
    },
  ],
});

export const expected: ExpectedOutcome = {
  case_number: 9,
  title: "Every available combination fails a hard constraint",
  known_feasible: false,
  specialists_run: true,
  final_status: "no_feasible_option",
  overall: "fail",
  checks: { "heat.max_temperature": "fail" },
  finalize: "blocked",
  gate_failures: ["hard_constraints"],
  required_gaps: [],
  max_revision_rounds: 0,
  agent_error: null,
  notes: [
    "No recommendation; every ranked option keeps heat.max_temperature as fail",
    "The low-intensity adaptation is never presented as making the heat acceptable",
    "Next step for the organizer: choose another date",
  ],
};

export const brief: EventBrief = {
  title: "Heat-advisory bootcamp (Case 9 fixture)",
  date: "2026-07-27",
  time_zone: "America/New_York",
  start_window: { earliest: "09:00", latest: "11:00" },
  duration_minutes: 45,
  group_size: 20,
  allowed_park_ids: ["park-a", "park-b"],
  preferred_park_id: "park-a",
  workout_template_id: BOOTCAMP.id,
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
    created_at: RETRIEVED,
    origin: "fixture",
    park_candidates: placeholderParks,
    park_time_candidates: CANDS,
    workout_templates: [BOOTCAMP],
    items: [
      ...referenceEvidence(RETRIEVED, [BOOTCAMP]),
      ...CANDS.map((c) =>
        evidence({
          id: `ev-c9-temp-${c.id.slice(5)}`,
          metric: "temperature",
          value: TEMPS[c.id],
          unit: "F",
          source: "NWS (fixture)",
          park_id: c.park_id,
          scope: "forecast_grid",
          valid_from: c.start_time,
          valid_to: c.start_time.replace(/T(\d\d)/, (_, h) => `T${String(Number(h) + 1).padStart(2, "0")}`),
          retrieved_at: RETRIEVED,
        }),
      ),
      evidence({
        id: "ev-c9-aqi",
        metric: "aqi",
        value: 68,
        unit: "AQI",
        category: "Moderate",
        pollutant: "Ozone",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-07-27T00:00",
        valid_to: "2026-07-27T23:59",
        limitations: ["Regional reporting-area value, not a park-level measurement"],
        retrieved_at: RETRIEVED,
      }),
    ],
    coverage_gaps: [],
  };
}

const tempId = (candId: string) => `ev-c9-temp-${candId.slice(5)}`;

function plan(candId: string, low: boolean) {
  return candidatePlan({
    candidate: cand(candId),
    workout_template_id: BOOTCAMP.id,
    duration_minutes: 45,
    adaptation_ids: low ? [LOW] : [],
    session_outline: low
      ? ["Warm-up", "Walking intervals and mobility", "Cool-down"]
      : ["Warm-up", "Sprint and burpee circuit", "Cool-down"],
  });
}

function checksFor(event_version: number, candId: string) {
  const c = cand(candId);
  const assessed = { park_id: c.park_id, start_time: c.start_time, workout_template_id: BOOTCAMP.id };
  return checkResult(event_version, SNAPSHOT_ID, [
    check(assessed, { check_id: "event_constraints.start_window", area: "event_constraints", status: "pass", reason: "Start time is within 9–11 a.m." }),
    check(assessed, { check_id: "heat.max_temperature", area: "heat", status: "fail", reason: `${TEMPS[candId]}°F exceeds the 90°F fixture limit; intensity does not change this`, evidence_ids: [tempId(candId)] }),
    check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "pass", reason: "Regional AQI 68 is below the 100 fixture limit", evidence_ids: ["ev-c9-aqi"] }),
    check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "unknown", reason: "Open field at this park is not confirmed" }),
    check(assessed, { check_id: "permissions.permit_review", area: "permissions", status: "unknown", reason: "Group of 20 meets the permit-review flag; permit status not recorded", critical: false }),
  ]);
}

export function planningOutput(event_version: number): PlanningOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "no_feasible_option",
    plan: plan("cand-a-0900", false),
    facts: CANDS.map((c) => ({
      claim: `Forecast temperature at ${c.park_id === "park-a" ? "Park A" : "Park B"}, ${c.start_time.slice(11)} is ${TEMPS[c.id]}°F`,
      status: "verified" as const,
      evidence_ids: [tempId(c.id)],
      missing_reason: null,
    })),
    rule_checks: checksFor(event_version, "cand-a-0900"),
    concerns: [
      { id: "concern-heat", description: "Every allowed park and start time exceeds the heat limit", blocking: true, related_check_ids: ["heat.max_temperature"] },
    ],
    organizer_tasks: [],
  };
}

export function logisticsOutput(event_version: number): LogisticsOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "no_feasible_option",
    options: [
      {
        option_id: "log-1",
        specialist: "logistics",
        park_time_candidate_ids: ["cand-b-0900"],
        plan: plan("cand-b-0900", false),
        changes: [{ field: "park", from: "park-a", to: "park-b" }],
        assumptions: ["Workout unchanged: bootcamp"],
        requirements: ["Open field at Park B"],
        dependencies: [],
        evidence_ids: [tempId("cand-b-0900")],
        unknowns: ["Open field at Park B is not confirmed"],
        checks: checksFor(event_version, "cand-b-0900"),
      },
    ],
    concerns: [
      { id: "concern-log-heat", description: "No allowed park or time is below the heat limit", blocking: true, related_check_ids: ["heat.max_temperature"] },
    ],
    organizer_tasks: [],
  };
}

export function workoutOutput(event_version: number): WorkoutOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "no_feasible_option",
    options: [
      {
        option_id: "wo-1",
        specialist: "workout",
        park_time_candidate_ids: ["cand-a-0900"],
        plan: plan("cand-a-0900", true),
        changes: [{ field: "adaptation", from: null, to: LOW }],
        assumptions: ["Assessed at the current park and time: Park A, 9 a.m."],
        requirements: ["Open field at Park A"],
        dependencies: ["Heat still fails; lowering intensity does not make a blocked heat condition acceptable"],
        evidence_ids: [tempId("cand-a-0900"), BOOTCAMP.evidence_id],
        unknowns: ["Open field at Park A is not confirmed"],
        checks: checksFor(event_version, "cand-a-0900"),
      },
    ],
    concerns: [
      { id: "concern-wo-heat", description: "Lowering intensity does not lift the heat block", blocking: true, related_check_ids: ["heat.max_temperature"] },
    ],
    organizer_tasks: [],
  };
}

export function reviewerOutput(event_version: number): ReviewerOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "no_feasible_option",
    ranked_options: [
      {
        combined_option_id: "combo-1",
        logistics_option_id: "log-1",
        workout_option_id: "wo-1",
        park_time_candidate_id: "cand-b-0900",
        plan: plan("cand-b-0900", true),
        changes_from_original: [
          { field: "park", from: "park-a", to: "park-b" },
          { field: "adaptation", from: null, to: LOW },
        ],
        tradeoffs: ["Coolest available slot is still 92°F"],
        evidence_ids: [tempId("cand-b-0900"), "ev-c9-aqi"],
        checks: checksFor(event_version, "cand-b-0900"),
        unknowns: ["Open field at Park B is not confirmed"],
      },
    ],
    recommendation: null,
    revision_requests: [],
    blocking_issues: ["Every allowed park and start time fails the heat policy; no revision can resolve this"],
    organizer_tasks: [
      { id: "task-new-date", description: "Choose another date; every allowed park and time on July 27 exceeds the heat limit", resolves_check_id: "heat.max_temperature", park_id: null, start_time: null },
    ],
  };
}
