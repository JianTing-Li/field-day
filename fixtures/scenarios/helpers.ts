import type {
  CandidatePlan,
  CheckPlanResult,
  CheckId,
  CheckResult,
  CheckStatus,
  EvidenceItem,
  EvidenceMetric,
  EvidenceType,
  ParkCandidate,
  PolicyArea,
  WorkoutTemplate,
} from "@/contracts";
import { summarizeChecks } from "@/server/rules/check-plan";
import parks from "@/server/content/parks.json";
import workouts from "@/server/content/workouts.json";

/** Builders that keep scenario fixtures short. All output is labeled as fixture data. */

export const FIXTURE_RETRIEVED_AT = "2026-10-28T12:00:00Z";
export const FIXTURE_POLICY_VERSION = "fixture-policy-v0";

export const placeholderParks = parks as ParkCandidate[];
export const placeholderTemplates = workouts as WorkoutTemplate[];

export function template(id: string): WorkoutTemplate {
  const t = placeholderTemplates.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown fixture template ${id}`);
  return t;
}

interface EvidenceArgs {
  id: string;
  metric: EvidenceMetric;
  evidence_type?: EvidenceType;
  value: EvidenceItem["value"];
  unit?: string | null;
  category?: string | null;
  pollutant?: string | null;
  missing_reason?: string | null;
  source: string;
  park_id: string | null;
  scope?: EvidenceItem["applies_to"]["scope"];
  area_label?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  limitations?: string[];
  confirms_check_id?: CheckId | null;
  /** Defaults to FIXTURE_RETRIEVED_AT. Set it when a case needs retrieval close to its own date. */
  retrieved_at?: string;
}

export function evidence(a: EvidenceArgs): EvidenceItem {
  const retrieved_at = a.retrieved_at ?? FIXTURE_RETRIEVED_AT;
  return {
    id: a.id,
    metric: a.metric,
    evidence_type: a.evidence_type ?? "forecast",
    origin: "fixture",
    source: { name: a.source, url: null, record_id: null },
    value: a.value,
    unit: a.unit ?? null,
    category: a.category ?? null,
    pollutant: a.pollutant ?? null,
    missing_reason: a.missing_reason ?? null,
    retrieved_at,
    valid_from: a.valid_from ?? null,
    valid_to: a.valid_to ?? null,
    applies_to: {
      scope: a.scope ?? (a.park_id ? "park" : "event"),
      park_id: a.park_id,
      area_label: a.area_label ?? null,
    },
    freshness: { status: "fresh", assessed_at: retrieved_at, note: "Fixture data" },
    limitations: ["Fixture data, not a live observation or forecast", ...(a.limitations ?? [])],
    confirms_check_id: a.confirms_check_id ?? null,
  };
}

/** Reference evidence records for the placeholder parks and the given templates. */
export function referenceEvidence(
  retrieved_at?: string,
  templates: WorkoutTemplate[] = placeholderTemplates,
): EvidenceItem[] {
  return [
    ...placeholderParks.map((p) =>
      evidence({
        id: p.evidence_id,
        metric: "park_record",
        evidence_type: "reference",
        value: p.name,
        source: "Placeholder park list",
        park_id: p.id,
        limitations: ["Placeholder record; does not prove space, capacity or permission"],
        retrieved_at,
      }),
    ),
    ...templates.map((t) =>
      evidence({
        id: t.evidence_id,
        metric: "workout_template",
        evidence_type: "reference",
        value: t.name,
        source: "FieldDay templates",
        park_id: null,
        limitations: ["Placeholder template; not instructor-reviewed"],
        retrieved_at,
      }),
    ),
  ];
}

interface CheckArgs {
  check_id: CheckId;
  area: PolicyArea;
  status: CheckStatus;
  reason: string;
  evidence_ids?: string[];
  critical?: boolean;
}

export function check(
  assessed: CheckResult["assessed"],
  a: CheckArgs,
): CheckResult {
  return {
    check_id: a.check_id,
    area: a.area,
    status: a.status,
    critical: a.critical ?? true,
    reason: a.reason,
    evidence_ids: a.evidence_ids ?? [],
    policy_version: FIXTURE_POLICY_VERSION,
    assessed,
  };
}

/** Builds a CheckPlanResult using the same overall/blocker rules as check_plan. */
export function checkResult(
  event_version: number,
  evidence_snapshot_id: string,
  checks: CheckResult[],
): CheckPlanResult {
  return summarizeChecks(event_version, evidence_snapshot_id, checks);
}

/**
 * Fixture-only workout template. Kept inside the case that uses it so later edits to
 * workouts.json never change an eval input after its first run.
 */
export function fixtureTemplate(
  t: Pick<WorkoutTemplate, "id" | "name" | "duration_minutes" | "intensity" | "exercises" | "equipment" | "space" | "surfaces"> &
    Partial<Pick<WorkoutTemplate, "group_size" | "permitted_adaptations">>,
): WorkoutTemplate {
  return {
    group_size: { min: 1, max: 25 },
    permitted_adaptations: [],
    ...t,
    review: { status: "placeholder", reviewer: null, reviewed_at: null },
    evidence_id: `ev-${t.id}`,
  };
}

interface PlanArgs {
  candidate: { id: string; park_id: string; start_time: string };
  workout_template_id: string;
  duration_minutes: number;
  adaptation_ids?: string[];
  session_outline: string[];
}

export function candidatePlan(a: PlanArgs): CandidatePlan {
  return {
    park_time_candidate_id: a.candidate.id,
    park_id: a.candidate.park_id,
    start_time: a.candidate.start_time,
    time_zone: "America/New_York",
    duration_minutes: a.duration_minutes,
    workout_template_id: a.workout_template_id,
    adaptation_ids: a.adaptation_ids ?? [],
    session_outline: a.session_outline,
  };
}
