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
  return {
    snapshotFor: async (...args: Parameters<typeof m.snapshotFor>) => {
      const s = await m.snapshotFor(...args);
      return hooks.snapshot ? hooks.snapshot(s) : s;
    },
  };
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

/** Case 2: review, apply combo-1 (Park A 8 a.m.), confirm Park A space → v3 ready for approval. */
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
    await expect(
      svc.reportChange(event.id, { ...v, change: { kind: "other", description: "x" } }),
    ).rejects.toMatchObject({ code: "invalid_request" });
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
    await expect(svc.requestReview("evt-case-02", { version: 2 })).rejects.toMatchObject({ code: "stale_version" });
    const { event } = await svc.getEvent("evt-case-02");
    expect(cur(event).alternatives).toBeNull();

    hooks.review = (r) => (r.ok ? { ...r, review: { ...r.review, event_version: 1 } } : r);
    await expect(svc.requestReview("evt-case-02", { version: 2 })).rejects.toMatchObject({ code: "stale_version" });
  });

  it("rejects a result that finishes after the event changed, even within the same millisecond", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-28T12:00:00Z") });
    const { brief } = (await svc.getEvent("evt-case-02")).event;
    // Another request creates version 3 while the review of version 2 is still running.
    hooks.review = async (r) => {
      await svc.updateBrief("evt-case-02", { brief: { ...brief, group_size: 12 }, based_on_version: 2 });
      return r;
    };
    await expect(svc.requestReview("evt-case-02", { version: 2 })).rejects.toMatchObject({ code: "stale_version" });
    const { event } = await svc.getEvent("evt-case-02");
    expect(event.current_version).toBe(3);
    expect(ver(event, 2).alternatives).toBeNull();
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

  it("carries a confirmation to a later version at the same park and time", async () => {
    let { event } = await svc.requestReview("evt-case-02", { version: 2 });
    ({ event } = await svc.addConfirmation(event.id, {
      ...parkB,
      park_id: "park-a",
      start_time: "2026-07-16T08:00",
      statement: "Open lawn fits 18 people",
      version: 2,
    }));
    expect(cur(event).status).toBe("needs_verification"); // v2 (10 a.m.) still fails heat and space
    ({ event } = await svc.applyOption(event.id, { version: 2, combined_option_id: "combo-1" }));
    expect(cur(event).status).toBe("ready_for_approval");
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

  it("a brief edit retires confirmations made under the old brief", async () => {
    const event = await readyCase2();
    expect(event.confirmations).toHaveLength(1);
    const edited = await svc.updateBrief(event.id, { brief: { ...event.brief, group_size: 30 }, based_on_version: 3 });
    expect(edited.event.confirmations).toEqual([]);
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
