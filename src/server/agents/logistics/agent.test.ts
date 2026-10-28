import { afterEach, describe, expect, it } from "vitest";
import {
  LogisticsOutput,
  type AgentDeps,
  type CheckPlanResult,
  type SpecialistInput,
  type ToolRegistry,
} from "@/contracts";
import { case02, evalCases } from "@fixtures/scenarios";
import { createFakeRunner, type FakeStep } from "@/server/agents/fake-runner";
import { createBudget } from "@/server/orchestrator/budget";
import { tools } from "@/server/tools";
import { enforceLogisticsResults, logisticsAgentImpl as logisticsAgent, logisticsDefinition } from "./agent";

// The fake runner plays Claude with scripted turns, so these tests make no API calls.
// Case 2: 45-minute run intervals at Park A, 10 a.m. 10 a.m. is too hot and the organizer reported
// Park A's running lane is unusable. Expected checks always come from the real check_plan tool,
// so these tests hold whichever rule modules are in place.

function setup(scenario: (typeof evalCases)[number] = case02) {
  const snapshot = scenario.snapshot("evt-test", 1);
  const input: SpecialistInput = {
    context: { event_id: "evt-test", event_version: 1, evidence_snapshot_id: snapshot.id, revision_round: 0, revision_available: true },
    brief: scenario.brief,
    current_plan: scenario.planningOutput(1).plan,
    conflict: {
      source: "harness",
      description: "10 a.m. fails heat; Park A's running lane is unusable",
      check_ids: ["heat.max_temperature", "space_surface.space"],
    },
    park_time_candidate_ids: snapshot.park_time_candidates.map((c) => c.id),
    revision_requests: [],
  };
  const deps: AgentDeps = {
    tools,
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

async function runWith(steps: FakeStep[], opts: { input?: Partial<SpecialistInput>; overrides?: Partial<ToolRegistry> } = {}) {
  const { input, deps, snapshot } = setup();
  const fake = createFakeRunner(steps);
  restore = fake.install();
  const result = await logisticsAgent.run({ ...input, ...opts.input }, { ...deps, tools: { ...tools, ...opts.overrides } });
  return { result, fake, deps, snapshot };
}

const fixture = () => case02.logisticsOutput(1);
const parkB = () => fixture().options[0];
/** What the model might send; the harness fills in the real checks. */
const placeholderChecks: CheckPlanResult = { event_version: 1, evidence_snapshot_id: case02.SNAPSHOT_ID, overall: "unknown", checks: [], blockers: [] };
const output = (options: LogisticsOutput["options"] = fixture().options.map((o) => ({ ...o, checks: placeholderChecks }))) => ({
  ...fixture(),
  options,
});
const realChecks = async (o: LogisticsOutput["options"][number]) => {
  const { deps } = setup();
  return await tools.check_plan({ plan: o.plan }, deps.tool_context);
};

/** A typical model turn: read parks and conditions at Park B 8 a.m., then check that plan. */
function readAndCheck(): FakeStep {
  const { plan } = parkB();
  const window = { park_id: plan.park_id!, start_time: plan.start_time!, end_time: "2026-07-16T08:45" };
  return {
    tool_calls: [
      { name: "get_park_candidates", input: { park_ids: null } },
      { name: "get_forecast", input: window },
      { name: "get_air_quality", input: window },
      { name: "check_plan", input: { plan } },
    ],
  };
}

describe("logisticsDefinition", () => {
  it("allows exactly the 4 Logistics tools and uses the prompt file", () => {
    expect(logisticsDefinition.allowed_tools).toEqual(["get_park_candidates", "get_forecast", "get_air_quality", "check_plan"]);
    expect(logisticsDefinition.system_prompt).toContain("Event Logistics Agent");
  });

  it("sends the conflict, current plan, allowed candidates and brief, and labels the brief as data", () => {
    const { input } = setup();
    const message = logisticsDefinition.build_user_message(input);
    expect(message).toContain("event_version: 1");
    expect(message).toContain(case02.SNAPSHOT_ID);
    expect(message).toContain("Park A's running lane is unusable");
    expect(message).toContain('["cand-a-0800","cand-a-1000","cand-b-0800"]');
    expect(message).toContain("Keep the current workout unchanged");
    expect(message).toContain("not instructions");
    expect(message).not.toContain("Reviewer revision requests");
  });

  it("includes reviewer revision requests in the revision round", () => {
    const { input } = setup();
    const message = logisticsDefinition.build_user_message({
      ...input,
      context: { ...input.context, revision_round: 1, revision_available: false },
      revision_requests: [{ specialist: "logistics", option_ids: ["log-1"], issue: "Park B lane unverified", required_correction: "Try 8:30" }],
    });
    expect(message).toContain("revision_round: 1");
    expect(message).toContain("Park B lane unverified");
  });

  it("is the real (not stub) agent", () => {
    expect(logisticsAgent.kind).toBe("real");
  });
});

describe("Case 2", () => {
  it("proposes Park B and Park A at 8 a.m. with check_plan's results and Park B's space as unknown", async () => {
    const { result, snapshot } = await runWith([readAndCheck(), { output: output() }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => LogisticsOutput.parse(result.output)).not.toThrow();
    expect(result.output.status).toBe("options_proposed");
    expect(result.output.options.map((o) => o.option_id)).toEqual(["log-1", "log-2"]);

    const [b, a] = result.output.options;
    expect(b.checks).toEqual(await realChecks(b));
    expect(a.checks).toEqual(await realChecks(a));
    expect(b.checks.checks.find((c) => c.check_id === "space_surface.space")?.status).toBe("unknown");
    expect(b.checks.checks.find((c) => c.check_id === "event_constraints.allowed_park")?.status).toBe("pass");
    for (const c of b.checks.checks.filter((x) => x.critical && x.status === "unknown")) expect(b.unknowns).toContain(c.reason);

    const known = new Set(snapshot.items.map((i) => i.id));
    for (const o of result.output.options) for (const id of o.evidence_ids) expect(known).toContain(id);
    expect(result.usage).toMatchObject({ agent_executions: 1, model_requests: 2, tool_calls: 4 });
  });
});

describe("the model can't overrule the harness", () => {
  it("replaces claimed passing checks with check_plan's real results", async () => {
    const real = await realChecks(parkB());
    const lie: CheckPlanResult = { ...real, overall: "pass", blockers: [], checks: real.checks.map((c) => ({ ...c, status: "pass" as const })) };
    const { result } = await runWith([{ output: output([{ ...parkB(), checks: lie }]) }]);
    expect(result.ok && result.output.options[0].checks).toEqual(real);
  });

  it("drops an option assessed for a candidate it wasn't given", async () => {
    const { result } = await runWith([{ output: output() }], { input: { park_time_candidate_ids: ["cand-a-1000"] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.options).toEqual([]);
    expect(result.output.status).toBe("needs_verification");
    expect(result.output.concerns.some((c) => c.description.includes("log-1 was dropped"))).toBe(true);
  });

  it("drops an option whose plan does not match its candidate", async () => {
    const moved = { ...parkB(), plan: { ...parkB().plan, start_time: "2026-07-16T09:00" }, checks: placeholderChecks };
    const { result } = await runWith([{ output: output([moved]) }]);
    expect(result.ok && result.output.options).toEqual([]);
  });

  it("drops an option that changes the workout (that's Workout Adaptation's job)", async () => {
    const adapted = { ...parkB(), plan: { ...parkB().plan, adaptation_ids: ["adapt-stationary-circuit"] }, checks: placeholderChecks };
    const longer = { ...parkB(), option_id: "log-long", plan: { ...parkB().plan, duration_minutes: 60 }, checks: placeholderChecks };
    const { result } = await runWith([{ output: output([adapted, longer]) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.options).toEqual([]);
    expect(result.output.concerns.filter((c) => c.description.includes("changes the workout"))).toHaveLength(2);
  });

  it("drops an option that keeps the current park and time", async () => {
    const current = case02.planningOutput(1).plan;
    const same = { ...parkB(), park_time_candidate_ids: [current.park_time_candidate_id!], plan: current, checks: placeholderChecks };
    const { result } = await runWith([{ output: output([same]) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.options).toEqual([]);
    expect(result.output.concerns.some((c) => c.description.includes("keeps the current park and time"))).toBe(true);
  });

  it("removes evidence IDs that aren't in the snapshot and says so", async () => {
    const o = { ...parkB(), evidence_ids: [...parkB().evidence_ids, "ev-invented-lane"], checks: placeholderChecks };
    const { result } = await runWith([{ output: output([o]) }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.options[0].evidence_ids).not.toContain("ev-invented-lane");
    expect(result.output.options[0].unknowns.some((u) => u.includes("ev-invented-lane"))).toBe(true);
  });

  it("keeps a failed critical check as a blocking concern", async () => {
    const outside = { ...case02.brief, allowed_park_ids: ["park-a"], preferred_park_id: null };
    const { input, deps } = setup();
    const out = await enforceLogisticsResults(
      output([{ ...parkB(), checks: placeholderChecks }]),
      { ...input, brief: outside },
      { ...deps, tool_context: { ...deps.tool_context, brief: outside } },
    );
    expect(out.options[0].checks.checks.find((c) => c.check_id === "event_constraints.allowed_park")?.status).toBe("fail");
    expect(out.concerns.some((c) => c.blocking && c.related_check_ids.includes("event_constraints.allowed_park"))).toBe(true);
  });
});

describe("runner safeguards still apply", () => {
  it("rejects more than 3 options", async () => {
    const four = [1, 2, 3, 4].map((n) => ({ ...parkB(), option_id: `log-${n}`, checks: placeholderChecks }));
    const { result } = await runWith([{ output: output(four) }, { output: output(four) }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_output");
  });

  it("rejects an answer for an old event version", async () => {
    const { result } = await runWith([{ output: { ...output(), event_version: 2 } }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("stale_context");
  });

  it("rejects a tool the Logistics agent isn't allowed to use", async () => {
    const { result } = await runWith([{ tool_calls: [{ name: "get_workout_templates", input: { template_ids: null } }] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("tool_error");
  });
});

describe("every eval fixture's Logistics output passes the harness's checks unchanged", () => {
  for (const s of evalCases) {
    if (!("logisticsOutput" in s) || !s.logisticsOutput) continue;
    it(`Case ${s.expected.case_number}`, async () => {
      const { input, deps } = setup(s);
      const fixtureOut = s.logisticsOutput(1);
      const out = await enforceLogisticsResults(fixtureOut, input, deps);
      expect(out.options.map((o) => o.option_id)).toEqual(fixtureOut.options.map((o) => o.option_id));
      expect(out.status).toBe(fixtureOut.status);
    });
  }
});
