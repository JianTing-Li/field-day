import { describe, expect, it } from "vitest";
import { WorkoutOutput } from "@/contracts";
import { scenarioForSnapshot } from "@fixtures/scenarios";
import { grade, type AgentEvalCase } from "../planning/rubric";
import { testCheckPlan } from "../planning/test-check-plan";
import { workoutEvalCases } from "./index";

function setup(c: AgentEvalCase<"workout">) {
  const { snapshot, brief } = c.build(1);
  const ctx = { snapshot, brief, event_version: 1, checkPlan: testCheckPlan(snapshot, brief, 1) };
  const scenario = scenarioForSnapshot(snapshot.id)!;
  const ideal = ("workoutOutput" in scenario ? scenario.workoutOutput(1) : null) as WorkoutOutput;
  return { ctx, ideal };
}
const byId = (id: string) => workoutEvalCases.find((c) => c.id === id)!;
const failed = (r: ReturnType<typeof grade>) => r.results.filter((x) => !x.passed).map((x) => x.id);
/** Critical failures only; advisory criteria are reported but never fail a case. */
const criticalFailed = (r: ReturnType<typeof grade>) => r.results.filter((x) => !x.passed && x.critical).map((x) => x.id);

describe("workout eval cases", () => {
  it.each(workoutEvalCases.map((c) => [c.id, c] as const))("%s passes the scenario's ideal output", (_id, c) => {
    const { ctx, ideal } = setup(c);
    const r = grade(c, ideal, ctx, WorkoutOutput);
    expect(criticalFailed(r)).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("covers 5 scenarios with unique IDs", () => {
    expect(new Set(workoutEvalCases.map((c) => c.id)).size).toBe(5);
    expect(workoutEvalCases.map((c) => c.scenario)).toEqual([2, 4, 6, 7, 9]);
  });

  it("gives the agent every park/time candidate and the planned version as the current plan", () => {
    const { input, snapshot } = byId("workout-02-conflict").build(1);
    expect(input.park_time_candidate_ids).toEqual(snapshot.park_time_candidates.map((c) => c.id));
    expect(input.conflict.check_ids.length).toBeGreaterThan(0);
  });
});

describe("workout graders catch bad outputs", () => {
  it("keeping the kettlebell class", () => {
    const c = byId("workout-06-equipment");
    const { ctx, ideal } = setup(c);
    const kettle = { ...ideal.options[0], plan: { ...ideal.options[0].plan, workout_template_id: "tpl-fx-kettlebell-45" } };
    const r = grade(c, { ...ideal, options: [kettle] }, ctx, WorkoutOutput);
    expect(failed(r)).toEqual(expect.arrayContaining(["substitutes-bodyweight", "equipment-passes"]));
  });

  it("calling a gentler workout a fix for the heat advisory", () => {
    const c = byId("workout-09-no-feasible");
    const { ctx, ideal } = setup(c);
    expect(failed(grade(c, { ...ideal, status: "options_proposed" }, ctx, WorkoutOutput))).toContain("not-proposed-as-fix");
  });

  it("an option that only moves the park", () => {
    const c = byId("workout-02-conflict");
    const { ctx, ideal } = setup(c);
    const o = ideal.options[0];
    const move = { ...o, option_id: "wo-move", plan: { ...o.plan, adaptation_ids: [] }, changes: [{ field: "park" as const, from: "park-a", to: "park-b" }] };
    expect(failed(grade(c, { ...ideal, options: [...ideal.options, move] }, ctx, WorkoutOutput))).toContain("changes-workout");
  });

  it("an option for a candidate that doesn't exist", () => {
    const c = byId("workout-02-conflict");
    const { ctx, ideal } = setup(c);
    const o = { ...ideal.options[0], park_time_candidate_ids: ["cand-z-0600"] };
    expect(failed(grade(c, { ...ideal, options: [o] }, ctx, WorkoutOutput))).toContain("real-candidates");
  });

  it("more than 3 options fails the contract", () => {
    const c = byId("workout-02-conflict");
    const { ctx, ideal } = setup(c);
    const four = [1, 2, 3, 4].map((n) => ({ ...ideal.options[0], option_id: `wo-${n}` }));
    expect(grade(c, { ...ideal, options: four }, ctx, WorkoutOutput).passed).toBe(false);
  });

  it("no stationary option for the broken running lane", () => {
    const c = byId("workout-02-conflict");
    const { ctx, ideal } = setup(c);
    expect(failed(grade(c, { ...ideal, status: "no_feasible_option", options: [] }, ctx, WorkoutOutput))).toContain("proposes-stationary");
  });
});
