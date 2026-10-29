import { neon } from "@neondatabase/serverless";
import { afterAll, describe, expect, it } from "vitest";
import { case01 } from "@fixtures/scenarios";
import type { FieldDayEvent } from "@/contracts";
import { neonStore } from "./neon";

/**
 * Runs the store against the real Neon database (owner: JT, task JT-15). Skipped unless RUN_DB=1,
 * so `npm test` never connects. Uses its own IDs and deletes its rows afterwards.
 *
 *   RUN_DB=1 npx vitest run src/server/store/neon.integration.test.ts
 */

const LIVE = process.env.RUN_DB === "1";
if (LIVE) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // DATABASE_URL may already be in the environment.
  }
}

const id = `evt-it-${crypto.randomUUID().slice(0, 8)}`;
const snapId = `snap-it-${id}`;

describe.skipIf(!LIVE)("Neon store against the real database", () => {
  afterAll(async () => {
    const sql = neon(process.env.DATABASE_URL!);
    await sql.query(`DELETE FROM finalized_events WHERE event_id = $1`, [id]);
    await sql.query(`DELETE FROM events WHERE id = $1`, [id]);
    await sql.query(`DELETE FROM snapshots WHERE id = $1`, [snapId]);
  });

  it("round-trips events, snapshots and finalized records with compare-and-swap and one record per version", async () => {
    const store = neonStore(process.env.DATABASE_URL!);
    const e: FieldDayEvent = {
      id,
      created_at: "2026-10-29T08:00:00.000Z",
      updated_at: "2026-10-29T08:00:00.000Z",
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
    };
    expect(await store.saveEvent(e, null)).toBe(true);
    expect(await store.saveEvent(e, null)).toBe(false);
    expect(await store.saveEvent({ ...e, updated_at: "2026-10-29T08:00:01.000Z" }, e.updated_at)).toBe(true);
    expect(await store.saveEvent({ ...e, updated_at: "2026-10-29T08:00:02.000Z" }, e.updated_at)).toBe(false);
    expect((await store.getEvent(id))?.updated_at).toBe("2026-10-29T08:00:01.000Z");

    const snapshot = { ...case01.snapshot(id, 2), id: snapId };
    await store.saveSnapshot(snapshot);
    await store.saveSnapshot(snapshot);
    expect((await store.getSnapshot(snapId))?.id).toBe(snapId);

    const record = { version: 2, evidence_snapshot_id: snapId, finalized_at: "2026-10-29T09:00:00.000Z", gate: [] };
    const results = await Promise.all([store.recordFinalized(id, record), store.recordFinalized(id, record)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.getFinalized(id, 2)).toEqual(record);
  });
});
