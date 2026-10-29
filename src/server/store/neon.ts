import { neon } from "@neondatabase/serverless";
import { EvidenceSnapshot, FieldDayEvent, FinalizedRecord } from "@/contracts";
import type { EventStore } from "./types";

/**
 * Neon Postgres store (owner: JT, task JT-08, D-JT21-1, D-JT08-1). Each event, snapshot and
 * finalized record is one JSONB row. Writes to an event are a compare-and-swap on `updated_at`,
 * and finalized records have a primary key on (event_id, version), so the database itself
 * rejects a second finalized record for the same approved version.
 */

/** Runs one parameterized query and returns its rows. Injected in tests. */
export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, updated_at text NOT NULL, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS snapshots (id text PRIMARY KEY, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS finalized_events (
     event_id text NOT NULL, version integer NOT NULL, idempotency_key text, data jsonb NOT NULL,
     PRIMARY KEY (event_id, version))`,
];

/** Waits between retries of a connection error; Neon's free plan wakes up from sleep on the first request. */
export const RETRY_DELAYS_MS = [250, 750, 2000];

/**
 * True for errors worth retrying: the request never reached Postgres (network or wake-up).
 * A Postgres error has a SQLSTATE `code` and is never retried.
 */
export function isConnectionError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (typeof (e as { code?: unknown }).code === "string") return false;
  return /fetch|network|socket|ECONN|ETIMEDOUT|timeout|terminated|503|502/i.test(`${e.name} ${e.message}`);
}

export function withRetries(query: Query, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Query {
  return async (text, params) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await query(text, params);
      } catch (e) {
        if (attempt >= RETRY_DELAYS_MS.length || !isConnectionError(e)) throw e;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  };
}

export function createNeonStore(query: Query): EventStore {
  let ready: Promise<void> | null = null;
  const q: Query = async (text, params) => {
    ready ??= (async () => {
      for (const ddl of SCHEMA) await query(ddl);
    })().catch((e) => {
      ready = null;
      throw e;
    });
    await ready;
    return query(text, params);
  };
  const json = (v: unknown) => JSON.stringify(v);

  return {
    listEvents: async () => (await q(`SELECT data FROM events`)).map((r) => FieldDayEvent.parse(r.data)),
    getEvent: async (id) => {
      const rows = await q(`SELECT data FROM events WHERE id = $1`, [id]);
      return rows[0] ? FieldDayEvent.parse(rows[0].data) : null;
    },
    saveEvent: async (e, expected) => {
      const rows =
        expected === null
          ? await q(
              `INSERT INTO events (id, updated_at, data) VALUES ($1, $2, $3::jsonb)
               ON CONFLICT (id) DO NOTHING RETURNING id`,
              [e.id, e.updated_at, json(e)],
            )
          : await q(
              `UPDATE events SET updated_at = $2, data = $3::jsonb WHERE id = $1 AND updated_at = $4 RETURNING id`,
              [e.id, e.updated_at, json(e), expected],
            );
      return rows.length === 1;
    },
    getSnapshot: async (id) => {
      const rows = await q(`SELECT data FROM snapshots WHERE id = $1`, [id]);
      return rows[0] ? EvidenceSnapshot.parse(rows[0].data) : null;
    },
    saveSnapshot: async (s) => {
      await q(`INSERT INTO snapshots (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING`, [s.id, json(s)]);
    },
    recordFinalized: async (eventId, record) => {
      const rows = await q(
        `INSERT INTO finalized_events (event_id, version, idempotency_key, data) VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (event_id, version) DO NOTHING RETURNING event_id`,
        [eventId, record.version, record.idempotency_key ?? null, json(record)],
      );
      return rows.length === 1;
    },
    getFinalized: async (eventId, version) => {
      const rows = await q(`SELECT data FROM finalized_events WHERE event_id = $1 AND version = $2`, [eventId, version]);
      return rows[0] ? FinalizedRecord.parse(rows[0].data) : null;
    },
    reset: async () => {
      await q(`TRUNCATE events, snapshots, finalized_events`);
    },
  };
}

/** The Neon store for a connection string, with retries for connection errors. */
export function neonStore(databaseUrl: string): EventStore {
  const sql = neon(databaseUrl);
  return createNeonStore(withRetries((text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>));
}
