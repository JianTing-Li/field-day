import type { CheckId, CheckResult, CheckStatus, EvidenceItem, PolicyArea, RuleFn, RuleInput } from "@/contracts";

/**
 * Event-constraint rules (owner: JT, task JT-05): allowed parks, start window,
 * time zone, and the 20-or-more permit-review warning (non-critical).
 * Missing plan values are unknown, never pass. Critical flags for event constraints
 * are provisional until check_plan decides them (JT-06).
 */

export const LOGISTICS_POLICY = {
  version: "logistics-rules-v1",
  permit_review: {
    /** Conservative review flag, not a permit determination (PRD §3 "Validation Policies"). */
    group_size_flag: 20,
    source: "NYC Parks permit guidance",
  },
};

function result(
  input: RuleInput,
  check_id: CheckId,
  area: PolicyArea,
  status: CheckStatus,
  reason: string,
  critical: boolean,
  evidence_ids: string[] = [],
): CheckResult {
  return {
    check_id,
    area,
    status,
    critical,
    reason,
    evidence_ids,
    policy_version: LOGISTICS_POLICY.version,
    assessed: {
      park_id: input.plan.park_id,
      start_time: input.plan.start_time,
      workout_template_id: input.plan.workout_template_id,
    },
  };
}

export function allowedParkCheck(input: RuleInput): CheckResult {
  const { plan, brief, snapshot } = input;
  const check = (status: CheckStatus, reason: string, ids: string[] = []) =>
    result(input, "event_constraints.allowed_park", "event_constraints", status, reason, true, ids);

  if (plan.park_id === null) return check("unknown", "No park selected");
  if (!brief.allowed_park_ids.includes(plan.park_id)) {
    return check("fail", `Park ${plan.park_id} is not one of the organizer's allowed parks`);
  }
  const park = snapshot.park_candidates.find((p) => p.id === plan.park_id);
  return check("pass", `Park ${plan.park_id} is one of the organizer's allowed parks`, park ? [park.evidence_id] : []);
}

export function startWindowCheck(input: RuleInput): CheckResult {
  const { plan, brief } = input;
  const { earliest, latest } = brief.start_window;
  const window = `${earliest}–${latest} on ${brief.date} (${brief.time_zone})`;
  const check = (status: CheckStatus, reason: string) =>
    result(input, "event_constraints.start_window", "event_constraints", status, reason, true);

  if (plan.start_time === null) return check("unknown", "No start time selected");
  // Plan and brief are both fixed to America/New_York by the contracts, so local times compare directly.
  const [date, time] = plan.start_time.split("T");
  if (date !== brief.date) return check("fail", `Start date ${date} is not the event date; allowed window is ${window}`);
  if (time < earliest || time > latest) {
    return check("fail", `Start time ${time} is outside the allowed window ${window}`);
  }
  return check("pass", `Start time ${time} is within the allowed window ${window}`);
}

/** Organizer permission records for the plan's park, and its start time when the record has a valid period. */
function permitConfirmations(input: RuleInput): EvidenceItem[] {
  const { plan, snapshot } = input;
  if (plan.park_id === null) return [];
  return snapshot.items.filter(
    (e) =>
      e.evidence_type === "organizer_confirmation" &&
      e.metric === "permission_confirmation" &&
      e.confirms_check_id === "permissions.permit_review" &&
      e.applies_to.park_id === plan.park_id &&
      (e.valid_from === null || (plan.start_time !== null && plan.start_time >= e.valid_from)) &&
      (e.valid_to === null || (plan.start_time !== null && plan.start_time <= e.valid_to)),
  );
}

export function permitReviewCheck(input: RuleInput): CheckResult {
  const size = input.brief.group_size;
  const { group_size_flag, source } = LOGISTICS_POLICY.permit_review;
  const check = (status: CheckStatus, reason: string, ids: string[] = []) =>
    result(input, "permissions.permit_review", "permissions", status, reason, false, ids);

  const records = permitConfirmations(input);
  const denied = records.find((e) => e.value === false);
  if (denied) return check("fail", "Organizer recorded that permission is not in place", [denied.id]);
  const confirmed = records.find((e) => e.value === true);
  if (confirmed) return check("pass", "Organizer recorded permit review for this park", [confirmed.id]);

  if (size >= group_size_flag) {
    return check(
      "unknown",
      `Group of ${size} meets the ${group_size_flag}-or-more permit-review flag (${source}); review permission before the event. ` +
        "This is a conservative warning, not a permit determination",
    );
  }
  return check(
    "unknown",
    `Group of ${size} is below the ${group_size_flag}-or-more permit-review flag; ` +
      "group size alone does not show whether permission is needed, and permit status is not recorded",
  );
}

export const logisticsRules: RuleFn = (input) => [
  startWindowCheck(input),
  allowedParkCheck(input),
  permitReviewCheck(input),
];
