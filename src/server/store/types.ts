import type { EvidenceSnapshot, FieldDayEvent } from "@/contracts";

/**
 * Persistence interface (owner: JT, task JT-08). The in-memory store is used until a
 * hosted database is chosen; Vercel's filesystem does not persist between requests.
 */
export interface EventStore {
  listEvents(): Promise<FieldDayEvent[]>;
  getEvent(id: string): Promise<FieldDayEvent | null>;
  saveEvent(event: FieldDayEvent): Promise<void>;
  getSnapshot(id: string): Promise<EvidenceSnapshot | null>;
  saveSnapshot(snapshot: EvidenceSnapshot): Promise<void>;
}
