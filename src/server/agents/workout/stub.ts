import type { AgentImpl } from "@/contracts";
import { stubResult } from "../stub-result";

/** Fixture-backed Workout Adaptation Agent. Keep until the real agent passes its tests (YT-06). */
export const workoutStub: AgentImpl<"workout"> = {
  name: "workout",
  kind: "stub",
  run: async (_input, deps) =>
    stubResult("workout", deps, (s, v) => ("workoutOutput" in s ? s.workoutOutput(v) : undefined)),
};
