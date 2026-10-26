import type { RuleFn } from "@/contracts";
import { notImplementedCheck } from "./placeholder";

/**
 * Heat and air-quality policies (owner: JT, task JT-04).
 * Thresholds come from policy-config.ts. Missing or stale evidence is unknown, never pass.
 * Lowering workout intensity never turns a blocked condition into a pass.
 */
export const environmentRules: RuleFn = (input) => [
  notImplementedCheck(input, "heat.max_temperature", "heat", "JT-04"),
  notImplementedCheck(input, "air_quality.max_aqi", "air_quality", "JT-04"),
];
