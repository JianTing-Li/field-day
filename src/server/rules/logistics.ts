import type { RuleFn } from "@/contracts";
import { notImplementedCheck } from "./placeholder";

/**
 * Event-constraint rules (owner: JT, task JT-05): allowed parks, start window,
 * time zone, and the 20-or-more permit-review warning (non-critical).
 */
export const logisticsRules: RuleFn = (input) => [
  notImplementedCheck(input, "event_constraints.start_window", "event_constraints", "JT-05"),
  notImplementedCheck(input, "event_constraints.allowed_park", "event_constraints", "JT-05"),
];
