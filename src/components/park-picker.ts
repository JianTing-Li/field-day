import zips from "./nyc-zip-centroids.json";

/**
 * Park picker logic (JT-24, D-JT24-13): search the curated list by name or borough, narrow by
 * borough, and sort by distance from a zip code or the organizer's location. Distances are worked
 * out here from coordinates we already store; nothing is looked up online.
 */

/** Parks one event may consider. Each one adds forecasts and plans for the agents to weigh. */
export const MAX_PARKS = 5;

export interface PickerPark {
  id: string;
  name: string;
  borough: string;
  location: { lat: number; lon: number } | null;
}

export type Point = { lat: number; lon: number };

/** The centre of an NYC zip code (from NYC Open Data's MODZCTA areas), or null if it isn't one. */
export function zipCentre(zip: string): Point | null {
  const hit = (zips as Record<string, number[]>)[zip.trim()];
  return hit ? { lat: hit[0], lon: hit[1] } : null;
}

/** Straight-line distance in miles. */
export function milesBetween(a: Point, b: Point): number {
  const r = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Parks matching the search and borough, nearest first when there's an origin, else by borough and name. */
export function findParks(
  parks: PickerPark[],
  { query = "", borough = null, origin = null }: { query?: string; borough?: string | null; origin?: Point | null },
): (PickerPark & { miles: number | null })[] {
  const q = query.trim().toLowerCase();
  return parks
    .filter((p) => (!borough || p.borough === borough) && (!q || `${p.name} ${p.borough}`.toLowerCase().includes(q)))
    .map((p) => ({ ...p, miles: origin && p.location ? milesBetween(origin, p.location) : null }))
    .sort((a, b) =>
      a.miles !== null && b.miles !== null
        ? a.miles - b.miles
        : a.borough.localeCompare(b.borough) || a.name.localeCompare(b.name),
    );
}
