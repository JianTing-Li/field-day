import type { EvidenceSnapshot, FieldDayEvent, FinalizedRecord } from "@/contracts";
import type { EventStore } from "./types";

/** In-memory store. Data is lost on server restart; used by tests and local runs without DATABASE_URL. */
export function createMemoryStore(): EventStore {
  const events = new Map<string, FieldDayEvent>();
  const snapshots = new Map<string, EvidenceSnapshot>();
  const finalized = new Map<string, FinalizedRecord>();
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    listEvents: async () => [...events.values()].map(clone),
    getEvent: async (id) => (events.has(id) ? clone(events.get(id)!) : null),
    saveEvent: async (e, expected) => {
      const stored = events.get(e.id);
      if (expected === null ? stored !== undefined : stored?.updated_at !== expected) return false;
      events.set(e.id, clone(e));
      return true;
    },
    getSnapshot: async (id) => (snapshots.has(id) ? clone(snapshots.get(id)!) : null),
    saveSnapshot: async (s) => void snapshots.set(s.id, clone(s)),
    recordFinalized: async (eventId, record) => {
      const key = `${eventId}|${record.version}`;
      if (finalized.has(key)) return false;
      finalized.set(key, clone(record));
      return true;
    },
    getFinalized: async (eventId, version) => clone(finalized.get(`${eventId}|${version}`) ?? null),
    reset: async () => {
      events.clear();
      snapshots.clear();
      finalized.clear();
    },
  };
}
