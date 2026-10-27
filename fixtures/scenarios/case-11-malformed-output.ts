import type { AgentName, EventBrief, EvidenceSnapshot, PlanningOutput } from "@/contracts";
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
 * PRD eval Case 11 — An agent returns malformed output or an unknown candidate/evidence ID.
 * Inputs match a normal, passing plan (Park A, 9 a.m., conditions pass, space confirmed).
 * planningOutput() is schema-valid but cites a park/time candidate and evidence IDs that are not
 * in the snapshot; malformedOutputs are raw agent replies that fail their output schema.
 * Expected: the harness rejects each one as invalid_output, accepts no plan, and saves no
 * finalized event. A correct result for this case is a refusal, not a repaired plan.
 */

export const SNAPSHOT_ID = "snap-case-11";
const PARK = "park-a";
const START = "2026-10-30T09:00";
const TEMPLATE = "tpl-bodyweight-45";
const CAND = { id: "cand-a-0900", park_id: PARK, start_time: START, end_time: "2026-10-30T09:45" };

/** IDs planningOutput cites that the snapshot does not contain. */
export const UNKNOWN_IDS = {
  park_time_candidate: "cand-a-0700",
  evidence: ["ev-c11-temp-0700", "ev-c11-space-confirm-guess"],
};

export const expected: ExpectedOutcome = {
  case_number: 11,
  title: "An agent returns malformed output or an unknown candidate/evidence ID",
  known_feasible: false,
  specialists_run: false,
  final_status: null,
  overall: null,
  checks: {},
  finalize: "blocked",
  gate_failures: [],
  required_gaps: [],
  max_revision_rounds: 0,
  agent_error: "invalid_output",
  notes: [
    "Each output in malformedOutputs is rejected by schema validation",
    "planningOutput is rejected because it cites a candidate and evidence IDs missing from the snapshot",
    "The harness never fills in, repairs or guesses missing fields",
    "The run ends with an explicit unresolved result, never a finalized event",
  ],
};

export const brief: EventBrief = {
  title: "Bodyweight class (Case 11 fixture)",
  date: "2026-10-30",
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
      evidence({ id: "ev-c11-temp-0900", metric: "temperature", value: 61, unit: "F", source: "NWS (fixture)", park_id: PARK, scope: "forecast_grid", valid_from: START, valid_to: "2026-10-30T10:00" }),
      evidence({
        id: "ev-c11-aqi",
        metric: "aqi",
        value: 33,
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
      evidence({ id: "ev-c11-space-confirm", metric: "space_confirmation", evidence_type: "organizer_confirmation", value: true, source: "Organizer", park_id: PARK, confirms_check_id: "space_surface.space", limitations: ["Layout: stationary"] }),
    ],
    coverage_gaps: [],
  };
}

/** Schema-valid Planning output that references IDs outside the snapshot. Must be rejected. */
export function planningOutput(event_version: number): PlanningOutput {
  const start = "2026-10-30T07:00";
  const assessed = { park_id: PARK, start_time: start, workout_template_id: TEMPLATE };
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "draft",
    plan: candidatePlan({
      candidate: { id: UNKNOWN_IDS.park_time_candidate, park_id: PARK, start_time: start },
      workout_template_id: TEMPLATE,
      duration_minutes: 45,
      session_outline: ["Warm-up walk and mobility", "Bodyweight circuit", "Cool-down stretch"],
    }),
    facts: [
      { claim: "Forecast temperature at 7 a.m. is 55°F", status: "verified", evidence_ids: [UNKNOWN_IDS.evidence[0]], missing_reason: null },
    ],
    rule_checks: checkResult(event_version, SNAPSHOT_ID, [
      check(assessed, { check_id: "heat.max_temperature", area: "heat", status: "pass", reason: "55°F is below the 90°F fixture limit", evidence_ids: [UNKNOWN_IDS.evidence[0]] }),
      check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "pass", reason: "Space confirmed", evidence_ids: [UNKNOWN_IDS.evidence[1]] }),
    ]),
    concerns: [],
    organizer_tasks: [],
  };
}

/** Raw agent replies that must fail their output schema. */
export const malformedOutputs: { agent: AgentName; defect: string; output: unknown }[] = [
  {
    agent: "planning",
    defect: "Missing required fields plan and rule_checks",
    output: { event_version: 1, evidence_snapshot_id: SNAPSHOT_ID, status: "draft", facts: [], concerns: [], organizer_tasks: [] },
  },
  {
    agent: "planning",
    defect: "Status outside the enum and a check status that is not pass/fail/unknown",
    output: {
      event_version: 1,
      evidence_snapshot_id: SNAPSHOT_ID,
      status: "finalized",
      plan: { park_time_candidate_id: CAND.id, park_id: PARK, start_time: START, time_zone: "America/New_York", duration_minutes: 45, workout_template_id: TEMPLATE, adaptation_ids: [], session_outline: [] },
      facts: [],
      rule_checks: { event_version: 1, evidence_snapshot_id: SNAPSHOT_ID, overall: "probably_pass", checks: [], blockers: [] },
      concerns: [],
      organizer_tasks: [],
    },
  },
  {
    agent: "reviewer",
    defect: "Prose instead of JSON",
    output: "I recommend Park A at 9 a.m.; everything looks fine.",
  },
  {
    agent: "workout",
    defect: "More than 3 options and an option with no assessed candidates",
    output: {
      event_version: 1,
      evidence_snapshot_id: SNAPSHOT_ID,
      status: "options_proposed",
      options: [1, 2, 3, 4].map((n) => ({ option_id: `wo-${n}`, specialist: "workout", park_time_candidate_ids: [] })),
      concerns: [],
      organizer_tasks: [],
    },
  },
];
