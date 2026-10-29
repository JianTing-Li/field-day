import type { ParkCandidate, WorkoutTemplate } from "@/contracts";
import parks from "@/server/content/parks.json";
import workouts from "@/server/content/workouts.json";
import type { ParkOption, TemplateOption } from "./BriefForm";

/** Curated parks and workout templates for the brief form, read on the server. Task YT-08. */
export function briefFormOptions(): { parks: ParkOption[]; templates: TemplateOption[] } {
  return {
    parks: (parks as ParkCandidate[])
      .map((p) => ({ id: p.id, name: p.name, borough: p.borough }))
      .sort((a, b) => a.borough.localeCompare(b.borough) || a.name.localeCompare(b.name)),
    templates: (workouts as WorkoutTemplate[]).map((t) => ({
      id: t.id,
      name: t.name,
      duration_minutes: t.duration_minutes,
      equipment: t.equipment,
      reviewed: t.review.status === "reviewed",
    })),
  };
}
