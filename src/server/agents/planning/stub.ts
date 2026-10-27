import type { AgentImpl } from "@/contracts";
import { stubResult } from "../stub-result";

/** Fixture-backed Planning Agent. Keep until the real agent passes its tests (YT-05). */
export const planningStub: AgentImpl<"planning"> = {
  name: "planning",
  kind: "stub",
  run: async (_input, deps) => stubResult("planning", deps, (s, v) => s.planningOutput(v)),
};
