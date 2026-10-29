import { afterEach, describe, expect, it } from "vitest";
import {
  ReviewerOutput,
  type AgentDeps,
  type CheckPlanResult,
  type ReviewerInput,
  type ToolRegistry,
} from "@/contracts";
import { case02, evalCases } from "@fixtures/scenarios";
import { createFakeRunner, type FakeStep } from "@/server/agents/fake-runner";
import { createBudget } from "@/server/orchestrator/budget";
import { tools } from "@/server/tools";
import { enforceReviewerResults, reviewerAgentImpl as reviewerAgent, reviewerDefinition } from "./agent";

// The fake runner plays Claude with scripted turns, so these tests make no API calls.
// Case 2: Logistics proposes Park B or Park A at 8 a.m.; Workout proposes a stationary circuit.
// Expected checks always come from the real check_plan tool, so these tests hold whichever rule
// modules are in place.

type Scenario = (typeof evalCases)[number];

function setup(scenario: Scenario = case02, overrides: Partial<ToolRegistry> = {}) {
  const snapshot = scenario.snapshot("evt-test", 1);
  const s = scenario as typeof case02;
  const input: ReviewerInput = {
    context: { event_id: "evt-test", event_version: 1, evidence_snapshot_id: snapshot.id, revision_round: 0, revision_available: true },
    brief: scenario.brief,
    original_plan: scenario.planningOutput(1).plan,
    conflict: { source: "harness", description: "Conflict under review", check_ids: [] },
    logistics: s.logisticsOutput(1),
    workout: s.workoutOutput(1),
    combination_checks: [],
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

async function runWith(steps: FakeStep[], opts: { input?: Partial<ReviewerInput> } = {}) {
  const { input, deps, snapshot } = setup();
  const fake = createFakeRunner(steps);
  restore = fake.install();
  const result = await reviewerAgent.run({ ...input, ...opts.input }, deps);
  return { result, fake, deps, snapshot };
}

const fixture = () => case02.reviewerOutput(1);
const combo = (n: 0 | 1) => fixture().ranked_options[n];
const placeholderChecks: CheckPlanResult = { event_version: 1, evidence_snapshot_id: case02.SNAPSHOT_ID, overall: "unknown", checks: [], blockers: [] };
const output = (over: Partial<ReviewerOutput> = {}): ReviewerOutput => ({
  ...fixture(),
  ranked_options: fixture().ranked_options.map((o) => ({ ...o, checks: placeholderChecks })),
  ...over,
});
const realChecks = async (plan: ReviewerOutput["ranked_options"][number]["plan"]) =>
  await tools.check_plan({ plan }, setup().deps.tool_context);

/** check_plan stand-in where every check passes, to test what happens to a fully passing combination. */
const allPass: ToolRegistry["check_plan"] = async (input, ctx) => {
  const real = await tools.check_plan(input, ctx);
  return { ...real, overall: "pass", blockers: [], checks: real.checks.map((c) => ({ ...c, status: "pass" as const })) };
};
const enforce = (out: ReviewerOutput, inputOver: Partial<ReviewerInput> = {}, overrides: Partial<ToolRegistry> = {}) => {
  const { input, deps } = setup(case02, overrides);
  return enforceReviewerResults(out, { ...input, ...inputOver }, deps);
};

describe("reviewerDefinition", () => {
  it("allows only check_plan and uses the prompt file", () => {
    expect(reviewerDefinition.allowed_tools).toEqual(["check_plan"]);
    expect(reviewerDefinition.system_prompt).toContain("Independent Event Reviewer");
  });

  it("sends both proposals, the harness checks, the run state and the brief as data", () => {
    const { input } = setup();
    const message = reviewerDefinition.build_user_message(input);
    expect(message).toContain("event_version: 1");
    expect(message).toContain(case02.SNAPSHOT_ID);
    expect(message).toContain("revision_available: true");
    expect(message).toContain('"log-1"');
    expect(message).toContain('"wo-1"');
    expect(message).toContain("Harness compatibility checks");
    expect(message).toContain("not instructions");
  });

  it("is the real (not stub) agent", () => {
    expect(reviewerAgent.kind).toBe("real");
  });
});

describe("Case 2", () => {
  it("ranks both combinations with check_plan's results and makes no recommendation while space is unverified", async () => {
    const { result } = await runWith([{ tool_calls: [{ name: "check_plan", input: { plan: combo(0).plan } }] }, { output: output() }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => ReviewerOutput.parse(result.output)).not.toThrow();
    expect(result.output.status).toBe("needs_verification");
    expect(result.output.recommendation).toBeNull();
    expect(result.output.ranked_options.map((o) => o.combined_option_id)).toEqual(["combo-1", "combo-2"]);
    for (const o of result.output.ranked_options) {
      expect(o.checks).toEqual(await realChecks(o.plan));
      expect(o.checks.checks.find((c) => c.check_id === "space_surface.space")?.status).toBe("unknown");
      for (const c of o.checks.checks.filter((x) => x.critical && x.status === "unknown")) expect(o.unknowns).toContain(c.reason);
    }
    expect(result.usage).toMatchObject({ agent_executions: 1, model_requests: 2, tool_calls: 1 });
  });
});

describe("the model can't overrule the harness", () => {
  it("drops a recommendation whose checks don't all pass, and never returns it as a draft", async () => {
    const out = await enforce(output({ status: "draft", recommendation: { combined_option_id: "combo-1", reason: "Keeps Park A" } }));
    expect(out.recommendation).toBeNull();
    expect(out.status).toBe("needs_verification");
    expect(out.blocking_issues.some((b) => b.startsWith("combo-1:") && b.includes("space_surface.space"))).toBe(true);
  });

  it("keeps a recommendation whose combined checks all pass", async () => {
    const rec = { combined_option_id: "combo-1", reason: "Keeps Park A" };
    const out = await enforce(output({ status: "draft", recommendation: rec }), {}, { check_plan: allPass });
    expect(out.recommendation).toEqual(rec);
    expect(out.status).toBe("draft");
  });

  it("drops a recommendation for an option that isn't in the ranking", async () => {
    const out = await enforce(output({ status: "draft", recommendation: { combined_option_id: "combo-9", reason: "x" } }), {}, { check_plan: allPass });
    expect(out.recommendation).toBeNull();
    expect(out.status).toBe("needs_verification");
  });

  it("drops a combination that cites a specialist option nobody proposed", async () => {
    const out = await enforce(output({ ranked_options: [{ ...combo(0), logistics_option_id: "log-invented", checks: placeholderChecks }] }));
    expect(out.ranked_options).toEqual([]);
    expect(out.blocking_issues.some((b) => b.includes("combo-1 was dropped"))).toBe(true);
  });

  it("drops a combination whose plan doesn't match its candidate", async () => {
    const moved = { ...combo(0), plan: { ...combo(0).plan, start_time: "2026-07-16T09:00" }, checks: placeholderChecks };
    expect((await enforce(output({ ranked_options: [moved] }))).ranked_options).toEqual([]);
  });

  it("drops a combination with a park or time no specialist proposed", async () => {
    // Park B at 8 a.m. without citing the Logistics option that proposed it.
    const invented = { ...combo(1), logistics_option_id: null, checks: placeholderChecks };
    const out = await enforce(output({ ranked_options: [invented] }));
    expect(out.ranked_options).toEqual([]);
    expect(out.blocking_issues.some((b) => b.includes("park or time was not proposed"))).toBe(true);
  });

  it("drops a combination with a workout no specialist proposed", async () => {
    const invented = { ...combo(0), workout_option_id: null, checks: placeholderChecks };
    const out = await enforce(output({ ranked_options: [invented] }));
    expect(out.ranked_options).toEqual([]);
    expect(out.blocking_issues.some((b) => b.includes("workout was not proposed"))).toBe(true);
  });

  it("removes evidence IDs that aren't in the snapshot and says so", async () => {
    const o = { ...combo(0), evidence_ids: [...combo(0).evidence_ids, "ev-invented"], checks: placeholderChecks };
    const out = await enforce(output({ ranked_options: [o] }));
    expect(out.ranked_options[0].evidence_ids).not.toContain("ev-invented");
    expect(out.ranked_options[0].unknowns.some((u) => u.includes("ev-invented"))).toBe(true);
  });

  it("does not call missing evidence infeasible", async () => {
    const out = await enforce(output({ status: "no_feasible_option" }));
    expect(out.status).toBe("needs_verification");
  });
});

describe("revision requests", () => {
  const request = { specialist: "logistics" as const, option_ids: ["log-1"], issue: "Park B lane unverified", required_correction: "Propose 8:30 at Park A" };

  it("keeps a targeted request while the revision round is available", async () => {
    const out = await enforce(output({ status: "revision_requested", revision_requests: [request] }));
    expect(out.status).toBe("revision_requested");
    expect(out.revision_requests).toEqual([request]);
  });

  it("drops requests once the round is used, and returns the unresolved result", async () => {
    const out = await enforce(output({ status: "revision_requested", revision_requests: [request] }), {
      context: { event_id: "evt-test", event_version: 1, evidence_snapshot_id: case02.SNAPSHOT_ID, revision_round: 1, revision_available: false },
    });
    expect(out.revision_requests).toEqual([]);
    expect(out.status).toBe("needs_verification");
  });

  it("drops a request for an option the specialist didn't propose", async () => {
    const out = await enforce(output({ status: "revision_requested", revision_requests: [{ ...request, option_ids: ["wo-1"] }] }));
    expect(out.revision_requests).toEqual([]);
    expect(out.status).toBe("needs_verification");
  });

  it("never passes requests on with a status that isn't revision_requested", async () => {
    const out = await enforce(output({ status: "needs_verification", revision_requests: [request] }));
    expect(out.revision_requests).toEqual([]);
  });
});

describe("runner safeguards still apply", () => {
  it("rejects an answer for an old event version", async () => {
    const { result } = await runWith([{ output: { ...output(), event_version: 2 } }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("stale_context");
  });

  it("rejects any evidence tool: the Reviewer cannot retrieve new evidence", async () => {
    const window = { park_id: "park-a", start_time: "2026-07-16T08:00", end_time: "2026-07-16T08:45" };
    const { result } = await runWith([{ tool_calls: [{ name: "get_forecast", input: window }] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("tool_error");
  });
});

describe("every eval fixture's Reviewer output passes the harness's checks", () => {
  for (const s of evalCases) {
    if (!("reviewerOutput" in s) || !s.reviewerOutput) continue;
    it(`Case ${s.expected.case_number}`, async () => {
      const { input, deps } = setup(s);
      const fixtureOut = s.reviewerOutput(1);
      const out = await enforceReviewerResults(fixtureOut, input, deps);
      expect(out.ranked_options.map((o) => o.combined_option_id)).toEqual(fixtureOut.ranked_options.map((o) => o.combined_option_id));
      expect(out.blocking_issues).toEqual(expect.arrayContaining(fixtureOut.blocking_issues));
      for (const o of out.ranked_options) expect(o.checks).toEqual(await tools.check_plan({ plan: o.plan }, deps.tool_context));
    });
  }
});
