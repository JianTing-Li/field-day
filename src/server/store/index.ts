import { createMemoryStore } from "./memory";
import { neonStore } from "./neon";
import type { EventStore } from "./types";

const globalForStore = globalThis as unknown as { __fieldDayStore?: EventStore };

/**
 * One store per server process, kept across dev hot reloads (owner: JT, task JT-08). Neon when
 * DATABASE_URL is set (D-JT21-1); the in-memory store otherwise. Tests always get the in-memory
 * store, even with DATABASE_URL in the environment, so they never touch the database.
 */
export function getStore(): EventStore {
  globalForStore.__fieldDayStore ??=
    process.env.DATABASE_URL && !process.env.VITEST ? neonStore(process.env.DATABASE_URL) : createMemoryStore();
  return globalForStore.__fieldDayStore;
}

export type { EventStore } from "./types";
