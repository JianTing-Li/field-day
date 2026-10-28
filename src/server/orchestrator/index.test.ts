import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ZERO_USAGE,
  type AgentDeps,
  type AgentErrorKind,
  type AgentImpl,
  type AgentIO,
  type AgentName,
  type CheckPlanResult,
  type CheckResult,
  type ReviewerOutput,
  type ToolRegistry,
} from "@/contracts";
import { case01, case02 } from "@fixtures/scenarios";
import { tools } from "@/server/tools";
import { agentKinds, agentMode, selectAgents, STUB_AGENTS, type AgentSet } from "./agents";
import {
  combinationChecks,
  findConflict,
  MAX_AGENT_EXECUTIONS,
  runConflictReview,
  runPlanning,
  runWorkflow,
} from "./index";

// Scripted fake agents stand in for Claude, so these tests make no API calls. Each fake records
// the input and deps it was called with, and answers with the next scripted reply.

type Reply<N extends AgentName> = AgentIO[N]["output"] | { error: AgentErrorKind };
type Fake<N extends AgentName> = AgentImpl<N> & { calls: Array<{ input: AgentIO[N]["input"]; deps: AgentDeps }> };

function fake<N extends AgentName>(name: N, replies: Array<Reply<N>>): Fake<N> {
  const calls: Fake<N>["calls"] = [];
  return {
    name,
    kind: "real",
    calls,
    run: async (input, deps) => {
      calls.push({ input, deps });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      const usage = { ...ZERO_USAGE, agent_executions: 1, model_requests: 1 };
      if (reply && typeof reply === "object" && "error" in reply) {
        return { ok: false, error: { kind: reply.error as AgentErrorKind, message: `scripted ${reply.error}` }, usage };
      }
      return { ok: true, output: reply as AgentIO[N]["output"], usage };
    },
  };
}

const snapshot2 = case02.snapshot("evt-test", 1);
const args2 = { event_id: "evt-test", event_version: 1, brief: case02.brief, snapshot: snapshot2 };
const conflict = { source: "organizer" as const, description: "Park A running lane is unusable", check_ids: [] };
const current = case02.planningOutput(1).plan;

function case2Agents(reviews: Array<Reply<"reviewer">> = [case02.reviewerOutput(1)]) {
  return {
    planning: fake("planning", [case02.planningOutput(1)]),
    logistics: fake("logistics", [case02.logisticsOutput(1)]),
    workout: fake("workout", [case02.workoutOutput(1)]),
    reviewer: fake("reviewer", reviews),
  };
}
const asSet = (a: ReturnType<typeof case2Agents>) => a as unknown as AgentSet;

/** check_plan stand-in that always returns Case 2's planning result (10 a.m. heat fails). */
const case2Checks: ToolRegistry["check_plan"] = () => case02.planningOutput(1).rule_checks!;

const revisionRequest = (status: ReviewerOutput["status"] = "revision_requested"): ReviewerOutput => ({
  ...case02.reviewerOutput(1),
  status,
  revision_requests: [{ specialist: "logistics", option_ids: ["log-1"], issue: "Park B lane unverified", required_correction: "Try Park A at 8:30" }],
});

const check = (status: CheckResult["status"], critical: boolean, check_id: CheckResult["check_id"]): CheckResult => ({
  check_id,
  area: "heat",
  status,
  critical,
  reason: `${check_id} is ${status}`,
  evidence_ids: [],
  policy_version: "test",
  assessed: { park_id: "park-a", start_time: "2026-07-16T10:00", workout_template_id: "t" },
});
const result = (checks: CheckResult[]): CheckPlanResult => ({ event_version: 1, evidence_snapshot_id: "s", overall: "unknown", checks, blockers: [] });

describe("findConflict", () => {
  it("is a harness conflict when a critical check fails", () => {
    const c = findConflict(result([check("fail", true, "heat.max_temperature"), check("pass", true, "duration.fits")]));
    expect(c).toEqual({ source: "harness", description: "heat.max_temperature: heat.max_temperature is fail", check_ids: ["heat.max_temperature"] });
  });

  it("is not a conflict when critical checks are only unknown: specialists cannot supply missing evidence", () => {
    expect(findConflict(result([check("unknown", true, "freshness.conditions")]))).toBeNull();
  });

  it("ignores a failed non-critical check", () => {
    expect(findConflict(result([check("fail", false, "permissions.permit_review")]))).toBeNull();
  });
});

describe("combinationChecks", () => {
  const deps: AgentDeps = { tools, tool_context: { snapshot: snapshot2, brief: case02.brief, event_version: 1 }, budget: undefined as never };

  it("checks every logistics x workout pair, each logistics option alone and each workout option alone", async () => {
    const lo = case02.logisticsOutput(1);
    const wo = case02.workoutOutput(1);
    const out = await combinationChecks(current, lo, wo, deps);
    expect(out).toHaveLength(lo.options.length * (1 + wo.options.length) + wo.options.length);

    const pair = out.find((c) => c.logistics_option_id === "log-1" && c.workout_option_id === wo.options[0].option_id)!;
    expect(pair.plan.park_id).toBe(lo.options[0].plan.park_id);
    expect(pair.plan.start_time).toBe(lo.options[0].plan.start_time);
    expect(pair.plan.adaptation_ids).toEqual(wo.options[0].plan.adaptation_ids);
    expect(pair.park_time_candidate_id).toBe(lo.options[0].plan.park_time_candidate_id);
    for (const c of out) expect(c.result).toEqual(await tools.check_plan({ plan: c.plan }, deps.tool_context));

    const alone = out.find((c) => c.logistics_option_id === "log-1" && c.workout_option_id === null)!;
    expect(alone.plan.adaptation_ids).toEqual(current.adaptation_ids);
  });
});

describe("runConflictReview", () => {
  it("runs both specialists in parallel, then the reviewer with the harness's combination checks", async () => {
    const a = case2Agents();
    const order: string[] = [];
    for (const name of ["logistics", "workout", "reviewer"] as const) {
      const agent = a[name] as unknown as { run: (input: unknown, deps: AgentDeps) => Promise<unknown> };
      const run = agent.run;
      agent.run = async (input, deps) => {
        order.push(`start ${name}`);
        const r = await run(input, deps);
        order.push(`end ${name}`);
        return r;
      };
    }
    const r = await runConflictReview({ ...args2, current_plan: current, conflict }, { agents: asSet(a) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(order.slice(0, 2).sort()).toEqual(["start logistics", "start workout"]);
    expect(order.at(-2)).toBe("start reviewer");
    expect(r.revision_rounds).toBe(0);
    expect(r.review.status).toBe(case02.reviewerOutput(1).status);

    const reviewerInput = a.reviewer.calls[0].input;
    expect(reviewerInput.combination_checks.length).toBeGreaterThan(0);
    expect(reviewerInput.context).toMatchObject({ revision_round: 0, revision_available: true });
    expect(a.logistics.calls[0].input.park_time_candidate_ids).toEqual(snapshot2.park_time_candidates.map((c) => c.id));
  });

  it("shares one budget across every agent in the run", async () => {
    const a = case2Agents();
    await runConflictReview({ ...args2, current_plan: current, conflict }, { agents: asSet(a) });
    const budgets = new Set([a.logistics, a.workout, a.reviewer].map((f) => f.calls[0].deps.budget));
    expect(budgets.size).toBe(1);
  });

  it("runs one revision round: only the named specialist runs again, then a final review", async () => {
    const a = case2Agents([revisionRequest(), case02.reviewerOutput(1)]);
    const r = await runConflictReview({ ...args2, current_plan: current, conflict }, { agents: asSet(a) });
    expect(r.ok && r.revision_rounds).toBe(1);
    expect(a.logistics.calls).toHaveLength(2);
    expect(a.workout.calls).toHaveLength(1);
    expect(a.reviewer.calls).toHaveLength(2);
    expect(a.logistics.calls[1].input.revision_requests).toEqual(revisionRequest().revision_requests);
    expect(a.logistics.calls[1].input.context).toMatchObject({ revision_round: 1, revision_available: false });
    expect(a.reviewer.calls[1].input.context).toMatchObject({ revision_round: 1, revision_available: false });
  });

  it("never starts a second revision round: a final review that still asks for one is unresolved", async () => {
    const a = case2Agents([revisionRequest(), revisionRequest()]);
    const r = await runConflictReview({ ...args2, current_plan: current, conflict }, { agents: asSet(a) });
    expect(a.reviewer.calls).toHaveLength(2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.review.status).toBe("needs_verification");
    expect(r.review.revision_requests).toEqual([]);
    expect(r.review.blocking_issues).toContain("Unresolved after review (logistics): Park B lane unverified");
  });

  it("ignores a revision request that comes without revision_requested status", async () => {
    const a = case2Agents([revisionRequest("needs_verification")]);
    const r = await runConflictReview({ ...args2, current_plan: current, conflict }, { agents: asSet(a) });
    expect(r.ok && r.revision_rounds).toBe(0);
    expect(r.ok && r.review.revision_requests).toEqual([]);
    expect(a.logistics.calls).toHaveLength(1);
  });

  it("returns an explicit unresolved result when the budget runs out", async () => {
    const a = case2Agents();
    a.workout = fake("workout", [{ error: "budget_exhausted" }]);
    const r = await runConflictReview({ ...args2, current_plan: current, conflict }, { agents: asSet(a) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("budget_exhausted");
    expect(r.message).toContain("Workout Adaptation");
    expect(a.reviewer.calls).toHaveLength(0);
  });

  it("rejects a specialist answer for another event version or snapshot", async () => {
    const a = case2Agents();
    a.logistics = fake("logistics", [{ ...case02.logisticsOutput(1), event_version: 2 }]);
    const r = await runConflictReview({ ...args2, current_plan: current, conflict }, { agents: asSet(a) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("stale_context");

    const b = case2Agents([{ ...case02.reviewerOutput(1), evidence_snapshot_id: "snap-old" }]);
    const s = await runConflictReview({ ...args2, current_plan: current, conflict }, { agents: asSet(b) });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.kind).toBe("stale_context");
  });

  it("reports usage and which agents were stubs", async () => {
    const r = await runConflictReview({ ...args2, current_plan: current, conflict }, { agents: STUB_AGENTS });
    expect(r.ok).toBe(true);
    expect(r.agents).toEqual({ planning: "stub", logistics: "stub", workout: "stub", reviewer: "stub" });
    const a = case2Agents();
    const f = await runConflictReview({ ...args2, current_plan: current, conflict }, { agents: asSet(a) });
    expect(f.usage.agent_executions).toBe(3);
  });
});

describe("runWorkflow", () => {
  it("drafts a plan and skips review when check_plan finds no conflict (Case 1)", async () => {
    const snapshot = case01.snapshot("evt-test", 1);
    const r = await runWorkflow(
      { event_id: "evt-test", event_version: 1, brief: case01.brief, snapshot },
      { agents: STUB_AGENTS, tools: { ...tools, check_plan: () => case01.planningOutput(1).rule_checks! } },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conflict).toBeNull();
    expect(r.review).toBeNull();
    expect(r.checks.overall).toBe("pass");
  });

  it("runs the conflict review when a critical check fails (Case 2), within one run and budget", async () => {
    const a = case2Agents();
    const r = await runWorkflow(args2, { agents: asSet(a), tools: { ...tools, check_plan: case2Checks } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conflict?.source).toBe("harness");
    expect(r.conflict?.check_ids).toContain("heat.max_temperature");
    expect(r.review?.ok).toBe(true);
    expect(r.usage.agent_executions).toBe(4);
    expect(new Set([a.planning, a.logistics, a.reviewer].map((f) => f.calls[0].deps.budget)).size).toBe(1);
  });

  it("uses exactly the PRD's 7 agent executions at most: planning, 2 specialists, review, 2 revisions, final review", async () => {
    const bothRevise: ReviewerOutput = {
      ...revisionRequest(),
      revision_requests: [
        ...revisionRequest().revision_requests,
        { specialist: "workout", option_ids: ["wo-1"], issue: "Space unverified", required_correction: "Use a smaller layout" },
      ],
    };
    const a = case2Agents([bothRevise, case02.reviewerOutput(1)]);
    const r = await runWorkflow(args2, { agents: asSet(a), tools: { ...tools, check_plan: case2Checks } });
    expect(r.ok && r.usage.agent_executions).toBe(MAX_AGENT_EXECUTIONS);
    expect(r.ok && r.review?.ok && r.review.revision_rounds).toBe(1);
  });

  it("returns an explicit failure when Planning fails", async () => {
    const a = case2Agents();
    a.planning = fake("planning", [{ error: "invalid_output" }]);
    const r = await runWorkflow(args2, { agents: asSet(a) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("invalid_output");
    expect(a.logistics.calls).toHaveLength(0);
  });
});

describe("runPlanning", () => {
  it("rejects a planning answer for another version", async () => {
    const r = await runPlanning(args2, { agents: asSet({ ...case2Agents(), planning: fake("planning", [{ ...case02.planningOutput(1), event_version: 3 }]) }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("stale_context");
  });
});

describe("agent selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses stubs by default and real agents only when FIELDDAY_AGENTS=real", () => {
    vi.stubEnv("FIELDDAY_AGENTS", "");
    expect(agentMode()).toBe("stub");
    expect(agentKinds(selectAgents())).toEqual({ planning: "stub", logistics: "stub", workout: "stub", reviewer: "stub" });
    vi.stubEnv("FIELDDAY_AGENTS", "real");
    expect(agentMode()).toBe("real");
  });

  it("falls back to the stub for an agent that has no real implementation yet, and says so", () => {
    const kinds = agentKinds(selectAgents("real"));
    expect(kinds.planning).toBe("real");
    expect(kinds.workout).toBe("real");
    for (const name of ["logistics", "reviewer"] as const) expect(["stub", "real"]).toContain(kinds[name]);
  });
});
