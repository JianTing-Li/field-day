import type { EventBrief, EvidenceSnapshot } from "@/contracts";

/**
 * Evidence snapshot builder (owner: JT, task JT-03). Gathers parks, conditions and
 * templates for one event version, assesses freshness and coverage, and records gaps.
 * Until this exists the lifecycle service uses fixture snapshots.
 */
export async function buildSnapshot(args: {
  event_id: string;
  event_version: number;
  brief: EventBrief;
}): Promise<EvidenceSnapshot> {
  throw new Error(`buildSnapshot not implemented yet (JT-03): ${args.event_id} v${args.event_version}`);
}
