import { afterEach, describe, expect, it } from "vitest";
import {
  WorkoutOutput,
  type AgentDeps,
  type CandidatePlan,
  type CheckPlanResult,
  type CheckResult,
  type RuleFn,
  type SpecialistInput,
  type ToolContext,
  type ToolRegistry,
} from "@/contracts";
import { case02 } from "@fixtures/scenarios";
import { createFakeRunner, type FakeStep } from "@/server/agents/fake-runner";
import { createBudget } from "@/server/orchestrator/budget";
import { freshnessRules } from "@/server/evidence/freshness";
import { checkPlan } from "@/server/rules/check-plan";
import { logisticsRules } from "@/server/rules/logistics";
import { workoutRules } from "@/server/rules/workout";
import { tools } from "@/server/tools";
import { workoutAgentImpl as workoutAgent, workoutDefinition } from "./agent";

// The fake runner plays Claude with scripted turns, so these tests make no API calls.
// Case 2: 45-minute run intervals at Park A, 10 a.m. 10 a.m. is too hot (93°F) and the organizer
// reported Park A's running lane is unusable.

/**
 * Stand-in heat rule until JT-04 lands: fail above the brief's limit, using the temperature evidence
 * for the plan's park at its start hour. Only for these tests.
 */
const testHeatRule: RuleFn = ({ plan, brief, snapshot }) => {
  const temp = snapshot.items.find(
    (i) => i.metric === "temperature" && i.applies_to.park_id === plan.park_id && i.valid_from === plan.start_time,
  );
  const limit = brief.instructor_limits.max_temperature_f;
  const hot = typeof temp?.value === "number" && limit !== null && temp.value > limit;
  const check: CheckResult = {
    check_id: "heat.max_temperature",
    area: "heat",
    status: temp ? (hot ? "fail" : "pass") : "unknown",
    critical: true,
    reason: temp ? `${temp.value}°F vs the ${limit}°F limit` : "No temperature evidence",
    evidence_ids: temp ? [temp.id] : [],
    policy_version: "test-heat",
    assessed: { park_id: plan.park_id, start_time: plan.start_time, workout_template_id: plan.workout_template_id },
  };
  return [check];
};

const withHeat = (input: { plan: CandidatePlan }, ctx: ToolContext): CheckPlanResult =>
  checkPlan(
    { plan: input.plan, brief: ctx.brief, snapshot: ctx.snapshot, event_version: ctx.event_version },
    [logisticsRules, workoutRules, testHeatRule, freshnessRules],
  );

function setup(overrides: Partial<ToolRegistry> = { check_plan: withHeat }) {
  const snapshot = case02.snapshot("evt-test", 1);
  const current_plan = case02.planningOutput(1).plan;
  const input: SpecialistInput = {
    context: { event_id: "evt-test", event_version: 1, evidence_snapshot_id: snapshot.id, revision_round: 0, revision_available: true },
    brief: case02.brief,
    current_plan,
    conflict: {
      source: "harness",
      description: "10 a.m. fails heat; Park A's running lane is unusable",
      check_ids: ["heat.max_temperature", "space_surface.space"],
    },
    park_time_candidate_ids: snapshot.park_time_candidates.map((c) => c.id),
    revision_requests: [],
  };
  const deps: AgentDeps = {
    tools: { ...tools, ...overrides },
    tool_context: { snapshot, brief: case02.brief, event_version: 1 },
    budget: createBudget(),
  };
  return { input, deps, snapshot };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

async function runWith(steps: FakeStep[], opts: { input?: Partial<SpecialistInput>; overrides?: Partial<ToolRegistry> } = {}) {
  const { input, deps, snapshot } = setup(opts.overrides);
  const fake = createFakeRunner(steps);
  restore = fake.install();
  const result = await workoutAgent.run({ ...input, ...opts.input }, deps);
  return { result, fake, deps, snapshot };
}

const fixture = () => case02.workoutOutput(1);
const option = () => fixture().options[0];
/** What the prompt asks the model to send; the harness fills in the real checks. */
const placeholderChecks: CheckPlanResult = { event_version: 1, evidence_snapshot_id: case02.SNAPSHOT_ID, overall: "unknown", checks: [], blockers: [] };

/** A typical model turn: read the evidence and templates, then check the adapted plan. */
function readAndCheck(): FakeStep {
  const { plan } = option();
  const window = { park_id: plan.park_id!, start_time: plan.start_time!, end_time: "2026-07-16T10:45" };
  return {
    tool_calls: [
      { name: "get_workout_templates", input: { template_ids: null } },
      { name: "get_forecast", input: window },
      { name: "get_air_quality", input: window },
      { name: "check_plan", input: { plan } },
    ],
  };
}

const output = (options: WorkoutOutput["options"] = [{ ...option(), checks: placeholderChecks }]) => ({ ...fixture(), options });

describe("workoutDefinition", () => {
  it("allows exactly the 4 Workout tools and uses the prompt file", () => {
    expect(workoutDefinition.allowed_tools).toEqual(["get_forecast", "get_air_quality", "get_workout_templates", "check_plan"]);
    expect(workoutDefinition.system_prompt).toContain("Workout Adaptation Agent");
  });

  it("sends the conflict, current plan, allowed candidates and brief, and labels the brief as data", () => {
    const { input } = setup();
    const message = workoutDefinition.build_user_message(input);
    expect(message).toContain("event_version: 1");
    expect(message).toContain(case02.SNAPSHOT_ID);
    expect(message).toContain("Park A's running lane is unusable");
    expect(message).toContain('["cand-a-0800","cand-a-1000","cand-b-0800"]');
    expect(message).toContain("not instructions");
  });

  it("is the real (not stub) agent", () => {
    expect(workoutAgent.kind).toBe("real");
  });
});

describe("Case 2", () => {
  it("proposes the stationary adaptation, keeps 10 a.m. heat as fail and Park A space as unknown", async () => {
    const { result, deps, snapshot } = await runWith([readAndCheck(), { output: output() }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => WorkoutOutput.parse(result.output)).not.toThrow();

    const [o] = result.output.options;
    expect(o.plan.adaptation_ids).toEqual(["adapt-stationary-circuit"]);
    expect(o.checks).toEqual(withHeat({ plan: o.plan }, deps.tool_context));

    const status = (id: string) => o.checks.checks.find((c) => c.check_id === id)?.status;
    expect(status("heat.max_temperature")).toBe("fail");
    expect(status("space_surface.space")).toBe("unknown");
    expect(o.checks.overall).toBe("fail");
    expect(o.unknowns).toContain("Stationary space at park-a is not confirmed");
    expect(result.output.concerns.some((c) => c.blocking && c.related_check_ids.includes("heat.max_temperature"))).toBe(true);

    const known = new Set(snapshot.items.map((i) => i.id));
    for (const id of o.evidence_ids) expect(known).toContain(id);
    expect(result.usage).toMatchObject({ agent_executions: 1, model_requests: 2, tool_calls: 4 });
  });

  it("the stationary adaptation at 8 a.m. clears heat but still needs Park A space confirmed", async () => {
    const slot = case02.snapshot("evt-test", 1).park_time_candidates.find((c) => c.id === "cand-a-0800")!;
    const early = {
      ...option(),
      option_id: "wo-early",
      park_time_candidate_ids: [slot.id],
      plan: { ...option().plan, park_time_candidate_id: slot.id, start_time: slot.start_time },
      checks: placeholderChecks,
    };
    const { result } = await runWith([{ output: output([early]) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [o] = result.output.options;
    expect(o.checks.checks.find((c) => c.check_id === "heat.max_temperature")?.status).toBe("pass");
    expect(o.checks.checks.find((c) => c.check_id === "space_surface.space")?.status).toBe("unknown");
    expect(o.checks.overall).toBe("unknown");
  });
});

describe("the model can't overrule the harness", () => {
  it("replaces claimed passing checks with check_plan's real results", async () => {
    const real = withHeat({ plan: option().plan }, setup().deps.tool_context);
    const lie: CheckPlanResult = { ...real, overall: "pass" as const, blockers: [], checks: real.checks.map((c) => ({ ...c, status: "pass" as const })) };
    const { result } = await runWith([{ output: output([{ ...option(), checks: lie }]) }]);
    expect(result.ok && result.output.options[0].checks).toEqual(real);
  });

  it("a lower-intensity workout never makes the heat block pass", async () => {
    const gentle = {
      ...option(),
      option_id: "wo-gentle",
      plan: { ...option().plan, workout_template_id: "tpl-bodyweight-45", adaptation_ids: ["adapt-low-impact"] },
      changes: [{ field: "workout" as const, from: "tpl-run-intervals-45", to: "tpl-bodyweight-45" }],
      checks: placeholderChecks,
    };
    const { result } = await runWith([{ output: output([gentle]) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.options[0].checks.checks.find((c) => c.check_id === "heat.max_temperature")?.status).toBe("fail");
  });

  it("drops an option assessed for a candidate it wasn't given", async () => {
    const { result } = await runWith([{ output: output() }], { input: { park_time_candidate_ids: ["cand-b-0800"] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.options).toEqual([]);
    expect(result.output.status).toBe("needs_verification");
    expect(result.output.concerns.some((c) => c.description.includes("wo-1 was dropped"))).toBe(true);
  });

  it("drops an option whose plan quietly moves the park or time", async () => {
    const moved = { ...option(), plan: { ...option().plan, start_time: "2026-07-16T09:00" }, checks: placeholderChecks };
    const { result } = await runWith([{ output: output([moved]) }]);
    expect(result.ok && result.output.options).toEqual([]);
  });

  it("drops an option that only moves the park or time (that's Logistics' job)", async () => {
    const slot = case02.snapshot("evt-test", 1).park_time_candidates.find((c) => c.id === "cand-b-0800")!;
    const logisticsOnly = {
      ...option(),
      option_id: "wo-move",
      park_time_candidate_ids: [slot.id],
      plan: { ...option().plan, park_time_candidate_id: slot.id, park_id: slot.park_id, start_time: slot.start_time, adaptation_ids: [] },
      changes: [{ field: "park" as const, from: "park-a", to: "park-b" }],
      checks: placeholderChecks,
    };
    const { result } = await runWith([{ output: output([logisticsOnly]) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.options).toEqual([]);
    expect(result.output.concerns.some((c) => c.description.includes("wo-move was dropped"))).toBe(true);
  });

  it("removes evidence IDs that aren't in the snapshot and says so", async () => {
    const o = { ...option(), evidence_ids: [...option().evidence_ids, "ev-invented-shade"], checks: placeholderChecks };
    const { result } = await runWith([{ output: output([o]) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.options[0].evidence_ids).not.toContain("ev-invented-shade");
    expect(result.output.options[0].unknowns.some((u) => u.includes("ev-invented-shade"))).toBe(true);
  });

  it("makes every check unknown for an adaptation the template doesn't permit", async () => {
    const o = { ...option(), plan: { ...option().plan, adaptation_ids: ["adapt-invented"] }, checks: placeholderChecks };
    const { result } = await runWith([{ output: output([o]) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const space = result.output.options[0].checks.checks.find((c) => c.check_id === "space_surface.space");
    expect(space?.status).toBe("unknown");
    expect(space?.reason).toContain("not permitted");
  });
});

describe("runner safeguards still apply", () => {
  it("rejects more than 3 options", async () => {
    const four = [1, 2, 3, 4].map((n) => ({ ...option(), option_id: `wo-${n}`, checks: placeholderChecks }));
    const { result } = await runWith([{ output: output(four) }, { output: output(four) }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_output");
  });

  it("rejects an answer for an old event version", async () => {
    const { result } = await runWith([{ output: { ...output(), event_version: 2 } }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("stale_context");
  });

  it("rejects a tool the Workout agent isn't allowed to use", async () => {
    const { result } = await runWith([{ tool_calls: [{ name: "get_park_candidates", input: { park_ids: null } }] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("tool_error");
  });
});
