import type {
  CheckId,
  CheckResult,
  CheckStatus,
  EvidenceSnapshot,
  FieldDayEvent,
  LifecycleStatus,
  PlanVersion,
} from "@/contracts";

/**
 * Pure helpers for the event workspace (owner: Yadan, tasks YT-09 to YT-12). Kept out of the
 * components so they can be tested without a browser.
 */

export function currentVersion(event: FieldDayEvent): PlanVersion {
  const v = event.versions.find((x) => x.version === event.current_version);
  if (!v) throw new Error(`Event ${event.id} has no version ${event.current_version}`);
  return v;
}

/** Icon + words for a check result. Unknown is never styled like pass. */
export const CHECK_STATUS: Record<CheckStatus, { icon: string; label: string; tone: string }> = {
  pass: { icon: "✓", label: "Pass", tone: "text-emerald-800 bg-emerald-50 ring-emerald-300" },
  fail: { icon: "✕", label: "Fail", tone: "text-rose-800 bg-rose-50 ring-rose-300" },
  unknown: { icon: "?", label: "Unknown", tone: "text-amber-900 bg-amber-50 ring-amber-300" },
};

const CHECK_NAMES: Record<CheckId, string> = {
  "event_constraints.start_window": "Start window",
  "event_constraints.allowed_park": "Allowed park",
  "equipment.available": "Equipment",
  "duration.fits": "Workout length",
  "heat.max_temperature": "Heat limit",
  "air_quality.max_aqi": "Air quality limit",
  "freshness.conditions": "Up-to-date weather and air data",
  "space_surface.space": "Workout space",
  "space_surface.surface": "Ground surface",
  "permissions.permit_review": "Permit review",
};

export function checkName(id: CheckId): string {
  return CHECK_NAMES[id] ?? id;
}

/** Failed first, then unknown, then pass; critical before non-critical within each. */
export function sortChecks(checks: CheckResult[]): CheckResult[] {
  const rank: Record<CheckStatus, number> = { fail: 0, unknown: 1, pass: 2 };
  return [...checks].sort((a, b) => rank[a.status] - rank[b.status] || Number(b.critical) - Number(a.critical));
}

/** Which buttons the workspace shows. Mirrors ACTION_FROM in src/server/lifecycle/transitions.ts. */
export interface Actions {
  generate: boolean;
  recheck: boolean;
  reportChange: boolean;
  requestReview: boolean;
  applyOption: boolean;
  confirm: boolean;
  approve: boolean;
  finalize: boolean;
  editBrief: boolean;
}

export function availableActions(v: PlanVersion): Actions {
  const s = v.status;
  const hasPlan = v.plan !== null;
  const open: LifecycleStatus[] = ["needs_verification", "ready_for_approval", "approved", "no_feasible_option"];
  return {
    generate: true,
    recheck: hasPlan && s !== "draft",
    reportChange: hasPlan && open.includes(s),
    requestReview: hasPlan && open.includes(s),
    applyOption: v.alternatives !== null && [...open, "finalized"].includes(s),
    confirm: hasPlan && ["needs_verification", "ready_for_approval", "approved"].includes(s),
    approve: s === "ready_for_approval",
    finalize: s === "approved",
    editBrief: true,
  };
}

/** Why Approve is unavailable, in plain words. Null when it is available. */
export function approveBlockedReason(v: PlanVersion): string | null {
  switch (v.status) {
    case "ready_for_approval":
      return null;
    case "draft":
      return v.plan ? "Generate the plan before approving." : "Generate a plan first.";
    case "needs_verification":
      return "Some critical checks failed or are not confirmed. Resolve the blockers below first.";
    case "no_feasible_option":
      return "No workable option was found. Edit the brief or request a review.";
    case "approved":
      return `v${v.version} is already approved.`;
    case "finalized":
      return `v${v.version} is finalized.`;
  }
}

export function parkName(snapshot: EvidenceSnapshot | null, id: string | null): string {
  if (!id) return "No park yet";
  return snapshot?.park_candidates.find((p) => p.id === id)?.name ?? id;
}

export function templateName(snapshot: EvidenceSnapshot | null, id: string | null): string {
  if (!id) return "No workout yet";
  return snapshot?.workout_templates.find((t) => t.id === id)?.name ?? id;
}

export function adaptationName(snapshot: EvidenceSnapshot | null, templateId: string | null, id: string): string {
  const t = snapshot?.workout_templates.find((x) => x.id === templateId);
  return t?.permitted_adaptations.find((a) => a.id === id)?.description ?? id;
}

/** "2026-07-16T10:00" -> "Thu, Jul 16 · 10:00 AM". Event times are New York local times with no offset. */
export function formatLocal(dt: string | null): string {
  if (!dt) return "No time yet";
  const [date, time] = dt.split("T");
  const d = new Date(`${date}T00:00:00Z`);
  const [h, m] = time.split(":").map(Number);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const hour = ((h + 11) % 12) + 1;
  return `${day} · ${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** One key per finalize attempt of a version, so a double click or retry never saves twice. */
export function finalizeKey(eventId: string, version: number): string {
  return `finalize-${eventId}-v${version}`;
}
