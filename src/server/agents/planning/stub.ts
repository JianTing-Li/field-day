import { ZERO_USAGE, type AgentImpl } from "@/contracts";
import { scenarioForSnapshot } from "@fixtures/scenarios";
import { stubResult } from "../stub-result";
import { rulesPlan } from "./rules-plan";

/**
 * Practice Planning Agent (no AI). Sample events get their scenario's fixture output; any other
 * event (one an organizer creates) gets the rules-only plan, so creating an event always works in
 * demo mode. The real agent (./agent.ts) replaces this when FIELDDAY_AGENTS=real.
 */
export const planningStub: AgentImpl<"planning"> = {
  name: "planning",
  kind: "stub",
  run: async (input, deps) =>
    scenarioForSnapshot(deps.tool_context.snapshot.id)
      ? stubResult("planning", deps, (s, v) => s.planningOutput(v))
      : { ok: true, output: await rulesPlan(input, deps), usage: ZERO_USAGE },
};
