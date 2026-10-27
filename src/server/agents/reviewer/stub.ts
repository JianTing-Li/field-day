import type { AgentImpl } from "@/contracts";
import { stubResult } from "../stub-result";

/** Fixture-backed Independent Event Reviewer. Keep until the real agent passes its tests (JT-13). */
export const reviewerStub: AgentImpl<"reviewer"> = {
  name: "reviewer",
  kind: "stub",
  run: async (_input, deps) =>
    stubResult("reviewer", deps, (s, v) => ("reviewerOutput" in s ? s.reviewerOutput(v) : undefined)),
};
