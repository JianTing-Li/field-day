import type { EvidenceSnapshot, FieldDayEvent } from "@/contracts";
import type { EventStore } from "./types";

/** In-memory store. Data is lost on server restart; not suitable for the deployed demo. */
export function createMemoryStore(): EventStore {
  const events = new Map<string, FieldDayEvent>();
  const snapshots = new Map<string, EvidenceSnapshot>();
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    listEvents: async () => [...events.values()].map(clone),
    getEvent: async (id) => (events.has(id) ? clone(events.get(id)!) : null),
    saveEvent: async (e) => void events.set(e.id, clone(e)),
    getSnapshot: async (id) => (snapshots.has(id) ? clone(snapshots.get(id)!) : null),
    saveSnapshot: async (s) => void snapshots.set(s.id, clone(s)),
  };
}

const globalForStore = globalThis as unknown as { __fieldDayStore?: EventStore };

/** One store per server process, kept across dev hot reloads. */
export function getStore(): EventStore {
  globalForStore.__fieldDayStore ??= createMemoryStore();
  return globalForStore.__fieldDayStore;
}
