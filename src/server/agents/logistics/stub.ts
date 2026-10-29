import type { AgentImpl } from "@/contracts";
import { stubResult } from "../stub-result";

/** Fixture-backed Event Logistics Agent. Keep until the real agent passes its tests (JT-12). */
export const logisticsStub: AgentImpl<"logistics"> = {
  name: "logistics",
  kind: "stub",
  run: async (_input, deps) =>
    stubResult("logistics", deps, (s, v) => ("logisticsOutput" in s ? s.logisticsOutput(v) : undefined)),
};
