import type { CandidatePlan, CheckPlanResult, LifecycleStatus, PlanVersion } from "@/contracts";
import { ServiceError } from "./errors";

/**
 * Lifecycle state rules (PRD §2 "Event lifecycle"). The single place that says which
 * status changes are allowed. Status lives on each plan version; the event's status is
 * the status of its current version.
 */

export type LifecycleAction =
  | "update_brief"
  | "generate"
  | "recheck"
  | "report_change"
  | "request_review"
  | "apply_option"
  | "add_confirmation"
  | "approve"
  | "finalize"
  | "invalidate_approval";

const ALL: LifecycleStatus[] = [
  "draft",
  "needs_verification",
  "ready_for_approval",
  "approved",
  "finalized",
  "no_feasible_option",
];

/**
 * The statuses of the current version each action may start from. Actions that create a
 * new version (brief edit, generate, recheck with new evidence, apply option) leave the
 * old version frozen; the new version gets a status from deriveStatus.
 */
export const ACTION_FROM: Record<Exclude<LifecycleAction, "invalidate_approval">, LifecycleStatus[]> = {
  update_brief: ALL,
  generate: ALL,
  recheck: ["needs_verification", "ready_for_approval", "approved", "finalized", "no_feasible_option"],
  apply_option: ["needs_verification", "ready_for_approval", "approved", "finalized", "no_feasible_option"],
  report_change: ["needs_verification", "ready_for_approval", "approved", "no_feasible_option"],
  request_review: ["needs_verification", "ready_for_approval", "approved", "no_feasible_option"],
  add_confirmation: ["needs_verification", "ready_for_approval", "approved"],
  approve: ["ready_for_approval"],
  finalize: ["approved"],
};

/** In-place status changes on one version. Every other change is rejected. */
export const TRANSITIONS: ReadonlyArray<{ from: LifecycleStatus; to: LifecycleStatus; action: LifecycleAction }> = [
  { from: "needs_verification", to: "ready_for_approval", action: "add_confirmation" },
  { from: "ready_for_approval", to: "approved", action: "approve" },
  { from: "approved", to: "ready_for_approval", action: "invalidate_approval" },
  { from: "approved", to: "finalized", action: "finalize" },
];

const HINT: Partial<Record<LifecycleStatus, string>> = {
  draft: "Generate a draft first",
  finalized: "The finalized version cannot change; edit the brief to start a new draft",
  no_feasible_option: "No feasible option; edit the brief or request a review",
};

/** Throws unless `action` may start from the version's current status. */
export function assertCanStart(action: keyof typeof ACTION_FROM, v: PlanVersion): void {
  if (ACTION_FROM[action].includes(v.status)) return;
  if (action === "approve" && v.status === "needs_verification") {
    throw new ServiceError(
      "blocked",
      `Version ${v.version} is needs_verification, not ready for approval`,
      v.checks?.blockers ?? [],
    );
  }
  const hint = HINT[v.status];
  throw new ServiceError(
    "invalid_request",
    `Cannot ${action.replaceAll("_", " ")} while version ${v.version} is ${v.status}${hint ? `. ${hint}` : ""}`,
    { action, from: v.status },
  );
}

/** Moves one version to `to` if the table allows it; otherwise throws. */
export function transition(v: PlanVersion, to: LifecycleStatus, action: LifecycleAction): void {
  const ok = TRANSITIONS.some((t) => t.from === v.status && t.to === to && t.action === action);
  if (!ok) {
    throw new ServiceError(
      "invalid_request",
      `Version ${v.version} cannot move from ${v.status} to ${to} (${action})`,
      { action, from: v.status, to },
    );
  }
  v.status = to;
}

/**
 * Status of a newly created version. Unknown or failed critical checks never give
 * ready_for_approval. An agent's needs_verification is kept even when the checks pass.
 */
export function deriveStatus(
  plan: CandidatePlan | null,
  checks: CheckPlanResult | null,
  agentStatus?: string,
): LifecycleStatus {
  if (agentStatus === "no_feasible_option") return "no_feasible_option";
  if (!plan) return "draft";
  if (checks?.overall === "pass" && agentStatus !== "needs_verification") return "ready_for_approval";
  return "needs_verification";
}
