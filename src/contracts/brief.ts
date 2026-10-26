import { z } from "zod";
import { Id, IsoDate, LocalTime, TimeZone } from "./common";

/** Organizer's event brief and constraints (PRD §3 "Shared state and ownership"). */
export const EventBrief = z
  .object({
    title: z.string().min(1),
    date: IsoDate,
    time_zone: TimeZone,
    /** Allowed start window, inclusive. */
    start_window: z.object({ earliest: LocalTime, latest: LocalTime }),
    duration_minutes: z.number().int().positive(),
    group_size: z.number().int().positive(),
    /** Curated park IDs the organizer allows. */
    allowed_park_ids: z.array(Id).min(1),
    preferred_park_id: Id.nullable(),
    /** Preferred workout template, or null to let Planning choose from approved templates. */
    workout_template_id: Id.nullable(),
    equipment_available: z.array(z.string()),
    exercise_exclusions: z.array(z.string()),
    instructor_limits: z.object({
      max_temperature_f: z.number().nullable(),
      max_aqi: z.number().int().nullable(),
      notes: z.string().nullable(),
    }),
    /** Organizer priorities used to rank equally valid alternatives (open decision in PRD §4). */
    priorities: z.array(z.string()),
  })
  .refine((b) => b.start_window.earliest <= b.start_window.latest, {
    message: "Earliest start must not be after latest start",
    path: ["start_window"],
  })
  .refine((b) => b.preferred_park_id === null || b.allowed_park_ids.includes(b.preferred_park_id), {
    message: "Preferred park must be one of the allowed parks",
    path: ["preferred_park_id"],
  });
export type EventBrief = z.infer<typeof EventBrief>;
