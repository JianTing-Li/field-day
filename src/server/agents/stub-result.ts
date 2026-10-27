import { scenarioForSnapshot } from "@fixtures/scenarios";
import { ZERO_USAGE, type AgentDeps, type AgentIO, type AgentName, type AgentResult } from "@/contracts";

type Scenario = NonNullable<ReturnType<typeof scenarioForSnapshot>>;

/**
 * Shared helper for agent stubs: returns the fixture output for the snapshot the
 * harness bound to this run, or a not_implemented error if no fixture covers it.
 */
export function stubResult<N extends AgentName>(
  name: N,
  deps: AgentDeps,
  pick: (s: Scenario, version: number) => unknown,
): AgentResult<N> {
  const scenario = scenarioForSnapshot(deps.tool_context.snapshot.id);
  const output = scenario ? pick(scenario, deps.tool_context.event_version) : undefined;
  if (!output) {
    return {
      ok: false,
      error: {
        kind: "not_implemented",
        message: `No ${name} fixture for snapshot ${deps.tool_context.snapshot.id}`,
      },
      usage: ZERO_USAGE,
    };
  }
  return { ok: true, output: output as AgentIO[N]["output"], usage: ZERO_USAGE };
}
