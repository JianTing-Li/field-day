import { ZERO_USAGE, type BudgetLimits, type BudgetTracker, type Usage } from "@/contracts";

/**
 * Per-run limits (owner: JT, task JT-10). PRD fixes 7 agent executions; the other
 * values are placeholders until recorded in docs/decisions.md.
 */
export const DEFAULT_LIMITS: BudgetLimits = {
  agent_executions: 7,
  model_requests: 40,
  tool_calls: 80,
  input_tokens: 400_000,
  output_tokens: 60_000,
  elapsed_ms: 240_000,
};

export function createBudget(limits: BudgetLimits = DEFAULT_LIMITS): BudgetTracker {
  const used: Usage = { ...ZERO_USAGE };
  return {
    limits,
    used: () => ({ ...used }),
    record: (delta) => {
      const keys = Object.keys(delta) as (keyof Usage)[];
      if (keys.some((k) => used[k] + (delta[k] ?? 0) > limits[k])) return false;
      for (const k of keys) used[k] += delta[k] ?? 0;
      return true;
    },
  };
}
