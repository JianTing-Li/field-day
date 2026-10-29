import { describe, expect, it, vi } from "vitest";
import { case01 } from "@fixtures/scenarios";
import type { FieldDayEvent, FinalizedRecord } from "@/contracts";
import { createMemoryStore } from "./memory";
import { createNeonStore, isConnectionError, RETRY_DELAYS_MS, SCHEMA, withRetries, type Query } from "./neon";

const event = (updated_at = "2026-10-29T08:00:00.000Z"): FieldDayEvent => ({
  id: "evt-1",
  created_at: "2026-10-29T08:00:00.000Z",
  updated_at,
  brief: case01.brief,
  versions: [
    {
      version: 1,
      based_on_version: null,
      created_at: "2026-10-29T08:00:00.000Z",
      source: "brief",
      status: "draft",
      plan: null,
      evidence_snapshot_id: null,
      checks: null,
      facts: [],
      concerns: [],
      organizer_tasks: [],
      alternatives: null,
    },
  ],
  current_version: 1,
  approval: null,
  confirmations: [],
  finalized: null,
  last_run: null,
});

const record: FinalizedRecord = { version: 2, evidence_snapshot_id: "snap-1", finalized_at: "2026-10-29T09:00:00.000Z", gate: [] };

describe("memory store", () => {
  it("inserts a new event only once", async () => {
    const s = createMemoryStore();
    expect(await s.saveEvent(event(), null)).toBe(true);
    expect(await s.saveEvent(event(), null)).toBe(false);
  });

  it("saves only over the copy the caller loaded (compare-and-swap)", async () => {
    const s = createMemoryStore();
    await s.saveEvent(event("t1"), null);
    expect(await s.saveEvent(event("t2"), "t1")).toBe(true);
    expect(await s.saveEvent(event("t3"), "t1")).toBe(false);
    expect((await s.getEvent("evt-1"))?.updated_at).toBe("t2");
  });

  it("keeps one finalized record per event and version", async () => {
    const s = createMemoryStore();
    expect(await s.recordFinalized("evt-1", record)).toBe(true);
    expect(await s.recordFinalized("evt-1", { ...record, finalized_at: "2026-10-29T10:00:00.000Z" })).toBe(false);
    expect(await s.getFinalized("evt-1", 2)).toEqual(record);
    expect(await s.getFinalized("evt-1", 3)).toBeNull();
  });

  it("reset deletes everything", async () => {
    const s = createMemoryStore();
    await s.saveEvent(event(), null);
    await s.recordFinalized("evt-1", record);
    await s.reset();
    expect(await s.listEvents()).toEqual([]);
    expect(await s.getFinalized("evt-1", 2)).toBeNull();
  });
});

/** A fake query function: records every call and answers with `rows(text)`. */
function fakeQuery(rows: (text: string, params?: unknown[]) => Record<string, unknown>[] = () => []) {
  const calls: { text: string; params?: unknown[] }[] = [];
  const query: Query = async (text, params) => {
    calls.push({ text, params });
    return rows(text, params);
  };
  return { calls, query };
}

describe("Neon store (JT-08)", () => {
  it("creates the tables once, before the first query", async () => {
    const f = fakeQuery();
    const s = createNeonStore(f.query);
    await s.listEvents();
    await s.listEvents();
    expect(f.calls.slice(0, SCHEMA.length).map((c) => c.text)).toEqual(SCHEMA);
    expect(f.calls.filter((c) => c.text.startsWith("CREATE"))).toHaveLength(SCHEMA.length);
    expect(SCHEMA.join(" ")).toMatch(/PRIMARY KEY \(event_id, version\)/);
  });

  it("inserts new events with ON CONFLICT DO NOTHING and reports whether a row was written", async () => {
    const f = fakeQuery((t) => (t.startsWith("INSERT INTO events") ? [] : []));
    const s = createNeonStore(f.query);
    expect(await s.saveEvent(event(), null)).toBe(false);
    const insert = f.calls.find((c) => c.text.startsWith("INSERT INTO events"))!;
    expect(insert.text).toContain("ON CONFLICT (id) DO NOTHING");
  });

  it("updates an event only when updated_at still matches", async () => {
    const f = fakeQuery((t) => (t.startsWith("UPDATE events") ? [{ id: "evt-1" }] : []));
    const s = createNeonStore(f.query);
    expect(await s.saveEvent(event("t2"), "t1")).toBe(true);
    const update = f.calls.find((c) => c.text.startsWith("UPDATE events"))!;
    expect(update.text).toContain("WHERE id = $1 AND updated_at = $4");
    expect(update.params).toEqual(["evt-1", "t2", JSON.stringify(event("t2")), "t1"]);
  });

  it("validates rows it reads and returns null for missing ones", async () => {
    const f = fakeQuery((t) => (t.startsWith("SELECT data FROM events WHERE") ? [{ data: event() }] : []));
    const s = createNeonStore(f.query);
    expect((await s.getEvent("evt-1"))?.id).toBe("evt-1");
    expect(await s.getSnapshot("snap-x")).toBeNull();
    await expect(createNeonStore(fakeQuery(() => [{ data: { id: 1 } }]).query).listEvents()).rejects.toThrow();
  });

  it("records a finalized version once, keyed by event and version", async () => {
    let inserted = false;
    const f = fakeQuery((t) => {
      if (!t.startsWith("INSERT INTO finalized_events")) return [];
      if (inserted) return [];
      inserted = true;
      return [{ event_id: "evt-1" }];
    });
    const s = createNeonStore(f.query);
    expect(await s.recordFinalized("evt-1", record)).toBe(true);
    expect(await s.recordFinalized("evt-1", record)).toBe(false);
    expect(f.calls.find((c) => c.text.startsWith("INSERT INTO finalized_events"))!.text).toContain(
      "ON CONFLICT (event_id, version) DO NOTHING",
    );
  });

  it("tries creating the tables again after a failure", async () => {
    let fail = true;
    const query: Query = async (text) => {
      if (text.startsWith("CREATE") && fail) {
        fail = false;
        throw new Error("fetch failed");
      }
      return [];
    };
    const s = createNeonStore(query);
    await expect(s.listEvents()).rejects.toThrow("fetch failed");
    await expect(s.listEvents()).resolves.toEqual([]);
  });
});

describe("withRetries", () => {
  it("retries connection errors with backoff, then gives up", async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const flaky: Query = async () => {
      n++;
      if (n < 3) throw new TypeError("fetch failed");
      return [{ ok: 1 }];
    };
    expect(await withRetries(flaky, sleep)("SELECT 1")).toEqual([{ ok: 1 }]);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual(RETRY_DELAYS_MS.slice(0, 2));

    const down: Query = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(withRetries(down, sleep)("SELECT 1")).rejects.toThrow("fetch failed");
  });

  it("never retries a Postgres error", async () => {
    const sleep = vi.fn(async () => {});
    const pgError = Object.assign(new Error('relation "x" does not exist'), { code: "42P01" });
    const bad: Query = async () => {
      throw pgError;
    };
    await expect(withRetries(bad, sleep)("SELECT 1")).rejects.toBe(pgError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("recognizes connection errors", () => {
    expect(isConnectionError(new TypeError("fetch failed"))).toBe(true);
    expect(isConnectionError(new Error("Server error (HTTP status 503)"))).toBe(true);
    expect(isConnectionError(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
    expect(isConnectionError("nope")).toBe(false);
  });
});
