import type { RuleFn } from "@/contracts";
import { notImplementedCheck } from "@/server/rules/placeholder";

/**
 * Freshness and coverage (owner: JT, task JT-03): evidence age limits per source and
 * whether evidence covers the full event interval.
 */
export const freshnessRules: RuleFn = (input) => [
  notImplementedCheck(input, "freshness.conditions", "freshness", "JT-03"),
];
