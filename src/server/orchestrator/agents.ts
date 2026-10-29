import type { AgentImpl, AgentName } from "@/contracts";
import { logisticsAgent } from "@/server/agents/logistics";
import { logisticsAgentImpl } from "@/server/agents/logistics/agent";
import { planningAgent } from "@/server/agents/planning";
import { planningAgentImpl } from "@/server/agents/planning/agent";
import { reviewerAgent } from "@/server/agents/reviewer";
import { reviewerAgentImpl } from "@/server/agents/reviewer/agent";
import { workoutAgent } from "@/server/agents/workout";
import { workoutAgentImpl } from "@/server/agents/workout/agent";

/**
 * Which agent implementations a run uses (owner: JT, task JT-10, D-JT10-1).
 * FIELDDAY_AGENTS=real runs every real agent that exists and the stub for any that doesn't;
 * anything else (the default) runs the fixture-backed stubs. Each agent folder's index.ts keeps
 * exporting its stub, so fixture mode and the lifecycle tests are unchanged.
 */

export type AgentMode = "stub" | "real";

export interface AgentSet {
  planning: AgentImpl<"planning">;
  logistics: AgentImpl<"logistics">;
  workout: AgentImpl<"workout">;
  reviewer: AgentImpl<"reviewer">;
}

export const STUB_AGENTS: AgentSet = {
  planning: planningAgent,
  logistics: logisticsAgent,
  workout: workoutAgent,
  reviewer: reviewerAgent,
};

/** Every agent's real implementation. Partial so a future agent can start as a stub only. */
export const REAL_AGENTS: Partial<AgentSet> = {
  planning: planningAgentImpl,
  logistics: logisticsAgentImpl,
  workout: workoutAgentImpl,
  reviewer: reviewerAgentImpl,
};

/** Reads FIELDDAY_AGENTS (default: stub). */
export function agentMode(): AgentMode {
  return process.env.FIELDDAY_AGENTS === "real" ? "real" : "stub";
}

export function selectAgents(mode: AgentMode = agentMode()): AgentSet {
  return mode === "real" ? { ...STUB_AGENTS, ...REAL_AGENTS } : STUB_AGENTS;
}

/** Which implementation each agent in a set is, so a run never reports a stub as a real agent. */
export function agentKinds(set: AgentSet): Record<AgentName, "stub" | "real"> {
  return {
    planning: set.planning.kind,
    logistics: set.logistics.kind,
    workout: set.workout.kind,
    reviewer: set.reviewer.kind,
  };
}
