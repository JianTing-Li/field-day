import {
  isConfirmableCheck,
  type CheckId,
  type CheckPlanResult,
  type CheckResult,
  type CheckStatus,
  type EvidenceSnapshot,
  type FieldDayEvent,
  type LifecycleStatus,
  type PlanVersion,
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
  pass: { icon: "✓", label: "Pass", tone: "text-ink bg-mint" },
  fail: { icon: "✕", label: "Fail", tone: "text-ink bg-danger" },
  unknown: { icon: "?", label: "Unknown", tone: "text-ink bg-butter" },
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
      return "Draft a plan first.";
    case "needs_verification":
      return "Some critical checks failed or are not confirmed. Resolve what's blocking this plan, listed above, first.";
    case "no_feasible_option":
      return "No safe option was found. Edit the brief or find alternatives.";
    case "approved":
      return "This plan is already approved.";
    case "finalized":
      return "This plan is locked in.";
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

/**
 * Swaps park IDs in agent-written text for park names: "McCarren Park (park-b058)" -> "McCarren Park",
 * "park-b058" -> "McCarren Park". Unknown IDs are left as they are.
 */
export function withParkNames(text: string, snapshot: EvidenceSnapshot | null): string {
  const name = (id: string) => snapshot?.park_candidates.find((p) => p.id === id)?.name;
  return text
    .replace(/\s*\((park-[a-z0-9-]+)\)/g, (m, id: string) => (name(id) ? "" : m))
    .replace(/\bpark-[a-z0-9-]+\b/g, (id) => name(id) ?? id);
}

/** Swaps check IDs inside a harness message for their plain names ("space_surface.surface" -> "ground surface"). */
export function plainIds(text: string): string {
  return text.replace(/\b[a-z_]+\.[a-z_]+\b/g, (id) => {
    const name = checkName(id as CheckId);
    return name === id ? id : name.toLowerCase();
  });
}

/**
 * Agent and rule text, in the organizer's words (F-13, F-17): park, template and check IDs become
 * names, and the "(unreviewed demo policy)" label is dropped because the banner states it once.
 */
export function plainText(text: string, snapshot: EvidenceSnapshot | null): string {
  const template = (id: string) => snapshot?.workout_templates.find((t) => t.id === id)?.name;
  return plainIds(withParkNames(text, snapshot))
    .replace(/\s*\((tpl-[a-z0-9-]+)\)/g, (m, id: string) => (template(id) ? "" : m))
    .replace(/\btpl-[a-z0-9-]+\b/g, (id) => template(id) ?? id)
    .replace(/\s*\(unreviewed demo policy\)/g, "");
}

/** The overall result in a few plain words: "All checks pass", "2 to confirm", "1 problem". */
export function overallLabel(checks: CheckPlanResult): string {
  const critical = checks.checks.filter((c) => c.critical);
  const failed = critical.filter((c) => c.status === "fail").length;
  const unknown = critical.filter((c) => c.status === "unknown").length;
  if (failed > 0) return `${failed} problem${failed === 1 ? "" : "s"}`;
  if (unknown > 0) return `${unknown} not checked yet`;
  return "All checks pass";
}

/** Something only the organizer can check at the park, with the sentence they confirm (F-15). */
export interface ConfirmItem {
  check_id: CheckId;
  park_id: string;
  start_time: string | null;
  /** Blocks approval until confirmed (space and surface); permit is advisory. */
  required: boolean;
  question: string;
  statement: string;
}

/**
 * What the organizer can confirm for the current plan, taken from the harness's own checks rather
 * than from agent to-dos (D-JT24-1): every space, surface or permit check that is still unknown at
 * the plan's park. Nothing else can be confirmed, so nothing else is offered.
 */
export function confirmItems(v: PlanVersion, snapshot: EvidenceSnapshot | null, groupSize: number): ConfirmItem[] {
  const p = v.plan;
  if (!p?.park_id || !v.checks) return [];
  const park = parkName(snapshot, p.park_id);
  const when = formatLocal(p.start_time);
  const template = snapshot?.workout_templates.find((t) => t.id === p.workout_template_id);
  const layout =
    p.adaptation_ids
      .map((id) => template?.permitted_adaptations.find((a) => a.id === id)?.resulting_layout)
      .filter(Boolean)
      .at(-1) ?? template?.space.layout;
  const room = layout === "running_lane" || layout === "loop_path" ? "a clear running path" : "open, flat space";
  const surfaces = template?.surfaces.length ? template.surfaces.join(", ") : "a safe surface";
  return v.checks.checks
    .filter((c) => c.status === "unknown" && isConfirmableCheck(c.check_id) && c.assessed.park_id === p.park_id)
    .map((c) => {
      const base = { check_id: c.check_id, park_id: p.park_id!, start_time: c.assessed.start_time, required: c.critical };
      if (c.check_id === "space_surface.space") {
        return {
          ...base,
          question: `Is there room at ${park}?`,
          statement: `I checked: there's ${room} for ${groupSize} people at ${park} at ${when}.`,
        };
      }
      if (c.check_id === "space_surface.surface") {
        return {
          ...base,
          question: `Is the ground right at ${park}?`,
          statement: `I checked: the ground at ${park} is suitable for this workout (${surfaces}).`,
        };
      }
      return {
        ...base,
        question: `Do you need a permit at ${park}?`,
        statement: `I checked: a permit is sorted, or not needed, for ${groupSize} people at ${park} at ${when}.`,
      };
    })
    .sort((a, b) => Number(b.required) - Number(a.required));
}

/**
 * Coverage gaps in one or two plain lines (F-26): the snapshot lists one gap per park and provider,
 * which for a far-off date is twenty lines saying the same thing.
 */
export function gapSummary(gaps: string[], snapshot: EvidenceSnapshot | null): string[] {
  const weather = gaps.filter((g) => /^NWS hourly forecast .* does not cover/.test(g));
  const air = gaps.filter((g) => /^AirNow has no forecast/.test(g));
  const rest = gaps.filter((g) => !weather.includes(g) && !air.includes(g));
  return [
    ...(weather.length > 0 ? ["No weather forecast reaches this time yet."] : []),
    ...(air.length > 0 ? ["No air-quality forecast for this date yet."] : []),
    ...rest.map((g) => plainText(g, snapshot)),
  ];
}
