import type { CheckPlanResult, CheckResult, OrganizerConfirmation } from "@/contracts";
import { summarizeChecks } from "@/server/rules/check-plan";

/**
 * Organizer confirmations (PRD §4, D-012). A confirmation resolves exactly one check at one
 * park, and only at its start time when it names one. It turns unknown into pass; it never
 * overrides a failed check and never carries over to another park or check.
 */

type Scope = Pick<OrganizerConfirmation, "check_id" | "park_id" | "start_time">;

export function confirmationMatches(conf: Scope, check: CheckResult): boolean {
  return (
    check.check_id === conf.check_id &&
    check.assessed.park_id === conf.park_id &&
    (conf.start_time === null || check.assessed.start_time === conf.start_time)
  );
}

/** Applies confirmations to a check result. `changed` is true if any check was resolved. */
export function applyConfirmations(
  result: CheckPlanResult,
  confirmations: OrganizerConfirmation[],
): { checks: CheckPlanResult; changed: boolean } {
  let changed = false;
  const checks = result.checks.map((c) => {
    if (c.status !== "unknown") return c;
    const conf = confirmations.find((x) => confirmationMatches(x, c));
    if (!conf) return c;
    changed = true;
    return { ...c, status: "pass" as const, reason: `Organizer confirmed: ${conf.statement}` };
  });
  if (!changed) return { checks: result, changed };
  return { checks: summarizeChecks(result.event_version, result.evidence_snapshot_id, checks), changed };
}
