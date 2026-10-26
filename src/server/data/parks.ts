import type { ParkCandidate } from "@/contracts";
import parks from "@/server/content/parks.json";

/**
 * NYC Parks adapter (owner: JT, task JT-11). Reads the curated candidate list;
 * live mode checks records against the NYC Open Data Parks Properties dataset.
 *
 * PLACEHOLDER: returns the placeholder parks from content/parks.json.
 */
export async function getCuratedParks(): Promise<ParkCandidate[]> {
  return parks as ParkCandidate[];
}
