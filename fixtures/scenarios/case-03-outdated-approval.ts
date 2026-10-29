import type { Approval, CheckResult, EventBrief, EvidenceItem, EvidenceSnapshot, PlanningOutput } from "@/contracts";
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
 * PRD eval Case 3 — Approval becomes outdated before saving.
 * The organizer approves version 1, assessed on snapshot A (everything passes). During final
 * validation the harness refreshes evidence into snapshot B: 9 a.m. now fails the heat policy and
 * AirNow is still unavailable after the retry limit. Expected: finalize with the old approval is
 * rejected, the heat block and missing AQI are shown (no substitute AQI), the result is
 * needs_verification with next steps, and no finalized event is saved.
 */

export const SNAPSHOT_ID = "snap-case-03a";
export const REFRESHED_SNAPSHOT_ID = "snap-case-03b";
const PARK = "park-a";
const START = "2026-07-22T09:00";
const END = "2026-07-22T09:45";
const TEMPLATE = "tpl-bodyweight-45";
const CAND = { id: "cand-a-0900", park_id: PARK, start_time: START, end_time: END };
const RETRIEVED_A = "2026-07-20T12:00:00Z";
const RETRIEVED_B = "2026-07-21T12:00:00Z";
const AQI_GAP = "AQI for 2026-07-22: AirNow unavailable after the configured retry limit";

export const expected: ExpectedOutcome = {
  case_number: 3,
  title: "Approval becomes outdated before saving",
  known_feasible: false,
  specialists_run: false,
  final_status: "needs_verification",
  overall: "fail",
  checks: { "heat.max_temperature": "fail", "air_quality.max_aqi": "unknown" },
  finalize: "blocked",
  gate_failures: ["current_evidence", "hard_constraints"],
  required_gaps: [AQI_GAP],
  max_revision_rounds: 0,
  agent_error: null,
  notes: [
    "Finalize using the version 1 approval on snapshot A is rejected after the refresh to snapshot B",
    "No substitute AQI value is shown or used",
    "A materially revised plan (new time or date) needs a new approval",
    "No finalized event is saved from the failed attempt",
  ],
};

export const brief: EventBrief = {
  title: "Morning bodyweight class (Case 3 fixture)",
  date: "2026-07-22",
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

/** The organizer's approval, recorded against snapshot A before the refresh. */
export const approval: Approval = {
  version: 1,
  evidence_snapshot_id: SNAPSHOT_ID,
  approved_at: "2026-07-20T14:00:00Z",
};

function confirmations(retrieved_at: string): EvidenceItem[] {
  return [
    evidence({
      id: "ev-c3-space-confirm",
      metric: "space_confirmation",
      evidence_type: "organizer_confirmation",
      value: true,
      source: "Organizer",
      category: "stationary",
      park_id: PARK,
      confirms_check_id: "space_surface.space",
      retrieved_at,
    }),
    evidence({
      id: "ev-c3-surface-confirm",
      metric: "surface_confirmation",
      evidence_type: "organizer_confirmation",
      value: "grass",
      source: "Organizer",
      park_id: PARK,
      confirms_check_id: "space_surface.surface",
      retrieved_at,
    }),
    evidence({
      id: "ev-c3-permit-confirm",
      metric: "permission_confirmation",
      evidence_type: "organizer_confirmation",
      value: true,
      source: "Organizer",
      park_id: PARK,
      confirms_check_id: "permissions.permit_review",
      retrieved_at,
    }),
  ];
}

function baseSnapshot(id: string, event_id: string, event_version: number, created_at: string) {
  return {
    id,
    event_id,
    event_version,
    created_at,
    origin: "fixture" as const,
    park_candidates: placeholderParks.filter((p) => p.id === PARK),
    park_time_candidates: [CAND],
    workout_templates: placeholderTemplates,
  };
}

/** Snapshot A: evidence at approval time. */
export function snapshot(event_id: string, event_version: number): EvidenceSnapshot {
  return {
    ...baseSnapshot(SNAPSHOT_ID, event_id, event_version, RETRIEVED_A),
    items: [
      ...referenceEvidence(RETRIEVED_A),
      evidence({
        id: "ev-c3a-temp-0900",
        metric: "temperature",
        value: 84,
        unit: "F",
        source: "NWS (fixture)",
        park_id: PARK,
        scope: "forecast_grid",
        valid_from: START,
        valid_to: "2026-07-22T10:00",
        retrieved_at: RETRIEVED_A,
      }),
      evidence({
        id: "ev-c3a-aqi",
        metric: "aqi",
        value: 48,
        unit: "AQI",
        category: "Good",
        pollutant: "Ozone",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-07-22T00:00",
        valid_to: "2026-07-22T23:59",
        limitations: ["Regional reporting-area value, not a park-level measurement"],
        retrieved_at: RETRIEVED_A,
      }),
      ...confirmations(RETRIEVED_A),
    ],
    coverage_gaps: [],
  };
}

/** Snapshot B: refreshed during final validation. Heat now fails; AQI is missing. */
export function refreshedSnapshot(event_id: string, event_version: number): EvidenceSnapshot {
  return {
    ...baseSnapshot(REFRESHED_SNAPSHOT_ID, event_id, event_version, RETRIEVED_B),
    items: [
      ...referenceEvidence(RETRIEVED_B),
      evidence({
        id: "ev-c3b-temp-0900",
        metric: "temperature",
        value: 92,
        unit: "F",
        source: "NWS (fixture)",
        park_id: PARK,
        scope: "forecast_grid",
        valid_from: START,
        valid_to: "2026-07-22T10:00",
        retrieved_at: RETRIEVED_B,
      }),
      evidence({
        id: "ev-c3b-aqi-missing",
        metric: "aqi",
        value: null,
        missing_reason: "AirNow unavailable after the configured retry limit",
        source: "AirNow (fixture)",
        park_id: null,
        scope: "reporting_area",
        area_label: "New York City",
        valid_from: "2026-07-22T00:00",
        valid_to: "2026-07-22T23:59",
        retrieved_at: RETRIEVED_B,
      }),
      ...confirmations(RETRIEVED_B),
    ],
    coverage_gaps: [AQI_GAP],
  };
}

const plan = candidatePlan({
  candidate: CAND,
  workout_template_id: TEMPLATE,
  duration_minutes: 45,
  session_outline: ["Warm-up walk and mobility", "Bodyweight circuit", "Cool-down stretch"],
});
const assessed = { park_id: PARK, start_time: START, workout_template_id: TEMPLATE };

function sharedChecks(): CheckResult[] {
  return [
    check(assessed, { check_id: "event_constraints.start_window", area: "event_constraints", status: "pass", reason: "9:00 is within the allowed window" }),
    check(assessed, { check_id: "duration.fits", area: "duration", status: "pass", reason: "Template is 45 minutes" }),
    check(assessed, { check_id: "equipment.available", area: "equipment", status: "pass", reason: "No equipment required" }),
    check(assessed, { check_id: "space_surface.space", area: "space_surface", status: "pass", reason: "Organizer confirmed stationary space at Park A", evidence_ids: ["ev-c3-space-confirm"] }),
    check(assessed, { check_id: "permissions.permit_review", area: "permissions", status: "pass", reason: "Organizer recorded permit review", evidence_ids: ["ev-c3-permit-confirm"], critical: false }),
  ];
}

/** Planning draft on snapshot A: the version the organizer approved. */
export function planningOutput(event_version: number): PlanningOutput {
  return {
    event_version,
    evidence_snapshot_id: SNAPSHOT_ID,
    status: "draft",
    plan,
    facts: [
      { claim: "Forecast temperature at 9 a.m. is 84°F", status: "verified", evidence_ids: ["ev-c3a-temp-0900"], missing_reason: null },
      { claim: "Regional AQI is 48 (Good) for New York City", status: "verified", evidence_ids: ["ev-c3a-aqi"], missing_reason: null },
    ],
    rule_checks: checkResult(event_version, SNAPSHOT_ID, [
      ...sharedChecks(),
      check(assessed, { check_id: "heat.max_temperature", area: "heat", status: "pass", reason: "84°F is below the 90°F fixture limit", evidence_ids: ["ev-c3a-temp-0900"] }),
      check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "pass", reason: "AQI 48 is below the 100 fixture limit", evidence_ids: ["ev-c3a-aqi"] }),
      check(assessed, { check_id: "freshness.conditions", area: "freshness", status: "pass", reason: "Fixture evidence covers the full event interval" }),
    ]),
    concerns: [],
    organizer_tasks: [],
  };
}

/** Reassessment of the same plan on snapshot B. This is the expected final result. */
export function refreshedPlanningOutput(event_version: number): PlanningOutput {
  return {
    event_version,
    evidence_snapshot_id: REFRESHED_SNAPSHOT_ID,
    status: "needs_verification",
    plan,
    facts: [
      { claim: "Refreshed forecast temperature at 9 a.m. is 92°F", status: "verified", evidence_ids: ["ev-c3b-temp-0900"], missing_reason: null },
      { claim: "Regional AQI for the event", status: "missing", evidence_ids: ["ev-c3b-aqi-missing"], missing_reason: "AirNow unavailable after the configured retry limit" },
    ],
    rule_checks: checkResult(event_version, REFRESHED_SNAPSHOT_ID, [
      ...sharedChecks(),
      check(assessed, { check_id: "heat.max_temperature", area: "heat", status: "fail", reason: "92°F exceeds the 90°F fixture limit", evidence_ids: ["ev-c3b-temp-0900"] }),
      check(assessed, { check_id: "air_quality.max_aqi", area: "air_quality", status: "unknown", reason: "No AQI value: AirNow unavailable after the retry limit", evidence_ids: ["ev-c3b-aqi-missing"] }),
      check(assessed, { check_id: "freshness.conditions", area: "freshness", status: "unknown", reason: "AQI evidence does not cover the event interval" }),
    ]),
    concerns: [
      { id: "concern-heat", description: "Refreshed forecast blocks 9 a.m. under the heat policy; the version 1 approval no longer applies", blocking: true, related_check_ids: ["heat.max_temperature"] },
      { id: "concern-aqi", description: "AQI is missing; no substitute value is used", blocking: true, related_check_ids: ["air_quality.max_aqi", "freshness.conditions"] },
    ],
    organizer_tasks: [
      { id: "task-new-time", description: "Choose a cooler start time or another date; the revised plan needs a new approval", resolves_check_id: "heat.max_temperature", park_id: PARK, start_time: null },
      { id: "task-recheck-aqi", description: "Recheck AQI once AirNow is available", resolves_check_id: "air_quality.max_aqi", park_id: null, start_time: null },
    ],
  };
}

/** Registry entry for snapshot B, so stubs return the reassessment for runs bound to it. */
export const refreshed = {
  SNAPSHOT_ID: REFRESHED_SNAPSHOT_ID,
  expected,
  brief,
  snapshot: refreshedSnapshot,
  planningOutput: refreshedPlanningOutput,
};
