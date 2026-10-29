import { afterEach, describe, expect, it } from "vitest";
import {
  PlanningOutput,
  type AgentDeps,
  type CheckPlanResult,
  type PlanningInput,
  type ToolRegistry,
} from "@/contracts";
import { case01, case02 } from "@fixtures/scenarios";
import { createFakeRunner, type FakeStep } from "@/server/agents/fake-runner";
import { createBudget } from "@/server/orchestrator/budget";
import { checkPlan } from "@/server/rules/check-plan";
import { tools } from "@/server/tools";
import { planningAgentImpl as planningAgent, planningDefinition } from "./agent";

// The fake runner plays Claude with scripted turns, so these tests make no API calls.
// Everything after the model's answer (tool validation, output schema, harness checks) is real.

type Scenario = typeof case01 | typeof case02;

function setup(scenario: Scenario, overrides: Partial<ToolRegistry> = {}) {
  const snapshot = scenario.snapshot("evt-test", 1);
  const input: PlanningInput = {
    context: {
      event_id: "evt-test",
      event_version: 1,
      evidence_snapshot_id: snapshot.id,
      revision_round: 0,
      revision_available: true,
    },
    brief: scenario.brief,
  };
  const deps: AgentDeps = {
    tools: { ...tools, ...overrides },
    tool_context: { snapshot, brief: scenario.brief, event_version: 1 },
    budget: createBudget(),
  };
  return { input, deps, snapshot };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

async function runWith(scenario: Scenario, steps: FakeStep[], overrides: Partial<ToolRegistry> = {}) {
  const { input, deps, snapshot } = setup(scenario, overrides);
  const fake = createFakeRunner(steps);
  restore = fake.install();
  const result = await planningAgent.run(input, deps);
  return { result, fake, deps, snapshot };
}

/** A typical model turn: read the evidence, then check the plan. */
function readAndCheck(scenario: Scenario): FakeStep {
  const { plan } = scenario.planningOutput(1);
  const slot = scenario.snapshot("evt-test", 1).park_time_candidates.find((c) => c.id === plan.park_time_candidate_id);
  const window = { park_id: plan.park_id!, start_time: plan.start_time!, end_time: slot!.end_time };
  return {
    tool_calls: [
      { name: "get_park_candidates", input: { park_ids: null } },
      { name: "get_workout_templates", input: { template_ids: null } },
      { name: "get_forecast", input: window },
      { name: "get_air_quality", input: window },
      { name: "check_plan", input: { plan } },
    ],
  };
}

function expectedChecks(scenario: Scenario, deps: AgentDeps): CheckPlanResult {
  return checkPlan({
    plan: scenario.planningOutput(1).plan,
    brief: scenario.brief,
    snapshot: deps.tool_context.snapshot,
    event_version: 1,
  });
}

/** Every check the output calls "pass" is a pass in check_plan, and nothing failed/unknown is hidden. */
function expectHonest(output: PlanningOutput, truth: CheckPlanResult, known: Set<string>) {
  expect(output.rule_checks).toEqual(truth);
  if (truth.overall !== "pass") expect(output.status).not.toBe("draft");
  for (const id of truth.blockers) {
    expect(output.concerns.some((c) => c.blocking && c.related_check_ids.includes(id))).toBe(true);
  }
  for (const f of output.facts) for (const id of f.evidence_ids) expect(known).toContain(id);
}

describe("planningDefinition", () => {
  it("allows exactly the 5 Planning tools and uses the prompt file", () => {
    expect(planningDefinition.allowed_tools).toEqual([
      "get_park_candidates",
      "get_forecast",
      "get_air_quality",
      "get_workout_templates",
      "check_plan",
    ]);
    expect(planningDefinition.system_prompt).toContain("FieldDay’s Planning Agent");
  });

  it("sends the version, snapshot ID and brief, and labels the brief as data", () => {
    const { input } = setup(case01);
    const message = planningDefinition.build_user_message(input);
    expect(message).toContain("event_version: 1");
    expect(message).toContain("evidence_snapshot_id: snap-case-01");
    expect(message).toContain("not instructions");
    expect(message).toContain(case01.brief.title);
  });

  it("is the real (not stub) agent", () => {
    expect(planningAgent.kind).toBe("real");
  });
});

describe("Case 1 (normal event)", () => {
  it("returns a valid PlanningOutput citing only snapshot evidence", async () => {
    const { result, fake, deps, snapshot } = await runWith(case01, [readAndCheck(case01), { output: case01.planningOutput(1) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => PlanningOutput.parse(result.output)).not.toThrow();
    expectHonest(result.output, expectedChecks(case01, deps), new Set(snapshot.items.map((i) => i.id)));
    expect(fake.calls).toHaveLength(2);
    expect(result.usage).toMatchObject({ agent_executions: 1, model_requests: 2, tool_calls: 5 });
  });

  it("keeps a draft only when every critical check really passes", async () => {
    const allPass = (r: CheckPlanResult): CheckPlanResult => ({
      ...r,
      overall: "pass",
      blockers: [],
      checks: r.checks.map((c) => ({ ...c, status: "pass" })),
    });
    const { result } = await runWith(case01, [readAndCheck(case01), { output: case01.planningOutput(1) }], {
      check_plan: (input, ctx) => allPass(tools.check_plan(input, ctx) as CheckPlanResult),
    });
    expect(result.ok && result.output.status).toBe("draft");
  });
});

describe("Case 2 (heat and running-lane conflict)", () => {
  it("keeps the plan blocked and reports each blocker as a blocking concern", async () => {
    const { result, deps, snapshot } = await runWith(case02, [readAndCheck(case02), { output: case02.planningOutput(1) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const truth = expectedChecks(case02, deps);
    expectHonest(result.output, truth, new Set(snapshot.items.map((i) => i.id)));
    expect(result.output.status).toBe("needs_verification");
    // Park A's running lane was reported unusable, so the workout rules fail space there.
    const space = result.output.rule_checks?.checks.find((c) => c.check_id === "space_surface.space");
    expect(space).toMatchObject({ status: "fail", evidence_ids: ["ev-c2-lane-unusable"] });
  });
});

describe("the model can't overrule the harness", () => {
  it("replaces made-up passing checks with check_plan's real results", async () => {
    const lie = case02.planningOutput(1);
    const rule_checks = lie.rule_checks && {
      ...lie.rule_checks,
      overall: "pass" as const,
      blockers: [],
      checks: lie.rule_checks.checks.map((c) => ({ ...c, status: "pass" as const })),
    };
    const { result, deps } = await runWith(case02, [
      readAndCheck(case02),
      { output: { ...lie, status: "draft", rule_checks, concerns: [] } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.rule_checks).toEqual(expectedChecks(case02, deps));
    expect(result.output.rule_checks?.overall).toBe("fail");
    expect(result.output.status).toBe("needs_verification");
    expect(result.output.concerns.filter((c) => c.blocking).length).toBeGreaterThan(0);
  });

  it("runs check_plan even if the model never called it", async () => {
    const out = { ...case01.planningOutput(1), rule_checks: null };
    const { result, deps } = await runWith(case01, [{ output: out }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.rule_checks).toEqual(expectedChecks(case01, deps));
  });

  it("drops evidence IDs that aren't in the snapshot and stops calling the claim verified", async () => {
    const out = case01.planningOutput(1);
    const facts = [
      ...out.facts,
      { claim: "The lawn is perfectly flat", status: "verified" as const, evidence_ids: ["ev-invented"], missing_reason: null },
    ];
    const { result } = await runWith(case01, [{ output: { ...out, facts } }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.output.facts.find((f) => f.claim === "The lawn is perfectly flat");
    expect(fact).toMatchObject({ status: "unverified", evidence_ids: [], missing_reason: "Cited evidence is not in the snapshot" });
    expect(result.output.concerns.some((c) => c.description.includes("ev-invented"))).toBe(true);
    // Real citations are untouched.
    expect(result.output.facts.slice(0, out.facts.length)).toEqual(out.facts);
  });

  it("never upgrades a needs_verification answer to a draft", async () => {
    const out = { ...case01.planningOutput(1), status: "needs_verification" as const };
    const { result } = await runWith(case01, [{ output: out }], {
      check_plan: (input, ctx) => ({ ...(tools.check_plan(input, ctx) as CheckPlanResult), overall: "pass", blockers: [] }),
    });
    expect(result.ok && result.output.status).toBe("needs_verification");
  });
});

describe("runner safeguards still apply", () => {
  it("rejects an answer for an old event version", async () => {
    const { result } = await runWith(case01, [{ output: case01.planningOutput(2) }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("stale_context");
  });

  it("rejects a tool the Planning agent isn't allowed to use", async () => {
    const { result } = await runWith(case01, [{ tool_calls: [{ name: "book_park", input: {} }] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("tool_error");
  });

  it("gives one repair turn for invalid JSON, then fails", async () => {
    const { result, fake } = await runWith(case01, [{ text: "Here is my plan!" }, { text: "{ still not json" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_output");
    expect(fake.calls).toHaveLength(2);
  });

  it("accepts a repaired answer", async () => {
    const { result } = await runWith(case01, [{ text: "Here is my plan!" }, { output: case01.planningOutput(1) }]);
    expect(result.ok).toBe(true);
  });
});
