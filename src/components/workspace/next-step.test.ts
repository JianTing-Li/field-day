import { describe, expect, it } from "vitest";
import type { CheckResult, PlanVersion } from "@/contracts";
import { case02 } from "@fixtures/scenarios";
import { nextStep, problemSentence } from "./next-step";

const base = (): PlanVersion => ({
  version: 2,
  based_on_version: 1,
  created_at: "2026-10-28T18:00:00Z",
  source: "planning",
  status: "needs_verification",
  plan: case02.planningOutput(1).plan,
  evidence_snapshot_id: "snap",
  checks: null,
  facts: [],
  concerns: [],
  organizer_tasks: [],
  alternatives: null,
});

const check = (check_id: CheckResult["check_id"], status: CheckResult["status"]) =>
  ({ check_id, status, critical: true }) as CheckResult;
const withChecks = (v: PlanVersion, checks: CheckResult[]): PlanVersion => ({
  ...v,
  checks: { event_version: 2, evidence_snapshot_id: "snap", overall: "fail", blockers: [], checks },
});

describe("nextStep", () => {
  it("gives exactly one clear action for each simple status", () => {
    expect(nextStep({ ...base(), status: "draft", plan: null })).toMatchObject({ action: "generate", label: "Draft a plan" });
    expect(nextStep({ ...base(), status: "ready_for_approval" })).toMatchObject({
      action: "approve_and_lock",
      label: "Approve and lock in",
    });
    expect(nextStep({ ...base(), status: "approved" })).toMatchObject({ action: "finalize", label: "Lock it in" });
    expect(nextStep({ ...base(), status: "finalized" })).toMatchObject({ action: null, title: "Locked in" });
    expect(nextStep({ ...base(), status: "no_feasible_option" })).toMatchObject({ action: "edit" });
  });

  it("names failed checks in plain words and offers to find alternatives", () => {
    const v = withChecks(base(), [check("heat.max_temperature", "fail"), check("space_surface.space", "fail")]);
    expect(nextStep(v)).toMatchObject({
      tone: "danger",
      title: "It's too hot and the space doesn't work",
      action: "review",
      label: "Find alternatives",
    });
  });

  it("points to the alternatives once they exist", () => {
    const v = { ...withChecks(base(), [check("heat.max_temperature", "fail")]), alternatives: case02.reviewerOutput(1) };
    expect(nextStep(v)).toMatchObject({ action: "alternatives", label: "See alternatives" });
  });

  it("asks to confirm the first task about the current plan, never one for another park", () => {
    const plan = { ...base().plan!, park_id: "park-a", start_time: "2026-07-16T08:00" };
    const tasks = [
      { id: "t-b", description: "Confirm space at Park B", resolves_check_id: "space_surface.space" as const, park_id: "park-b", start_time: "2026-07-16T08:00" },
      { id: "t-a", description: "Confirm space at Park A", resolves_check_id: "space_surface.space" as const, park_id: "park-a", start_time: "2026-07-16T08:00" },
    ];
    const v = { ...withChecks({ ...base(), plan }, [check("space_surface.space", "unknown")]), organizer_tasks: tasks };
    expect(nextStep(v)).toMatchObject({ action: "confirm", taskId: "t-a", body: "Confirm space at Park A", title: "One thing left to confirm" });
  });

  it("skips a task whose check is already confirmed and moves on to the next one", () => {
    const plan = { ...base().plan!, park_id: "park-a", start_time: "2026-07-16T08:00" };
    const task = (id: string, check: "space_surface.space" | "space_surface.surface") => ({
      id,
      description: `Confirm ${check}`,
      resolves_check_id: check,
      park_id: "park-a",
      start_time: "2026-07-16T08:00",
    });
    const v = {
      ...withChecks({ ...base(), plan }, [check("space_surface.space", "pass"), check("space_surface.surface", "unknown")]),
      organizer_tasks: [task("t-space", "space_surface.space"), task("t-surface", "space_surface.surface")],
    };
    expect(nextStep(v)).toMatchObject({ taskId: "t-surface", title: "One thing left to confirm" });
  });

  it("suggests checking the weather again when only conditions are unknown", () => {
    const v = withChecks(base(), [check("heat.max_temperature", "unknown"), check("freshness.conditions", "unknown")]);
    expect(nextStep(v)).toMatchObject({ action: "recheck", title: "Waiting on weather data" });
  });

  it("stops offering Lock it in after the final checks failed, and says why", () => {
    const gate = [
      { id: "complete_inputs" as const, status: "pass" as const, reason: "Plan present" },
      { id: "hard_constraints" as const, status: "fail" as const, reason: "Critical checks failed or unknown: space_surface.surface" },
    ];
    const step = nextStep({ ...base(), status: "approved" }, gate);
    expect(step).toMatchObject({ title: "Can't lock it in yet", action: null });
    expect(step.body).toContain("ground surface");
    expect(step.body).not.toContain("space_surface");
    expect(nextStep({ ...base(), status: "approved" }, null).action).toBe("finalize");
  });

  it("never offers approve or lock-in while something is unresolved", () => {
    const v = withChecks(base(), [check("space_surface.surface", "unknown")]);
    expect(["approve", "finalize"]).not.toContain(nextStep(v).action);
  });
});

describe("failed draft", () => {
  const run = (status: "failed" | "budget_exhausted", message: string) => ({
    run_id: "r1",
    status,
    revision_count: 0,
    usage: { agent_executions: 1, model_requests: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0, elapsed_ms: 0 },
    progress: [{ at: "2026-10-29T19:00:00Z", message }],
  });

  it("says drafting failed instead of offering Draft a plan forever", () => {
    const step = nextStep({ ...base(), status: "draft", plan: null }, null, run("failed", "Could not draft a plan: boom"));
    expect(step).toMatchObject({ title: "Couldn't draft a plan", action: "generate", label: "Try again" });
  });

  it("explains the demo's practice planner in plain words", () => {
    const step = nextStep(
      { ...base(), status: "draft", plan: null },
      null,
      run("failed", "Could not draft a plan: No planning fixture for snapshot snap-x"),
    );
    expect(step.body).toContain("practice planner only has plans for the sample events");
    expect(step.body).not.toContain("snap-x");
  });

  it("ignores an old failure once there is a plan", () => {
    expect(nextStep({ ...base(), status: "ready_for_approval" }, null, run("failed", "x")).action).toBe("approve_and_lock");
  });
});

describe("problemSentence", () => {
  it("joins one, two or many problems naturally", () => {
    expect(problemSentence(["heat.max_temperature"])).toBe("it's too hot");
    expect(problemSentence(["heat.max_temperature", "air_quality.max_aqi"])).toBe("it's too hot and the air quality is too poor");
    expect(problemSentence(["heat.max_temperature", "air_quality.max_aqi", "duration.fits", "equipment.available"])).toBe(
      "it's too hot, the air quality is too poor and 2 more problems",
    );
  });
});

describe("next step from the harness's own checks (JT-24)", () => {
  const plan = { ...base().plan!, park_id: "park-a", start_time: "2026-07-16T08:00" };
  const item = (check_id: "space_surface.space" | "space_surface.surface", required = true) => ({
    check_id,
    park_id: "park-a",
    start_time: "2026-07-16T08:00",
    required,
    question: `Question for ${check_id}`,
    statement: "I checked",
  });

  it("asks for the first required check even when no agent wrote a to-do for it", () => {
    const v = withChecks({ ...base(), plan }, [check("space_surface.surface", "unknown")]);
    expect(nextStep(v, null, null, { confirm: [item("space_surface.surface")] })).toMatchObject({
      action: "confirm",
      checkId: "space_surface.surface",
      title: "One thing left to check",
    });
  });

  it("counts every required check", () => {
    const v = withChecks({ ...base(), plan }, [check("space_surface.space", "unknown"), check("space_surface.surface", "unknown")]);
    const step = nextStep(v, null, null, { confirm: [item("space_surface.space"), item("space_surface.surface")] });
    expect(step.title).toBe("2 things left to check");
  });

  it("says it's too early for a forecast when the event is far away", () => {
    const v = withChecks({ ...base(), plan: { ...plan, start_time: "2026-12-15T08:00" } }, [check("heat.max_temperature", "unknown")]);
    expect(nextStep(v, null, null, { confirm: [], today: "2026-10-29" }).body).toContain("too early for a forecast");
  });

  it("labels a demo lock-in as not for real use", () => {
    expect(nextStep({ ...base(), status: "finalized" }, null, null, { demoOnly: true }).body).toContain("aren't reviewed");
  });
});
