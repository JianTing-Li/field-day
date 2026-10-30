import { EventBrief, TIME_ZONE } from "@/contracts";
import { FORECAST_DAYS, daysFrom } from "./format";

/**
 * Event brief form logic (owner: Yadan, task YT-08). The form keeps everything as text while the
 * organizer types; `toBrief` turns it into an `EventBrief` and validates it with the contract, so
 * the form can never send something the API would reject for its shape.
 */

export interface BriefFormValues {
  title: string;
  date: string;
  earliest: string;
  latest: string;
  duration_minutes: string;
  group_size: string;
  allowed_park_ids: string[];
  preferred_park_id: string;
  workout_template_id: string;
  equipment: string[];
  other_equipment: string;
  exercise_exclusions: string;
  max_temperature_f: string;
  max_aqi: string;
  limit_notes: string;
  priorities: string;
}

export type BriefField = keyof BriefFormValues;
export type BriefErrors = Partial<Record<BriefField, string>>;

export const EMPTY_FORM: BriefFormValues = {
  title: "",
  date: "",
  earliest: "08:00",
  latest: "10:00",
  duration_minutes: "45",
  group_size: "",
  allowed_park_ids: [],
  preferred_park_id: "",
  workout_template_id: "",
  equipment: [],
  other_equipment: "",
  exercise_exclusions: "",
  max_temperature_f: "",
  max_aqi: "",
  limit_notes: "",
  priorities: "",
};

/** Friendly message for each field, used for any contract error on it. */
const MESSAGES: Partial<Record<BriefField, string>> = {
  title: "Give the event a name",
  date: "Pick the event date",
  earliest: "Enter the earliest start time",
  latest: "Enter the latest start time",
  duration_minutes: "Enter the length in whole minutes",
  group_size: "Enter how many people are coming (a whole number)",
  allowed_park_ids: "Choose at least one park",
  max_temperature_f: "Enter a temperature in °F, or leave it blank",
  max_aqi: "Enter a whole-number AQI, or leave it blank",
};

/** Contract path -> form field. */
function fieldFor(path: PropertyKey[]): BriefField | null {
  const [a, b] = path.map(String);
  if (a === "start_window") return b === "latest" ? "latest" : "earliest";
  if (a === "instructor_limits") return b === "max_aqi" ? "max_aqi" : b === "notes" ? "limit_notes" : "max_temperature_f";
  if (a === "equipment_available") return "other_equipment";
  if (a in EMPTY_FORM) return a as BriefField;
  return null;
}

/** "" -> null, "45" -> 45, "abc" -> NaN (the contract then rejects it). */
function num(text: string): number | null {
  const t = text.trim();
  return t === "" ? null : Number(t);
}

/** One item per line (or per comma for equipment), trimmed, blanks and repeats removed. */
function list(text: string, separator: RegExp = /\n/): string[] {
  return [...new Set(text.split(separator).map((s) => s.trim()).filter(Boolean))];
}

/** "Resistance band" -> "resistance_band", matching how templates name equipment. */
export function equipmentId(text: string): string {
  return text.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** "resistance_band" -> "Resistance band". */
export function equipmentLabel(id: string): string {
  const words = id.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * `today` ("YYYY-MM-DD", New York) turns on the "no past dates" rule; leave it out to skip it
 * (e.g. when re-reading a saved brief).
 */
export function toBrief(
  v: BriefFormValues,
  today?: string,
): { ok: true; brief: EventBrief } | { ok: false; errors: BriefErrors } {
  const errors: BriefErrors = {};
  if (today && /^\d{4}-\d{2}-\d{2}$/.test(v.date) && daysFrom(today, v.date) < 0) {
    errors.date = "Pick today or a later date";
  }
  const required = (field: BriefField, n: number | null) => {
    if (n === null) errors[field] = MESSAGES[field];
    return n ?? NaN;
  };

  const candidate = {
    title: v.title.trim(),
    date: v.date,
    time_zone: TIME_ZONE,
    start_window: { earliest: v.earliest, latest: v.latest },
    duration_minutes: required("duration_minutes", num(v.duration_minutes)),
    group_size: required("group_size", num(v.group_size)),
    allowed_park_ids: v.allowed_park_ids,
    preferred_park_id: v.preferred_park_id || null,
    workout_template_id: v.workout_template_id || null,
    equipment_available: [...new Set([...v.equipment, ...list(v.other_equipment, /[,\n]/).map(equipmentId)])],
    exercise_exclusions: list(v.exercise_exclusions),
    instructor_limits: {
      max_temperature_f: num(v.max_temperature_f),
      max_aqi: num(v.max_aqi),
      notes: v.limit_notes.trim() || null,
    },
    priorities: list(v.priorities),
  };

  const parsed = EventBrief.safeParse(candidate);
  if (parsed.success && Object.keys(errors).length === 0) return { ok: true, brief: parsed.data };

  for (const issue of parsed.success ? [] : parsed.error.issues) {
    const field = fieldFor(issue.path);
    if (!field || errors[field]) continue;
    // Cross-field rules (start window order, preferred park) already have friendly messages.
    errors[field] = issue.code === "custom" ? issue.message : (MESSAGES[field] ?? issue.message);
  }
  return { ok: false, errors };
}

export function fromBrief(b: EventBrief, knownEquipment: string[]): BriefFormValues {
  const known = new Set(knownEquipment);
  return {
    title: b.title,
    date: b.date,
    earliest: b.start_window.earliest,
    latest: b.start_window.latest,
    duration_minutes: String(b.duration_minutes),
    group_size: String(b.group_size),
    allowed_park_ids: b.allowed_park_ids,
    preferred_park_id: b.preferred_park_id ?? "",
    workout_template_id: b.workout_template_id ?? "",
    equipment: b.equipment_available.filter((e) => known.has(e)),
    other_equipment: b.equipment_available.filter((e) => !known.has(e)).map(equipmentLabel).join(", "),
    exercise_exclusions: b.exercise_exclusions.join("\n"),
    max_temperature_f: b.instructor_limits.max_temperature_f?.toString() ?? "",
    max_aqi: b.instructor_limits.max_aqi?.toString() ?? "",
    limit_notes: b.instructor_limits.notes ?? "",
    priorities: b.priorities.join("\n"),
  };
}

/** A gentle note (not an error) for dates the forecasts don't reach yet. */
export function dateHint(date: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const days = daysFrom(today, date);
  if (days < 0) return null;
  if (days > FORECAST_DAYS) {
    return `Forecasts only reach about ${FORECAST_DAYS} days ahead, so the weather and air checks will say “unknown” until closer to the day. You can still plan now and check again later.`;
  }
  return null;
}
