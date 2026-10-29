import type { LifecycleStatus } from "@/contracts";

/**
 * Display helpers shared by the UI (owner: Yadan). Every status is shown as an icon plus words,
 * never color alone.
 */

export interface StatusStyle {
  label: string;
  /** One-line meaning, used as the badge's tooltip and for screen readers. */
  hint: string;
  icon: string;
  tone: "neutral" | "warning" | "info" | "success" | "final" | "danger";
}

export const STATUS: Record<LifecycleStatus, StatusStyle> = {
  draft: { label: "Draft", hint: "No plan generated yet, or a plan is being edited", icon: "✎", tone: "neutral" },
  needs_verification: {
    label: "Needs checking",
    hint: "Some critical checks failed or are not confirmed yet",
    icon: "!",
    tone: "warning",
  },
  ready_for_approval: {
    label: "Ready for approval",
    hint: "Every critical check passes; waiting for the organizer to approve",
    icon: "●",
    tone: "info",
  },
  approved: { label: "Approved", hint: "The organizer approved this exact version", icon: "✓", tone: "success" },
  finalized: { label: "Finalized", hint: "Saved as the final event record", icon: "🔒", tone: "final" },
  no_feasible_option: {
    label: "No workable option",
    hint: "No park, time and workout satisfies the constraints",
    icon: "✕",
    tone: "danger",
  },
};

/** "2026-10-29" -> "Thu, Oct 29, 2026". Read as a calendar date so no time zone can shift the day. */
export function formatEventDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-10-28T18:05:00Z" -> "Oct 28, 2:05 PM" in New York time, where every FieldDay event is. */
export function formatUpdated(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return timestamp;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/** "Version 3" plus, when it differs, which version was finalized. */
export function versionText(current: number, finalized: number | null): { current: string; finalized: string } {
  return {
    current: `v${current}`,
    finalized: finalized === null ? "Not finalized" : finalized === current ? `v${finalized} (current)` : `v${finalized}`,
  };
}

/** "08:00" -> "8:00 AM", "13:30" -> "1:30 PM". Event times are New York wall-clock times. */
export function formatClock(time: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "starts at 9:00 AM" when the window is a single time, otherwise "starts between 8:00 AM and 10:00 AM". */
export function startWindowText(earliest: string, latest: string): string {
  return earliest === latest
    ? `starts at ${formatClock(earliest)}`
    : `starts between ${formatClock(earliest)} and ${formatClock(latest)}`;
}
