import type { EvidenceSnapshot, FieldDayEvent, FinalizedRecord } from "@/contracts";

/**
 * Persistence interface (owner: JT, task JT-08). Neon Postgres when DATABASE_URL is set
 * (D-JT21-1), otherwise the in-memory store (tests and local runs).
 */
export interface EventStore {
  listEvents(): Promise<FieldDayEvent[]>;
  getEvent(id: string): Promise<FieldDayEvent | null>;
  /**
   * Saves the event only if the stored copy is unchanged since the caller loaded it: its
   * `updated_at` must equal `expectedUpdatedAt`. With null, saves only if no event has this ID.
   * Returns false, writing nothing, when that condition fails (a compare-and-swap).
   */
  saveEvent(event: FieldDayEvent, expectedUpdatedAt: string | null): Promise<boolean>;
  getSnapshot(id: string): Promise<EvidenceSnapshot | null>;
  saveSnapshot(snapshot: EvidenceSnapshot): Promise<void>;
  /**
   * Records the finalized version of an event. At most one record per event and version:
   * a second call for the same pair writes nothing and returns false.
   */
  recordFinalized(eventId: string, record: FinalizedRecord): Promise<boolean>;
  /** The finalized record for this event and version, if one was saved. */
  getFinalized(eventId: string, version: number): Promise<FinalizedRecord | null>;
  /** Deletes every event, snapshot and finalized record. Only the reset script and tests call this. */
  reset(): Promise<void>;
}
