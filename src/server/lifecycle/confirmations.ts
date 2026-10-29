import type { CandidatePlan, CheckPlanResult, CheckResult, OrganizerConfirmation, WorkoutTemplate } from "@/contracts";
import { summarizeChecks } from "@/server/rules/check-plan";

/**
 * Organizer confirmations (PRD §4, D-012). A confirmation resolves exactly one check at one
 * park, and only at its start time when it names one. It turns unknown into pass; it never
 * overrides a failed check and never carries over to another park or check. Space and surface
 * confirmations also only apply to a plan with the same workout layout (D-JT22-1).
 */

export type Layout = WorkoutTemplate["space"]["layout"];

type Scope = Pick<OrganizerConfirmation, "check_id" | "park_id" | "start_time" | "layout">;

/**
 * The layout a plan's session needs: the last adaptation that changes it, else the template's
 * (same rule as the workout rules). Null when the template or an adaptation is not known.
 */
export function planLayout(plan: CandidatePlan | null, templates: WorkoutTemplate[]): Layout | null {
  const t = templates.find((x) => x.id === plan?.workout_template_id);
  if (!plan || !t) return null;
  let layout: Layout = t.space.layout;
  for (const id of plan.adaptation_ids) {
    const a = t.permitted_adaptations.find((x) => x.id === id);
    if (!a) return null;
    layout = a.resulting_layout ?? layout;
  }
  return layout;
}

/** The layout a new confirmation is about: the current plan's, if it is for the plan's park and time. */
export function confirmationLayout(
  req: Pick<OrganizerConfirmation, "park_id" | "start_time">,
  plan: CandidatePlan | null,
  templates: WorkoutTemplate[],
): Layout | null {
  if (!plan || plan.park_id !== req.park_id) return null;
  if (req.start_time !== null && req.start_time !== plan.start_time) return null;
  return planLayout(plan, templates);
}

/** `layout` is the layout of the plan the check belongs to. */
export function confirmationMatches(conf: Scope, check: CheckResult, layout: Layout | null): boolean {
  if (check.area === "space_surface" && (layout === null || (conf.layout ?? null) !== layout)) return false;
  return (
    check.check_id === conf.check_id &&
    check.assessed.park_id === conf.park_id &&
    (conf.start_time === null || check.assessed.start_time === conf.start_time)
  );
}

/**
 * Applies confirmations to the checks of one plan, whose layout is `layout`.
 * `changed` is true if any check was resolved.
 */
export function applyConfirmations(
  result: CheckPlanResult,
  confirmations: OrganizerConfirmation[],
  layout: Layout | null,
): { checks: CheckPlanResult; changed: boolean } {
  let changed = false;
  const checks = result.checks.map((c) => {
    if (c.status !== "unknown") return c;
    const conf = confirmations.find((x) => confirmationMatches(x, c, layout));
    if (!conf) return c;
    changed = true;
    return { ...c, status: "pass" as const, reason: `Organizer confirmed: ${conf.statement}` };
  });
  if (!changed) return { checks: result, changed };
  return { checks: summarizeChecks(result.event_version, result.evidence_snapshot_id, checks), changed };
}
