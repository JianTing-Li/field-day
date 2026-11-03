import type { ChangeItem, EventBrief, EvidenceSnapshot, PlanVersion } from "@/contracts";
import { equipmentLabel } from "../brief-form";
import { formatClock, formatEventDate } from "../format";
import { formatLocal, parkName } from "./logic";

/**
 * "Something changed?" in plain words (JT-28): each change FieldDay read, and what it will do about
 * it, so the organizer can check the list before anything changes.
 */

export interface ChangeLine {
  icon: string;
  /** What changed: "Group: 200 → 500 people". */
  what: string;
  /** What FieldDay does about it: "Re-plans for 500". For a note, FieldDay's answer. */
  then: string;
  /** Something FieldDay can't act on. */
  note: boolean;
}

export function changeLine(i: ChangeItem, brief: EventBrief, plan: PlanVersion["plan"], snapshot: EvidenceSnapshot | null): ChangeLine {
  const park = parkName(snapshot, plan?.park_id ?? null);
  const time = plan?.start_time ? formatLocal(plan.start_time).split(" · ").at(-1) : "this time";
  const line = (icon: string, what: string, then: string): ChangeLine => ({ icon, what, then, note: false });
  switch (i.type) {
    case "report":
      return {
        space: line("🚧", `No room at ${park}`, "Looks for another spot or time"),
        ground: line("💧", `Ground unsafe at ${park}`, "Looks for another spot or time"),
        rain: line("🌧", `Rain at ${time}`, "Looks for a drier time or place"),
        time: line("⏰", `${time} doesn't work`, "Looks for another time"),
      }[i.what];
    case "start_window":
      return line(
        "⏰",
        i.earliest === i.latest ? `Start at ${formatClock(i.earliest)}` : `Start ${formatClock(i.earliest)}–${formatClock(i.latest)}`,
        "Re-plans in the new time",
      );
    case "date":
      return line("📅", `Move to ${formatEventDate(i.date).replace(/, \d{4}$/, "")}`, "Re-plans for that day");
    case "group_size":
      return line("👥", `Group: ${brief.group_size} → ${i.group_size} people`, `Re-plans for ${i.group_size}`);
    case "duration":
      return line("⏱", `Length: ${brief.duration_minutes} → ${i.duration_minutes} min`, "Re-plans to fit");
    case "equipment_missing":
      return line("🎒", `No ${i.equipment.map(equipmentLabel).join(", ").toLowerCase()}`, "Plans without it");
    case "avoid_exercises":
      return line("🚫", `Leave out ${i.exercises.join(", ")}`, "Plans without it");
    case "avoid_park":
      return line("📍", `Skip ${parkName(snapshot, i.park_id)}`, "Plans at your other parks");
    case "note":
      return { icon: "💬", what: `“${i.said}”`, then: i.reply, note: true };
  }
}

/** The button under the list: what applying it will do. */
export function applyLabel(items: ChangeItem[]): string {
  const acts = items.filter((i) => i.type !== "note").length;
  if (acts === 0) return "Got it";
  return acts === 1 ? "Make this change" : `Make these ${acts} changes`;
}

/** The progress label while applying, so the wait note says the right thing. */
export function applyWork(items: ChangeItem[]): string {
  if (items.every((i) => i.type === "note")) return "Saving your note";
  return items.some((i) => i.type !== "note" && i.type !== "report") ? "Re-planning" : "Finding a fix";
}
