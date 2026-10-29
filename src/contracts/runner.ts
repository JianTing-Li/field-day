import { z } from "zod";
import type { AgentIO, AgentName } from "./agents";
import type { ToolContext, ToolName, ToolRegistry } from "./tools";

/**
 * Agent runner contract. The real runner (src/server/agents/runner.ts) calls Claude,
 * runs the tool loop, validates output and counts usage. Agents are written against
 * these types so they work before the runner is implemented.
 */

export const Usage = z.object({
  agent_executions: z.number().int().min(0),
  model_requests: z.number().int().min(0),
  tool_calls: z.number().int().min(0),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  elapsed_ms: z.number().min(0),
});
export type Usage = z.infer<typeof Usage>;

/** Per-run caps. PRD fixes agent_executions at 7; the rest are set in docs/decisions.md. */
export const BudgetLimits = Usage;
export type BudgetLimits = z.infer<typeof BudgetLimits>;

export const ZERO_USAGE: Usage = {
  agent_executions: 0,
  model_requests: 0,
  tool_calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  elapsed_ms: 0,
};

/** Static description of one agent. Lives in src/server/agents/<name>/agent.ts. */
export interface AgentDefinition<N extends AgentName> {
  name: N;
  /** Contents of prompt.md. */
  system_prompt: string;
  allowed_tools: ToolName[];
  /** Validates the final JSON. Must be the matching schema from contracts/agents.ts. */
  output_schema: z.ZodType<AgentIO[N]["output"]>;
  /** Turns the structured input into the user message sent to Claude. */
  build_user_message: (input: AgentIO[N]["input"]) => string;
}

export const AgentErrorKind = z.enum([
  "budget_exhausted",
  "invalid_output",
  "stale_context",
  "model_error",
  "tool_error",
  "not_implemented",
]);
export type AgentErrorKind = z.infer<typeof AgentErrorKind>;

export type AgentResult<N extends AgentName> =
  | { ok: true; output: AgentIO[N]["output"]; usage: Usage }
  | { ok: false; error: { kind: AgentErrorKind; message: string }; usage: Usage };

/** Shared budget tracker passed through a whole orchestrator run. */
export interface BudgetTracker {
  limits: BudgetLimits;
  used: () => Usage;
  /** Returns false (and records nothing) if recording would exceed a limit. */
  record: (delta: Partial<Usage>) => boolean;
}

export interface AgentDeps {
  tools: ToolRegistry;
  tool_context: ToolContext;
  budget: BudgetTracker;
}

export type RunAgent = <N extends AgentName>(
  definition: AgentDefinition<N>,
  input: AgentIO[N]["input"],
  deps: AgentDeps,
) => Promise<AgentResult<N>>;

/**
 * What each agent folder's index.ts exports. The orchestrator only calls `run`.
 * Swap a stub for the real agent by changing the folder's index.ts.
 */
export interface AgentImpl<N extends AgentName> {
  name: N;
  kind: "stub" | "real";
  run: (input: AgentIO[N]["input"], deps: AgentDeps) => Promise<AgentResult<N>>;
}
