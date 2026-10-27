import type { RuleFn } from "@/contracts";
import { notImplementedCheck } from "./placeholder";

/**
 * Workout rules (owner: Yadan, task YT-04): equipment, duration, space/surface needs
 * of the chosen template and adaptations. Unconfirmed space or surface is unknown.
 */
export const workoutRules: RuleFn = (input) => [
  notImplementedCheck(input, "equipment.available", "equipment", "YT-04"),
  notImplementedCheck(input, "duration.fits", "duration", "YT-04"),
  notImplementedCheck(input, "space_surface.space", "space_surface", "YT-04"),
  notImplementedCheck(input, "space_surface.surface", "space_surface", "YT-04"),
];
