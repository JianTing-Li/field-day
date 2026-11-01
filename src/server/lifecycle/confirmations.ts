import {
  isConfirmableCheck,
  type CandidatePlan,
  type ChangeReportRecord,
  type CheckPlanResult,
  type CheckResult,
  type OrganizerConfirmation,
  type WorkoutTemplate,
} from "@/contracts";
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

/**
 * `layout` is the layout of the plan the check belongs to. Only space, surface and permit checks can
 * be confirmed (D-JT24-1); a stored confirmation for any other check, made before that rule, is ignored.
 */
export function confirmationMatches(conf: Scope, check: CheckResult, layout: Layout | null): boolean {
  if (!isConfirmableCheck(check.check_id)) return false;
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

type Report = Pick<ChangeReportRecord, "at" | "check_id" | "park_id" | "start_time" | "layout" | "description">;

/** Whether an organizer report covers this check: same check, its park (or every park), its time (or any time). */
function reportMatches(r: Report, check: CheckResult, layout: Layout | null): boolean {
  if (!r.check_id || r.check_id !== check.check_id) return false;
  if (r.park_id && r.park_id !== check.assessed.park_id) return false;
  if (r.start_time && r.start_time !== check.assessed.start_time) return false;
  // A closed running lane says nothing about a stationary circuit at the same park (D-JT22-1).
  if (check.area === "space_surface" && r.layout && r.layout !== layout) return false;
  return true;
}

/**
 * Organizer reports (D-JT24-12) turn the check they name into a fail: a closed lawn, an unsafe surface,
 * rain the organizer knows about, a time that no longer works. A confirmation made after the report,
 * for the same check and park, supersedes it ("the lawn is open again").
 */
export function applyReports(
  result: CheckPlanResult,
  reports: Report[],
  confirmations: OrganizerConfirmation[],
  layout: Layout | null,
): CheckPlanResult {
  let changed = false;
  const checks = result.checks.map((c) => {
    const report = [...reports].reverse().find((r) => reportMatches(r, c, layout));
    if (!report) return c;
    const cleared = confirmations.some((conf) => conf.confirmed_at > report.at && confirmationMatches(conf, c, layout));
    if (cleared) return c;
    changed = true;
    return { ...c, status: "fail" as const, reason: `You said "${report.description}"`, evidence_ids: [] };
  });
  return changed ? summarizeChecks(result.event_version, result.evidence_snapshot_id, checks) : result;
}
