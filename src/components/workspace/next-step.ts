import type { CheckId, GateCheck, PlanVersion } from "@/contracts";
import { aboutCurrentPlan, confirmable } from "./ApprovalFlow";
import { checkName } from "./logic";

/**
 * The one thing the organizer should do next on an event (owner: Yadan). Every status gets a plain
 * title, one sentence, and at most one primary action, so the page never makes people guess.
 */

export type StepAction =
  | "generate"
  | "review"
  | "alternatives"
  | "confirm"
  | "recheck"
  | "approve"
  | "finalize"
  | "edit";

export interface NextStep {
  tone: "neutral" | "info" | "warning" | "danger" | "success";
  title: string;
  body: string;
  action: StepAction | null;
  label: string | null;
  /** For "confirm": the organizer task to open. */
  taskId?: string;
}

/** A failed check, in the organizer's words. */
const PROBLEM: Record<CheckId, string> = {
  "heat.max_temperature": "it's too hot",
  "air_quality.max_aqi": "the air quality is too poor",
  "space_surface.space": "the space doesn't work",
  "space_surface.surface": "the ground surface doesn't work",
  "equipment.available": "equipment is missing",
  "duration.fits": "the workout doesn't fit the time",
  "event_constraints.start_window": "the start time is outside your window",
  "event_constraints.allowed_park": "the park isn't one you allowed",
  "freshness.conditions": "the weather data is out of date",
  "permissions.permit_review": "a permit may be needed",
};

const CONDITIONS: CheckId[] = ["heat.max_temperature", "air_quality.max_aqi", "freshness.conditions"];

/** "it's too hot", "it's too hot and the space doesn't work", "it's too hot, … and 1 more problem". */
export function problemSentence(ids: CheckId[]): string {
  const parts = ids.map((id) => PROBLEM[id] ?? id);
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, 2).join(", ")} and ${parts.length - 2} more problem${parts.length > 3 ? "s" : ""}`;
}

/** Swaps check IDs inside a harness message for their plain names ("space_surface.surface" -> "Ground surface"). */
export function plainIds(text: string): string {
  return text.replace(/\b[a-z_]+\.[a-z_]+\b/g, (id) => {
    const name = checkName(id as CheckId);
    return name === id ? id : name.toLowerCase();
  });
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * `gate` is the result of the last lock-in attempt in this session, if any. When it failed, the
 * next step says so instead of offering the same button again.
 */
export function nextStep(v: PlanVersion, gate: GateCheck[] | null = null): NextStep {
  const failedGate = gate?.filter((g) => g.status === "fail") ?? [];
  if (v.status === "approved" && failedGate.length > 0) {
    return {
      tone: "danger",
      title: "Can't lock it in yet",
      body: `The final checks found: ${failedGate.map((g) => plainIds(g.reason)).join("; ")}. See "Approve and lock in" below for details.`,
      action: null,
      label: null,
    };
  }
  switch (v.status) {
    case "finalized":
      return {
        tone: "success",
        title: "Locked in",
        body: "This is your final plan. Nothing was booked or sent: share it with your group when you're ready.",
        action: null,
        label: null,
      };
    case "approved":
      return {
        tone: "success",
        title: "Approved: one step left",
        body: "Lock it in to run the final safety checks and save it as your final plan.",
        action: "finalize",
        label: "Lock it in",
      };
    case "ready_for_approval":
      return {
        tone: "success",
        title: "Everything checks out",
        body: "Every safety check passes for this park, time and workout. Approve it when you're happy with it.",
        action: "approve",
        label: "Approve plan",
      };
    case "no_feasible_option":
      return {
        tone: "danger",
        title: "No safe option found",
        body: "None of your allowed parks and times works for this workout. Try another date, a wider time window or more parks.",
        action: "edit",
        label: "Edit the brief",
      };
    case "draft":
      return {
        tone: "neutral",
        title: v.plan ? "Draft a fresh plan" : "Start with a plan",
        body: "FieldDay picks a park, time and workout from your brief and checks them against the weather and air quality.",
        action: "generate",
        label: "Draft a plan",
      };
    case "needs_verification":
      return needsVerification(v);
  }
}

function needsVerification(v: PlanVersion): NextStep {
  const checks = v.checks?.checks ?? [];
  const failed = checks.filter((c) => c.critical && c.status === "fail").map((c) => c.check_id);
  if (failed.length > 0) {
    const problems = capitalize(problemSentence(failed));
    return v.alternatives
      ? {
          tone: "warning",
          title: "Pick one of the alternatives",
          body: `${problems} for this plan, so FieldDay found other options. Compare them below.`,
          action: "alternatives",
          label: "See alternatives",
        }
      : {
          tone: "danger",
          title: `${problems}`,
          body: "This plan won't work as is. FieldDay can look for a different time, park or workout that fixes it.",
          action: "review",
          label: "Find alternatives",
        };
  }

  const tasks = v.organizer_tasks.filter((t) => confirmable(t) && aboutCurrentPlan(t, v.plan));
  if (tasks.length > 0) {
    return {
      tone: "warning",
      title: tasks.length === 1 ? "One thing left to confirm" : `${tasks.length} things left to confirm`,
      body: tasks[0].description,
      action: "confirm",
      label: "Confirm now",
      taskId: tasks[0].id,
    };
  }

  const unknown = checks.filter((c) => c.critical && c.status === "unknown").map((c) => c.check_id);
  if (unknown.some((id) => CONDITIONS.includes(id))) {
    return {
      tone: "info",
      title: "Waiting on weather data",
      body: "There's no current forecast for this time yet, so FieldDay can't call it safe. Check again closer to the day.",
      action: "recheck",
      label: "Check the latest weather",
    };
  }
  return {
    tone: "warning",
    title: "Some checks aren't confirmed yet",
    body: "See what's missing below. Nothing can be approved until it's confirmed.",
    action: null,
    label: null,
  };
}
