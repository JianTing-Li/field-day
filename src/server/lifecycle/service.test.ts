import { beforeEach, describe, expect, it, vi } from "vitest";
import { case01 } from "@fixtures/scenarios";
import type { CheckPlanResult, EvidenceSnapshot, FieldDayEvent } from "@/contracts";
import type { ConflictReviewResult } from "@/server/orchestrator";

/**
 * Test hooks: replace the snapshot a recheck gets (a new snapshot ID stands in for refreshed
 * evidence, since fixture snapshot IDs never change), the check_plan result, or the review result.
 */
const hooks = vi.hoisted(() => ({
  snapshot: null as null | ((s: EvidenceSnapshot) => EvidenceSnapshot),
  checks: null as null | ((r: CheckPlanResult) => CheckPlanResult),
  review: null as null | ((r: ConflictReviewResult) => ConflictReviewResult | Promise<ConflictReviewResult>),
}));

vi.mock("./snapshots", async (orig) => {
  const m = await orig<typeof import("./snapshots")>();
  // Events these tests create are planned on the Case 1 fixture, so the fixture-backed stub agents
  // can answer; the seeded demo events keep their own scenarios.
  const pick = (real: typeof m.snapshotFor) => async (...args: Parameters<typeof m.snapshotFor>) => {
    const [event, version] = args;
    const s = event.id in m.SCENARIO_EVENTS ? await real(...args) : case01.snapshot(event.id, version);
    return hooks.snapshot ? hooks.snapshot(s) : s;
  };
  return { ...m, snapshotFor: pick(m.snapshotFor), refreshedSnapshot: pick(m.refreshedSnapshot) };
});

vi.mock("@/server/rules/check-plan", async (orig) => {
  const m = await orig<typeof import("@/server/rules/check-plan")>();
  return {
    ...m,
    checkPlan: (...args: Parameters<typeof m.checkPlan>) => {
      const r = m.checkPlan(...args);
      return hooks.checks ? hooks.checks(r) : r;
    },
  };
});

vi.mock("@/server/orchestrator", async (orig) => {
  const m = await orig<typeof import("@/server/orchestrator")>();
  return {
    ...m,
    runConflictReview: async (...args: Parameters<typeof m.runConflictReview>) => {
      const r = await m.runConflictReview(...args);
      return hooks.review ? await hooks.review(r) : r;
    },
  };
});

let svc: typeof import("./service");

beforeEach(async () => {
  // Fresh store and freshly seeded events for every test.
  hooks.snapshot = hooks.checks = hooks.review = null;
  vi.useRealTimers();
  // Fixture events are dated mid-2026; pin "today" before them so the past-date rule never trips.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-01T12:00:00Z") });
  delete (globalThis as { __fieldDayStore?: unknown }).__fieldDayStore;
  vi.resetModules();
  svc = await import("./service");
});

const cur = (e: FieldDayEvent) => e.versions.find((v) => v.version === e.current_version)!;
const snap = (e: FieldDayEvent) => cur(e).evidence_snapshot_id!;
const ver = (e: FieldDayEvent, n: number) => e.versions.find((v) => v.version === n)!;

/** Case 1: a new event with a generated draft (v2, ready for approval). */
async function readyCase1() {
  let { event } = await svc.createEvent({ brief: case01.brief });
  ({ event } = await svc.generateDraft(event.id, { version: 1 }));
  return event;
}

async function approvedCase1() {
  const e = await readyCase1();
  return (await svc.approve(e.id, { version: e.current_version, evidence_snapshot_id: snap(e) })).event;
}

const surfaceParkA = {
  check_id: "space_surface.surface" as const,
  park_id: "park-a",
  start_time: "2026-07-16T08:00",
  statement: "Lawn surface is dry, level grass",
  note: null,
};

/**
 * Case 2: review, apply combo-1 (Park A 8 a.m.), confirm Park A space and surface → v3 ready for
 * approval. The harness checks the applied option itself, so both show as unknown until confirmed.
 */
async function readyCase2() {
  let { event } = await svc.requestReview("evt-case-02", { version: 2 });
  ({ event } = await svc.applyOption(event.id, { version: 2, combined_option_id: "combo-1" }));
  ({ event } = await svc.addConfirmation(event.id, {
    version: 3,
    check_id: "space_surface.space",
    park_id: "park-a",
    start_time: "2026-07-16T08:00",
    statement: "Open lawn fits 18 people",
    note: null,
  }));
  ({ event } = await svc.addConfirmation(event.id, { ...surfaceParkA, version: 3 }));
  return event;
}


const parkB = {
  check_id: "space_surface.space" as const,
  park_id: "park-b",
  start_time: null,
  statement: "Park B lawn is open",
  note: null,
};

/** A refreshed snapshot (new ID) whose revalidation blocks the planned time on heat. */
function refreshedEvidenceBlocksHeat() {
  hooks.snapshot = (s) => ({ ...s, id: "snap-refreshed" });
  hooks.checks = (r) => ({
    ...r,
    overall: "fail",
    blockers: ["heat.max_temperature"],
    checks: r.checks.map((c) =>
      c.check_id === "heat.max_temperature" ? { ...c, status: "fail", reason: "Refreshed forecast exceeds the limit" } : c,
    ),
  });
}

describe("seeded events", () => {
  it("seeds Case 1 (ready) and Case 2 (blocked)", async () => {
    const { events } = await svc.listEvents();
    const byId = Object.fromEntries(events.map((e) => [e.id, e.status]));
    expect(byId["evt-case-01"]).toBe("ready_for_approval");
    expect(byId["evt-case-02"]).toBe("needs_verification");
  });
});

describe("allowed transitions", () => {
  it("create → draft → ready_for_approval → approved → finalized", async () => {
    let { event } = await svc.createEvent({ brief: case01.brief });
    expect(cur(event).status).toBe("draft");
    expect(event.current_version).toBe(1);

    ({ event } = await svc.generateDraft(event.id, { version: 1 }));
    expect(cur(event).status).toBe("ready_for_approval");
    expect(event.current_version).toBe(2);

    ({ event } = await svc.approve(event.id, { version: 2, evidence_snapshot_id: snap(event) }));
    expect(cur(event).status).toBe("approved");
    expect(event.approval).toMatchObject({ version: 2, evidence_snapshot_id: snap(event) });

    const res = await svc.finalize(event.id, { version: 2, idempotency_key: "k1" });
    expect(res.finalized).toBe(true);
    expect(cur(res.event).status).toBe("finalized");
    expect(res.event.finalized).toMatchObject({ version: 2, idempotency_key: "k1" });

    const { events } = await svc.listEvents();
    expect(events.find((e) => e.id === event.id)).toMatchObject({ status: "finalized", finalized_version: 2 });
  });

  it("needs_verification → ready_for_approval when a confirmation resolves the last blocker", async () => {
    const event = await readyCase2();
    expect(cur(event).status).toBe("ready_for_approval");
    expect(cur(event).checks?.overall).toBe("pass");
  });

  it("walks Case 2 from conflict review to a single finalized event", async () => {
    let event = await readyCase2();
    ({ event } = await svc.approve(event.id, { version: 3, evidence_snapshot_id: snap(event) }));
    const first = await svc.finalize(event.id, { version: 3, idempotency_key: "k1" });
    expect(first.gate.every((g) => g.status === "pass")).toBe(true);
    expect(first.finalized).toBe(true);
    expect(first.event.finalized?.version).toBe(3);
  });

  it("rechecking unchanged evidence keeps the version and approval", async () => {
    const e = await approvedCase1();
    const { event } = await svc.recheck(e.id, { version: 2 });
    expect(event.current_version).toBe(2);
    expect(event.approval?.version).toBe(2);
    expect(event.last_run?.progress.at(-1)?.message).toContain("Evidence unchanged");
  });

  it("requesting review keeps approval (nothing changed)", async () => {
    let event = await readyCase2();
    ({ event } = await svc.approve(event.id, { version: 3, evidence_snapshot_id: snap(event) }));
    ({ event } = await svc.requestReview(event.id, { version: 3 }));
    expect(event.approval?.version).toBe(3);
    expect(cur(event).alternatives).not.toBeNull();
  });
});

describe("audit fixes (JT-24)", () => {
  it("a draft that fails a critical check arrives with its alternatives, without a second click", async () => {
    const { event } = await svc.getEvent("evt-case-02");
    expect(cur(event).status).toBe("needs_verification");
    expect(cur(event).alternatives?.ranked_options.length).toBeGreaterThan(0);
  });

  it("applying an option drops facts about the old time and to-dos about other parks", async () => {
    let { event } = await svc.requestReview("evt-case-02", { version: 2 });
    const oldFacts = cur(event).facts.map((f) => f.claim);
    expect(oldFacts.some((c) => c.includes("10 a.m."))).toBe(true);
    ({ event } = await svc.applyOption(event.id, { version: 2, combined_option_id: "combo-1" }));
    const v = cur(event);
    expect(v.facts.some((f) => f.claim.includes("10 a.m."))).toBe(false);
    expect(v.organizer_tasks.every((t) => t.park_id === null || t.park_id === "park-a")).toBe(true);
    // Every critical check that isn't a pass has a blocking concern from the harness's own result.
    for (const id of v.checks!.blockers) {
      expect(v.concerns.some((c) => c.blocking && c.related_check_ids.includes(id))).toBe(true);
    }
  });

  it("a report on a locked-in plan adds a new version and leaves the locked-in one as it was (D-JT24-12)", async () => {
    const e = await approvedCase1();
    const { event: done } = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    const plan = cur(done).plan!;
    const { event } = await svc.reportChange(done.id, {
      version: 2,
      change: { kind: "park_issue", description: "The lawn is fenced off", check_id: "space_surface.space", park_id: plan.park_id, start_time: null },
    });
    expect(event.current_version).toBe(3);
    expect(ver(event, 2).status).toBe("finalized");
    expect(event.finalized?.version).toBe(2);
    const space = cur(event).checks!.checks.find((c) => c.check_id === "space_surface.space")!;
    expect(space).toMatchObject({ status: "fail", reason: "You reported: The lawn is fenced off" });
    expect(cur(event).status).toBe("needs_verification");
  });

  it("a report keeps failing that check at that park, and a later confirmation clears it", async () => {
    let event = await readyCase2(); // v3 at Park A 8 a.m., space and surface confirmed
    ({ event } = await svc.reportChange(event.id, {
      version: 3,
      change: { kind: "park_issue", description: "Lawn closed for reseeding", check_id: "space_surface.space", park_id: "park-a", start_time: null },
    }));
    const space = () => cur(event).checks!.checks.find((c) => c.check_id === "space_surface.space")!;
    expect(space().status).toBe("fail");
    // Newer than the report, so it supersedes it.
    vi.setSystemTime(new Date("2026-07-01T13:00:00Z"));
    ({ event } = await svc.addConfirmation(event.id, {
      version: 4,
      check_id: "space_surface.space",
      park_id: "park-a",
      start_time: "2026-07-16T08:00",
      statement: "The fence is gone, the lawn is open",
      note: null,
    }));
    expect(space().status).toBe("pass");
    expect(cur(event).status).toBe("ready_for_approval");
  });

  it("a rain report fails rain at that time at every park, and only checks people can report are accepted", async () => {
    const { event } = await svc.reportChange("evt-case-02", {
      version: 2,
      change: { kind: "conditions", description: "Storms expected all morning", check_id: "weather.rain", park_id: null, start_time: "2026-07-16T10:00" },
    });
    expect(cur(event).checks!.checks.find((c) => c.check_id === "weather.rain")!.status).toBe("fail");
    await expect(
      svc.reportChange(event.id, {
        version: event.current_version,
        change: { kind: "other", description: "x", check_id: "duration.fits", park_id: null, start_time: null },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("re-checks the alternatives with the report, so an option at the reported time never looks like a fix", async () => {
    const { event } = await svc.reportChange("evt-case-02", {
      version: 2,
      change: { kind: "conditions", description: "Storms at 8", check_id: "weather.rain", park_id: null, start_time: "2026-07-16T08:00" },
    });
    const at8 = cur(event).alternatives!.ranked_options.filter((o) => o.plan.start_time === "2026-07-16T08:00");
    expect(at8.length).toBeGreaterThan(0);
    for (const o of at8) {
      expect(o.checks.checks.find((c) => c.check_id === "weather.rain")!.status).toBe("fail");
    }
    expect(cur(event).alternatives!.recommendation).toBeNull();
  });

  it("keeps the organizer's reported change on the event", async () => {
    const { event } = await svc.reportChange("evt-case-02", {
      version: 2,
      change: { kind: "park_issue", description: "The lawn is fenced off for reseeding" },
    });
    expect(event.change_reports).toEqual([
      expect.objectContaining({ version: 2, kind: "park_issue", description: "The lawn is fenced off for reseeding" }),
    ]);
  });

  it("keeps a failed lock-in on the event until the plan changes", async () => {
    const e = await approvedCase1();
    hooks.checks = (r) => ({
      ...r,
      overall: "unknown",
      blockers: ["freshness.conditions"],
      checks: r.checks.map((c) => (c.check_id === "freshness.conditions" ? { ...c, status: "unknown", reason: "Forecast is stale" } : c)),
    });
    await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    let { event } = await svc.getEvent(e.id);
    expect(event.last_gate).toMatchObject({ version: 2 });
    expect(event.last_gate!.gate.some((g) => g.status === "fail")).toBe(true);
    hooks.checks = null;
    ({ event } = await svc.generateDraft(e.id, { version: 2 }));
    expect(event.last_gate).toBeNull();
  });

  it("rejects a past date on a new event, and a changed date in the past on an edit", async () => {
    await expect(svc.createEvent({ brief: { ...case01.brief, date: "2026-06-30" } })).rejects.toMatchObject({
      code: "invalid_request",
    });
    const e = await readyCase1();
    await expect(
      svc.updateBrief(e.id, { brief: { ...e.brief, date: "2026-06-30" }, based_on_version: 2 }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("still lets an older event's other fields be edited", async () => {
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    const { event } = await svc.getEvent("evt-case-02"); // dated Jul 16, now in the past
    const r = await svc.updateBrief(event.id, { brief: { ...event.brief, title: "Renamed" }, based_on_version: 2 });
    expect(r.event.brief.title).toBe("Renamed");
  });

  it("an edit to the name, notes or priorities keeps the plan and confirmations (D-JT24-5)", async () => {
    const e = await readyCase2(); // v3, two confirmations
    const { event } = await svc.updateBrief(e.id, {
      brief: { ...e.brief, title: "Renamed run club", priorities: ["Keep Park A"] },
      based_on_version: 3,
    });
    expect(cur(event)).toMatchObject({ version: 4, status: "ready_for_approval", source: "organizer_edit" });
    expect(cur(event).plan).toEqual(ver(event, 3).plan);
    expect(event.confirmations).toHaveLength(2);
  });

  it("a material edit still clears the plan", async () => {
    const e = await readyCase2();
    const { event } = await svc.updateBrief(e.id, { brief: { ...e.brief, group_size: 12 }, based_on_version: 3 });
    expect(cur(event).plan).toBeNull();
  });

  it("rejects briefs and statements outside the input limits", async () => {
    await expect(svc.createEvent({ brief: { ...case01.brief, title: "x".repeat(121) } })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(svc.createEvent({ brief: { ...case01.brief, duration_minutes: 999_999 } })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(svc.createEvent({ brief: { ...case01.brief, group_size: 100_000 } })).rejects.toMatchObject({
      code: "invalid_request",
    });
    const { event } = await svc.requestReview("evt-case-02", { version: 2 });
    await expect(
      svc.addConfirmation(event.id, { ...parkB, statement: "x".repeat(501), version: 2 }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("marks a locked-in plan demo-only while it rests on fixtures or unreviewed limits", async () => {
    const e = await approvedCase1();
    const r = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(r.finalized).toBe(true);
    expect(r.event.finalized?.demo_only).toBe(true);
  });
});

describe("invalid transitions", () => {
  it("rejects approving, confirming, rechecking or reviewing a draft", async () => {
    const { event } = await svc.createEvent({ brief: case01.brief });
    await expect(svc.approve(event.id, { version: 1, evidence_snapshot_id: "snap-case-01" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(svc.addConfirmation(event.id, { ...parkB, version: 1 })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(svc.recheck(event.id, { version: 1 })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(svc.requestReview(event.id, { version: 1 })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("blocks approving needs_verification with the blockers", async () => {
    const { event } = await svc.getEvent("evt-case-02");
    await expect(svc.approve(event.id, { version: 2, evidence_snapshot_id: snap(event) })).rejects.toMatchObject({
      code: "blocked",
      details: expect.arrayContaining(["heat.max_temperature", "space_surface.space"]),
    });
  });

  it("treats a repeated approval of the same version as a no-op", async () => {
    const e = await approvedCase1();
    const { event } = await svc.approve(e.id, { version: 2, evidence_snapshot_id: snap(e) });
    expect(event.approval).toEqual(e.approval);
  });

  it("rejects changing a finalized version in place", async () => {
    const e = await approvedCase1();
    const { event } = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    const v = { version: 2 };
    await expect(svc.addConfirmation(event.id, { ...parkB, ...v })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(svc.requestReview(event.id, v)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(svc.approve(event.id, { ...v, evidence_snapshot_id: snap(event) })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("returns a failed gate (not a finalized event) when the version is not approved", async () => {
    const e = await readyCase1();
    const res = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(res.finalized).toBe(false);
    expect(res.gate.find((g) => g.id === "correct_version")?.status).toBe("fail");
    expect((await svc.getEvent(e.id)).event.finalized).toBeNull();
  });
});

describe("plan versions", () => {
  it("brief edits, generate, applied options and new snapshots each add a version; old versions are kept", async () => {
    let { event } = await svc.requestReview("evt-case-02", { version: 2 });
    const v2 = structuredClone(ver(event, 2));

    ({ event } = await svc.applyOption(event.id, { version: 2, combined_option_id: "combo-2" }));
    expect(cur(event)).toMatchObject({ version: 3, based_on_version: 2, source: "review" });

    refreshedEvidenceBlocksHeat();
    ({ event } = await svc.recheck(event.id, { version: 3 }));
    expect(cur(event)).toMatchObject({ version: 4, based_on_version: 3, source: "recheck", evidence_snapshot_id: "snap-refreshed" });
    hooks.snapshot = hooks.checks = null;

    ({ event } = await svc.updateBrief(event.id, { brief: { ...event.brief, group_size: 12 }, based_on_version: 4 }));
    expect(cur(event)).toMatchObject({ version: 5, source: "organizer_edit", status: "draft", plan: null });

    ({ event } = await svc.generateDraft(event.id, { version: 5 }));
    expect(cur(event)).toMatchObject({ version: 6, source: "planning" });

    expect(event.versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ver(event, 2)).toEqual(v2);
    expect(ver(event, 3).evidence_snapshot_id).toBe("snap-case-02");
  });
});

describe("approval invalidation", () => {
  async function expectCleared(event: FieldDayEvent, approvedVersion: number) {
    expect(event.approval).toBeNull();
    expect(ver(event, approvedVersion).status).toBe("ready_for_approval");
    const stored = (await svc.getEvent(event.id)).event;
    expect(stored.approval).toBeNull();
  }

  it("a brief edit clears approval and starts a new draft", async () => {
    const e = await approvedCase1();
    const { event } = await svc.updateBrief(e.id, { brief: { ...e.brief, group_size: 20 }, based_on_version: 2 });
    await expectCleared(event, 2);
    expect(cur(event).status).toBe("draft");
  });

  it("regenerating clears approval", async () => {
    const e = await approvedCase1();
    const { event } = await svc.generateDraft(e.id, { version: 2 });
    await expectCleared(event, 2);
    expect(cur(event)).toMatchObject({ version: 3, status: "ready_for_approval" });
  });

  it("a new evidence snapshot clears approval and revalidates the plan", async () => {
    const e = await approvedCase1();
    hooks.snapshot = (s) => ({ ...s, id: "snap-refreshed" });
    const { event } = await svc.recheck(e.id, { version: 2 });
    await expectCleared(event, 2);
    // Same Case 1 evidence under a new ID: check_plan re-runs against it and still passes.
    expect(cur(event)).toMatchObject({ version: 3, status: "ready_for_approval", evidence_snapshot_id: "snap-refreshed" });
    expect(cur(event).checks?.evidence_snapshot_id).toBe("snap-refreshed");
  });

  it("a new confirmation clears approval in place", async () => {
    const e = await approvedCase1();
    const { event } = await svc.addConfirmation(e.id, { ...parkB, version: 2 });
    await expectCleared(event, 2);
    expect(event.current_version).toBe(2);
  });

  it("a reported change clears approval", async () => {
    let event = await readyCase2();
    ({ event } = await svc.approve(event.id, { version: 3, evidence_snapshot_id: snap(event) }));
    ({ event } = await svc.reportChange(event.id, {
      version: 3,
      change: { kind: "park_issue", description: "Lawn is being reseeded" },
    }));
    await expectCleared(event, 3);
  });

  it("applying an option clears approval", async () => {
    let event = await readyCase2();
    ({ event } = await svc.approve(event.id, { version: 3, evidence_snapshot_id: snap(event) }));
    ({ event } = await svc.requestReview(event.id, { version: 3 }));
    ({ event } = await svc.applyOption(event.id, { version: 3, combined_option_id: "combo-2" }));
    await expectCleared(event, 3);
    expect(cur(event)).toMatchObject({ version: 4, status: "needs_verification" });
  });
});

describe("stale-result rejection", () => {
  it("rejects every action that names an outdated version", async () => {
    const e = await readyCase1(); // current version 2
    const old = { version: 1 };
    const stale = { code: "stale_version" };
    await expect(svc.generateDraft(e.id, old)).rejects.toMatchObject(stale);
    await expect(svc.recheck(e.id, old)).rejects.toMatchObject(stale);
    await expect(svc.requestReview(e.id, old)).rejects.toMatchObject(stale);
    await expect(svc.reportChange(e.id, { ...old, change: { kind: "other", description: "x" } })).rejects.toMatchObject(stale);
    await expect(svc.applyOption(e.id, { ...old, combined_option_id: "combo-1" })).rejects.toMatchObject(stale);
    await expect(svc.addConfirmation(e.id, { ...parkB, ...old })).rejects.toMatchObject(stale);
    await expect(svc.approve(e.id, { ...old, evidence_snapshot_id: snap(e) })).rejects.toMatchObject(stale);
    await expect(svc.updateBrief(e.id, { brief: e.brief, based_on_version: 1 })).rejects.toMatchObject(stale);
    await expect(svc.finalize(e.id, { ...old, idempotency_key: "k1" })).rejects.toMatchObject(stale);
  });

  it("rejects approval of an outdated evidence snapshot", async () => {
    const e = await readyCase1();
    await expect(svc.approve(e.id, { version: 2, evidence_snapshot_id: "snap-old" })).rejects.toMatchObject({
      code: "stale_version",
    });
    expect((await svc.getEvent(e.id)).event.approval).toBeNull();
  });

  it("rejects a review result for another version or snapshot without saving it", async () => {
    hooks.review = (r) => (r.ok ? { ...r, review: { ...r.review, evidence_snapshot_id: "snap-old" } } : r);
    const before = cur((await svc.getEvent("evt-case-02")).event).alternatives;
    await expect(svc.requestReview("evt-case-02", { version: 2 })).rejects.toMatchObject({ code: "stale_version" });
    const { event } = await svc.getEvent("evt-case-02");
    expect(cur(event).alternatives).toEqual(before);

    hooks.review = (r) => (r.ok ? { ...r, review: { ...r.review, event_version: 1 } } : r);
    await expect(svc.requestReview("evt-case-02", { version: 2 })).rejects.toMatchObject({ code: "stale_version" });
  });

  it("rejects a result that finishes after the event changed, even within the same millisecond", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-28T12:00:00Z") });
    const loaded = (await svc.getEvent("evt-case-02")).event;
    const { brief } = loaded;
    const before = cur(loaded).alternatives;
    // Another request creates version 3 while the review of version 2 is still running.
    hooks.review = async (r) => {
      await svc.updateBrief("evt-case-02", { brief: { ...brief, group_size: 12 }, based_on_version: 2 });
      return r;
    };
    await expect(svc.requestReview("evt-case-02", { version: 2 })).rejects.toMatchObject({ code: "stale_version" });
    const { event } = await svc.getEvent("evt-case-02");
    expect(event.current_version).toBe(3);
    expect(ver(event, 2).alternatives).toEqual(before);
  });

  it("Case 3: refreshed evidence blocks the approved time; the old approval cannot finalize", async () => {
    const approved = await approvedCase1();
    refreshedEvidenceBlocksHeat();
    const { event } = await svc.recheck(approved.id, { version: 2 });

    expect(event.approval).toBeNull();
    expect(cur(event)).toMatchObject({ version: 3, status: "needs_verification" });
    expect(cur(event).checks?.blockers).toContain("heat.max_temperature");

    await expect(svc.finalize(event.id, { version: 2, idempotency_key: "k1" })).rejects.toMatchObject({
      code: "stale_version",
    });
    const blocked = await svc.finalize(event.id, { version: 3, idempotency_key: "k1" });
    expect(blocked.finalized).toBe(false);
    expect((await svc.getEvent(event.id)).event.finalized).toBeNull();
  });
});

describe("confirmations", () => {
  it("a Park B confirmation does not resolve Park A, now or in a later version", async () => {
    let { event } = await svc.requestReview("evt-case-02", { version: 2 });
    ({ event } = await svc.addConfirmation(event.id, { ...parkB, version: 2 }));
    ({ event } = await svc.applyOption(event.id, { version: 2, combined_option_id: "combo-1" })); // Park A
    expect(cur(event).status).toBe("needs_verification");
    const space = cur(event).checks!.checks.find((c) => c.check_id === "space_surface.space")!;
    expect(space).toMatchObject({ status: "unknown", assessed: { park_id: "park-a" } });

    ({ event } = await svc.addConfirmation(event.id, { ...parkB, version: 3 }));
    expect(cur(event).status).toBe("needs_verification");
  });

  it("does not carry a confirmation that was not about the current plan", async () => {
    // v2 is the running plan at 10 a.m., so a Park A 8 a.m. confirmation has no known layout.
    let { event } = await svc.requestReview("evt-case-02", { version: 2 });
    ({ event } = await svc.addConfirmation(event.id, {
      ...parkB,
      park_id: "park-a",
      start_time: "2026-07-16T08:00",
      statement: "Open lawn fits 18 people",
      version: 2,
    }));
    expect(event.confirmations[0].layout).toBeNull();
    ({ event } = await svc.applyOption(event.id, { version: 2, combined_option_id: "combo-1" }));
    expect(cur(event).status).toBe("needs_verification");
  });

  it("carries a confirmation to a later version with the same layout, park and time", async () => {
    let event = await readyCase2(); // v3: stationary at Park A 8 a.m., space confirmed
    expect(event.confirmations[0].layout).toBe("stationary");
    ({ event } = await svc.requestReview(event.id, { version: 3 }));
    ({ event } = await svc.applyOption(event.id, { version: 3, combined_option_id: "combo-1" }));
    expect(cur(event)).toMatchObject({ version: 4, status: "ready_for_approval" });
  });

  it("does not carry a space confirmation to a plan with a different layout", async () => {
    let event = await readyCase2(); // stationary space confirmed at Park A 8 a.m.
    // The new review offers the running workout (no stationary adaptation) at the same park and time.
    hooks.review = (r) =>
      r.ok
        ? {
            ...r,
            review: {
              ...r.review,
              ranked_options: r.review.ranked_options.map((o) =>
                o.combined_option_id === "combo-1" ? { ...o, plan: { ...o.plan, adaptation_ids: [] } } : o,
              ),
            },
          }
        : r;
    ({ event } = await svc.requestReview(event.id, { version: 3 }));
    ({ event } = await svc.applyOption(event.id, { version: 3, combined_option_id: "combo-1" }));
    // The running workout needs the running lane, which Case 2 reports unusable: the stationary
    // confirmation doesn't carry over, and the harness's own check fails it.
    const space = cur(event).checks!.checks.find((c) => c.check_id === "space_surface.space")!;
    expect(space.status).not.toBe("pass");
    expect(cur(event).status).toBe("needs_verification");
  });

  it("does not resolve a different time at the same park", async () => {
    let { event } = await svc.requestReview("evt-case-02", { version: 2 });
    ({ event } = await svc.applyOption(event.id, { version: 2, combined_option_id: "combo-1" }));
    ({ event } = await svc.addConfirmation(event.id, {
      ...parkB,
      park_id: "park-a",
      start_time: "2026-07-16T10:00",
      version: 3,
    }));
    expect(cur(event).status).toBe("needs_verification");
  });

  it("rejects confirming anything but space, surface or permit (D-JT24-1)", async () => {
    const { event } = await svc.requestReview("evt-case-02", { version: 2 });
    for (const check_id of ["heat.max_temperature", "air_quality.max_aqi", "freshness.conditions", "duration.fits"] as const) {
      await expect(
        svc.addConfirmation(event.id, { ...parkB, check_id, park_id: "park-a", start_time: "2026-07-16T10:00", version: 2 }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect((await svc.getEvent(event.id)).event.confirmations).toEqual([]);
  });

  it("a stored heat confirmation never turns missing heat data into a pass, at approval or at the gate", async () => {
    const e = await approvedCase1();
    const { getStore } = await import("@/server/store");
    const stored = (await getStore().getEvent(e.id))!;
    const plan = cur(stored).plan!;
    // Saved before the rule existed (the audit's bypass): it must be ignored, not trusted.
    stored.confirmations.push({
      id: "conf-legacy-heat",
      check_id: "heat.max_temperature",
      park_id: plan.park_id!,
      start_time: plan.start_time,
      statement: "yes it's confirmed",
      confirmed_by: "Organizer",
      confirmed_at: new Date().toISOString(),
      note: null,
      layout: "stationary",
    });
    await getStore().saveEvent(stored, stored.updated_at);
    hooks.checks = (r) => ({
      ...r,
      overall: "unknown",
      blockers: ["heat.max_temperature"],
      checks: r.checks.map((c) =>
        c.check_id === "heat.max_temperature" ? { ...c, status: "unknown", reason: "No forecast", evidence_ids: [] } : c,
      ),
    });
    const r = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(r.finalized).toBe(false);
    expect(r.gate.find((g) => g.id === "hard_constraints")).toMatchObject({ status: "fail" });
  });

  it("saves a repeated confirmation only once", async () => {
    let event = await readyCase2();
    const before = event.confirmations.length;
    ({ event } = await svc.addConfirmation(event.id, {
      version: 3,
      check_id: "space_surface.space",
      park_id: "park-a",
      start_time: "2026-07-16T08:00",
      statement: "Open lawn fits 18 people, again",
      note: null,
    }));
    expect(event.confirmations).toHaveLength(before);
  });

  it("a brief edit retires confirmations made under the old brief", async () => {
    const event = await readyCase2();
    expect(event.confirmations).toHaveLength(2);
    const edited = await svc.updateBrief(event.id, { brief: { ...event.brief, group_size: 30 }, based_on_version: 3 });
    expect(edited.event.confirmations).toEqual([]);
  });
});

describe("final save gate (JT-09)", () => {
  const gateOf = (r: { gate: { id: string; status: string; reason: string }[] }, id: string) => r.gate.find((g) => g.id === id)!;

  it("passes all five checks for an approved Case 1 plan and saves one finalized record", async () => {
    const e = await approvedCase1();
    const r = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(r.finalized).toBe(true);
    expect(r.gate.map((g) => [g.id, g.status])).toEqual([
      ["complete_inputs", "pass"],
      ["correct_version", "pass"],
      ["current_evidence", "pass"],
      ["hard_constraints", "pass"],
      ["required_confirmations", "pass"],
    ]);
    const { getStore } = await import("@/server/store");
    expect(await getStore().getFinalized(e.id, 2)).toEqual(r.event.finalized);
  });

  it("does not refresh evidence or save anything for an unapproved version", async () => {
    const e = await readyCase1();
    const r = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(r.finalized).toBe(false);
    expect(gateOf(r, "correct_version").status).toBe("fail");
    expect(gateOf(r, "current_evidence").reason).toContain("Not checked");
    expect((await svc.getEvent(e.id)).event.updated_at).toBe(e.updated_at);
  });

  it("Case 3 demo: evidence refreshed at finalize blocks the approved plan, clears approval and adds a recheck version", async () => {
    let { event } = await svc.getEvent("evt-case-03");
    const v = event.current_version;
    expect(snap(event)).toBe("snap-case-03a");
    // Case 3's plan on snapshot A passes; approve it as the organizer would.
    ({ event } = await svc.approve(event.id, { version: v, evidence_snapshot_id: "snap-case-03a" }));
    const r = await svc.finalize(event.id, { version: v, idempotency_key: "k1" });
    expect(r.finalized).toBe(false);
    expect(gateOf(r, "current_evidence")).toMatchObject({ status: "fail" });
    expect(gateOf(r, "current_evidence").reason).toContain("snap-case-03b");
    expect(r.event.approval).toBeNull();
    expect(r.event.finalized).toBeNull();
    expect(cur(r.event)).toMatchObject({ version: v + 1, source: "recheck", evidence_snapshot_id: "snap-case-03b" });
    expect(cur(r.event).status).not.toBe("ready_for_approval");
    await expect(svc.finalize(event.id, { version: v, idempotency_key: "k2" })).rejects.toMatchObject({ code: "stale_version" });
  });

  it("Case 3 demo: Recheck finds the refreshed evidence once, then reports it unchanged", async () => {
    let { event } = await svc.getEvent("evt-case-03");
    const v = event.current_version;
    ({ event } = await svc.recheck(event.id, { version: v }));
    expect(cur(event)).toMatchObject({ version: v + 1, evidence_snapshot_id: "snap-case-03b" });
    ({ event } = await svc.recheck(event.id, { version: v + 1 }));
    expect(event.current_version).toBe(v + 1);
    expect(event.last_run?.progress[0].message).toContain("Evidence unchanged");
  });

  it("finalizes on refreshed evidence that still passes, recording the new snapshot", async () => {
    const e = await approvedCase1();
    hooks.snapshot = (s) => ({ ...s, id: "snap-refreshed" });
    const r = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(r.finalized).toBe(true);
    expect(gateOf(r, "current_evidence").reason).toContain("revalidated");
    expect(r.event.finalized?.evidence_snapshot_id).toBe("snap-refreshed");
  });

  it("blocks when the weather and air data are no longer current", async () => {
    const e = await approvedCase1();
    hooks.checks = (r) => ({
      ...r,
      overall: "unknown",
      blockers: ["freshness.conditions"],
      checks: r.checks.map((c) => (c.check_id === "freshness.conditions" ? { ...c, status: "unknown", reason: "Forecast is stale" } : c)),
    });
    const r = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(r.finalized).toBe(false);
    expect(gateOf(r, "current_evidence").reason).toContain("Forecast is stale");
    expect(gateOf(r, "hard_constraints").status).toBe("fail");
  });

  it("blocks a critical space check that passes without evidence or a confirmation", async () => {
    const e = await approvedCase1();
    hooks.checks = (r) => ({
      ...r,
      checks: r.checks.map((c) => (c.check_id === "space_surface.space" ? { ...c, evidence_ids: [] } : c)),
    });
    const r = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(r.finalized).toBe(false);
    expect(gateOf(r, "required_confirmations")).toMatchObject({ status: "fail" });
    expect(gateOf(r, "required_confirmations").reason).toContain("space_surface.space");
  });

  it("blocks a plan that is not on the event date", async () => {
    const e = await approvedCase1();
    const { getStore } = await import("@/server/store");
    const stored = (await getStore().getEvent(e.id))!;
    stored.brief = { ...stored.brief, date: "2026-12-01" };
    await getStore().saveEvent(stored, stored.updated_at);
    const r = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(r.finalized).toBe(false);
    expect(gateOf(r, "complete_inputs").reason).toContain("2026-12-01");
  });
});

describe("duplicate-save protection (JT-08)", () => {
  it("two finalize requests at once save one record and both report it", async () => {
    const e = await approvedCase1();
    const [a, b] = await Promise.all([
      svc.finalize(e.id, { version: 2, idempotency_key: "k1" }),
      svc.finalize(e.id, { version: 2, idempotency_key: "k2" }),
    ]);
    expect(a.finalized && b.finalized).toBe(true);
    expect(a.event.finalized).toEqual(b.event.finalized);
  });

  it("reconciles a save whose outcome was uncertain: the record exists but the event was not updated", async () => {
    const e = await approvedCase1();
    const { getStore } = await import("@/server/store");
    const record = { version: 2, evidence_snapshot_id: snap(e), finalized_at: "2026-10-29T08:00:00.000Z", gate: [], idempotency_key: "k1" };
    expect(await getStore().recordFinalized(e.id, record)).toBe(true);
    const r = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(r.finalized).toBe(true);
    expect(r.event.finalized).toEqual(record);
    expect(cur(r.event).status).toBe("finalized");
  });
});

describe("finalize idempotency", () => {
  it("repeats for the same version return the saved record, whatever the key", async () => {
    const e = await approvedCase1();
    const first = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    const same = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    const other = await svc.finalize(e.id, { version: 2, idempotency_key: "k2" });
    for (const r of [same, other]) {
      expect(r.finalized).toBe(true);
      expect(r.event.finalized).toEqual(first.event.finalized);
    }
    const { events } = await svc.listEvents();
    expect(events.filter((x) => x.id === e.id)).toHaveLength(1);
  });

  it("a replay after a new draft still returns the saved record and leaves it unchanged", async () => {
    const e = await approvedCase1();
    const first = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    const { event } = await svc.updateBrief(e.id, { brief: { ...e.brief, group_size: 20 }, based_on_version: 2 });
    expect(ver(event, 2).status).toBe("finalized");
    expect(event.finalized).toEqual(first.event.finalized);

    const replay = await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    expect(replay.finalized).toBe(true);
    expect(replay.event.current_version).toBe(3);
    expect(replay.event.finalized).toEqual(first.event.finalized);
  });

  it("rejects reusing a key for a different version", async () => {
    const e = await approvedCase1();
    await svc.finalize(e.id, { version: 2, idempotency_key: "k1" });
    let { event } = await svc.generateDraft(e.id, { version: 2 });
    ({ event } = await svc.approve(e.id, { version: 3, evidence_snapshot_id: snap(event) }));
    await expect(svc.finalize(e.id, { version: 3, idempotency_key: "k1" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    const next = await svc.finalize(e.id, { version: 3, idempotency_key: "k2" });
    expect(next.event.finalized).toMatchObject({ version: 3, idempotency_key: "k2" });
  });
});
