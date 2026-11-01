import { describe, expect, it, vi } from "vitest";
import { PlanningOutput, type AgentDeps, type EventBrief, type PlanningInput } from "@/contracts";
import { case01, case02 } from "@fixtures/scenarios";
import { createBudget } from "@/server/orchestrator/budget";
import { tools } from "@/server/tools";
import { createEvent, generateDraft } from "@/server/lifecycle/service";
import { rulesPlan } from "./rules-plan";
import { planningStub } from "./stub";

/** A scenario's snapshot under a new ID, so it looks like an organizer-created event (no fixture). */
function setup(scenario: typeof case01 | typeof case02, brief: Partial<EventBrief> = {}) {
  const snapshot = { ...scenario.snapshot("evt-new", 1), id: "snap-new-event" };
  const b = { ...scenario.brief, ...brief };
  const input: PlanningInput = {
    context: { event_id: "evt-new", event_version: 1, evidence_snapshot_id: snapshot.id, revision_round: 0, revision_available: true },
    brief: b,
  };
  const deps: AgentDeps = { tools, tool_context: { snapshot, brief: b, event_version: 1 }, budget: createBudget() };
  return { input, deps, snapshot };
}

describe("rulesPlan", () => {
  it("returns a valid plan built only from the snapshot, with checks from check_plan", async () => {
    const { input, deps, snapshot } = setup(case01);
    const out = await rulesPlan(input, deps);
    expect(() => PlanningOutput.parse(out)).not.toThrow();
    expect(out.evidence_snapshot_id).toBe("snap-new-event");
    expect(snapshot.park_time_candidates.map((c) => c.id)).toContain(out.plan.park_time_candidate_id);
    expect(out.rule_checks).toEqual(await tools.check_plan({ plan: out.plan }, deps.tool_context));
    const known = new Set(snapshot.items.map((i) => i.id));
    for (const f of out.facts) for (const id of f.evidence_ids) expect(known).toContain(id);
  });

  it("keeps the organizer's chosen workout", async () => {
    const { input, deps } = setup(case01, { workout_template_id: "tpl-bodyweight-45" });
    expect((await rulesPlan(input, deps)).plan.workout_template_id).toBe("tpl-bodyweight-45");
  });

  it("prefers a time that passes over one that fails (Case 2: 8 a.m. over the hot 10 a.m.)", async () => {
    const { input, deps } = setup(case02);
    const out = await rulesPlan(input, deps);
    expect(out.plan.start_time).toBe("2026-07-16T08:00");
    expect(out.rule_checks?.checks.find((c) => c.check_id === "heat.max_temperature")?.status).toBe("pass");
  });

  it("never calls a plan ready unless every critical check passes, and reports each blocker", async () => {
    const { input, deps } = setup(case02);
    const out = await rulesPlan(input, deps);
    if (out.rule_checks?.overall !== "pass") expect(out.status).not.toBe("draft");
    for (const id of out.rule_checks?.blockers ?? []) {
      expect(out.concerns.some((c) => c.blocking && c.related_check_ids.includes(id))).toBe(true);
    }
  });

  it("asks the organizer only to confirm space and ground, at this plan's park and time", async () => {
    const { input, deps } = setup(case02);
    const out = await rulesPlan(input, deps);
    for (const t of out.organizer_tasks) {
      expect(["space_surface.space", "space_surface.surface"]).toContain(t.resolves_check_id);
      expect(t.park_id).toBe(out.plan.park_id);
      expect(t.start_time).toBe(out.plan.start_time);
      expect(t.description).not.toMatch(/park-[a-z0-9]/);
    }
  });

  it("explains when there's nothing to check", async () => {
    const { input, deps } = setup(case01, { allowed_park_ids: ["park-nowhere"], preferred_park_id: null });
    const out = await rulesPlan(input, deps);
    expect(out.status).toBe("needs_verification");
    expect(out.concerns[0].description).toContain("no park and start time");
  });
});

describe("practice planner", () => {
  it("still returns the fixture for sample events", async () => {
    const snapshot = case01.snapshot("evt-1", 1);
    const r = await planningStub.run(
      { context: { event_id: "evt-1", event_version: 1, evidence_snapshot_id: snapshot.id, revision_round: 0, revision_available: true }, brief: case01.brief },
      { tools, tool_context: { snapshot, brief: case01.brief, event_version: 1 }, budget: createBudget() },
    );
    expect(r.ok && r.output).toEqual(case01.planningOutput(1));
  });

  it("plans a brand-new event end to end (create, then Draft a plan)", async () => {
    const brief: EventBrief = {
      title: "Saturday morning bootcamp",
      date: "2026-10-31",
      time_zone: "America/New_York",
      start_window: { earliest: "08:00", latest: "10:00" },
      duration_minutes: 45,
      group_size: 12,
      allowed_park_ids: ["park-b058", "park-q004"],
      preferred_park_id: null,
      workout_template_id: null,
      equipment_available: [],
      exercise_exclusions: [],
      instructor_limits: { max_temperature_f: null, max_aqi: null, notes: null },
      priorities: [],
    };
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-29T12:00:00Z") });
    const created = await createEvent({ brief });
    vi.useRealTimers();
    const { event } = await generateDraft(created.event.id, { version: created.event.current_version });
    const v = event.versions.find((x) => x.version === event.current_version)!;
    expect(event.last_run?.status).toBe("completed");
    expect(v.plan?.park_id).toMatch(/park-(b058|q004)/);
    expect(v.checks).not.toBeNull();
  });
});
