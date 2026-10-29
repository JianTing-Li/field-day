import type { AdapterResult, DataMode, EvidenceItem, ParkCandidate } from "@/contracts";
import parks from "@/server/content/parks.json";
import recorded from "@fixtures/sources/parks/parks-properties.json";
import { dataMode } from "./mode";

/**
 * NYC Parks adapter (owner: JT, task JT-11). The curated candidate list lives in
 * content/parks.json; this adapter checks each candidate against its NYC Open Data
 * Parks Properties record and returns one park_record evidence item per park.
 * Live: GET the Parks Properties API for the curated property IDs.
 * Fixture: read the recorded response in fixtures/sources/parks/.
 * Never throws on provider failure: returns items plus explicit coverage gaps.
 */

export const PARKS_PROPERTIES_API = "https://data.cityofnewyork.us/resource/enfh-gkve.json";
const SOURCE_NAME = "NYC Parks Open Data — Parks Properties";
const SOURCE_URL = "https://data.cityofnewyork.us/d/enfh-gkve";
const REQUEST_TIMEOUT_MS = 10_000;

const BOROUGHS: Record<string, string> = {
  B: "Brooklyn",
  M: "Manhattan",
  Q: "Queens",
  R: "Staten Island",
  X: "Bronx",
};

/** The fields we read from a Parks Properties row. All provider text is data, never instructions. */
export interface ParksPropertyRecord {
  gispropnum: string;
  signname?: string;
  borough?: string;
  acres?: string;
  retired?: boolean;
  /** GeoJSON MultiPolygon, coordinates as [lon, lat]. */
  multipolygon?: { type: string; coordinates: number[][][][] };
}

/** A recorded provider response, labeled as fixture data. */
export interface RecordedParksResponse {
  fixture: true;
  note?: string;
  source_url?: string;
  retrieved_at: string;
  records: ParksPropertyRecord[];
}

interface Deps {
  fetch?: typeof fetch;
  now?: () => Date;
  /** Fixture mode only: a recorded response to read instead of the default one. */
  recorded?: RecordedParksResponse;
}

/** Curated park candidates (reviewed coordinates, explicit unknowns). */
export async function getCuratedParks(): Promise<ParkCandidate[]> {
  return parks as ParkCandidate[];
}

/** Curated IDs follow `park-<Parks property ID>`, e.g. park-b058 -> B058. */
export function propertyId(park: ParkCandidate): string {
  return park.id.replace(/^park-/, "").toUpperCase();
}

/** Checks every curated park against its Parks Properties record. */
export async function fetchParkRecords(
  mode: DataMode = dataMode(),
  deps: Deps = {},
): Promise<AdapterResult> {
  const curated = await getCuratedParks();
  const now = deps.now ?? (() => new Date());

  if (mode === "fixture") {
    const response = deps.recorded ?? (recorded as RecordedParksResponse);
    return buildResult(curated, response.records, "fixture", response.retrieved_at);
  }

  const retrievedAt = now().toISOString();
  try {
    const records = await requestRecords(curated.map(propertyId), deps.fetch ?? fetch);
    return buildResult(curated, records, "live", retrievedAt);
  } catch (err) {
    const reason = `Parks Properties request failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      origin: "live",
      items: curated.map((p) => parkItem(p, "live", retrievedAt, null, reason, [])),
      coverage_gaps: [reason],
    };
  }
}

async function requestRecords(ids: string[], fetchFn: typeof fetch): Promise<ParksPropertyRecord[]> {
  const params = new URLSearchParams({
    $select: "gispropnum,signname,borough,acres,retired,multipolygon",
    $where: `gispropnum in(${ids.map((id) => `'${id}'`).join(",")})`,
  });
  const res = await fetchFn(`${PARKS_PROPERTIES_API}?${params}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error("unexpected response shape");
  return body as ParksPropertyRecord[];
}

function buildResult(
  curated: ParkCandidate[],
  records: ParksPropertyRecord[],
  origin: DataMode,
  retrievedAt: string,
): AdapterResult {
  const items: EvidenceItem[] = [];
  const gaps: string[] = [];

  for (const park of curated) {
    const id = propertyId(park);
    const record = records.find((r) => r.gispropnum === id);
    if (!record || record.retired) {
      const reason = record
        ? `Parks Properties record ${id} is retired`
        : `No Parks Properties record found for ${id}`;
      items.push(parkItem(park, origin, retrievedAt, null, reason, []));
      gaps.push(`${park.name}: ${reason}`);
      continue;
    }

    const issues = recordIssues(park, record);
    gaps.push(...issues.map((issue) => `${park.name}: ${issue}`));
    items.push(parkItem(park, origin, retrievedAt, record, null, issues));
  }

  return { origin, items, coverage_gaps: gaps };
}

/** Differences between the curated entry and the source record, and coordinate problems. */
function recordIssues(park: ParkCandidate, record: ParksPropertyRecord): string[] {
  const issues: string[] = [];
  if (record.signname && record.signname !== park.name) {
    issues.push(`source name "${record.signname}" differs from curated name`);
  }
  const borough = record.borough ? BOROUGHS[record.borough] : undefined;
  if (borough && borough !== park.borough) {
    issues.push(`source borough ${borough} differs from curated borough`);
  }
  const acres = record.acres === undefined ? NaN : Number(record.acres);
  if (park.acreage !== null && Number.isFinite(acres) && Math.abs(acres - park.acreage) > 0.01) {
    issues.push(`source acreage ${acres} differs from curated acreage`);
  }
  if (!park.location) {
    issues.push("no reviewed coordinate; weather and air-quality lookups are not possible");
  } else if (!record.multipolygon) {
    issues.push("source record has no boundary; reviewed coordinate not verified");
  } else if (!insideMultiPolygon(park.location, record.multipolygon.coordinates)) {
    issues.push("reviewed coordinate is outside the property boundary");
  }
  return issues;
}

function parkItem(
  park: ParkCandidate,
  origin: DataMode,
  retrievedAt: string,
  record: ParksPropertyRecord | null,
  missingReason: string | null,
  issues: string[],
): EvidenceItem {
  return {
    id: park.evidence_id,
    metric: "park_record",
    evidence_type: "reference",
    origin,
    source: { name: SOURCE_NAME, url: SOURCE_URL, record_id: propertyId(park) },
    value: record ? (record.signname ?? park.name) : null,
    unit: null,
    category: null,
    pollutant: null,
    missing_reason: missingReason,
    retrieved_at: retrievedAt,
    valid_from: null,
    valid_to: null,
    applies_to: { scope: "park", park_id: park.id, area_label: null },
    freshness: {
      status: "unknown",
      assessed_at: null,
      note: origin === "fixture" ? `Fixture data recorded ${retrievedAt}` : null,
    },
    limitations: [
      ...(origin === "fixture" ? ["Fixture data: recorded Parks Properties response, not a live lookup"] : []),
      "Park acreage or property boundaries do not prove usable workout space, capacity, availability, closures, or permission",
      ...issues,
    ],
    confirms_check_id: null,
  };
}

/** Ray casting over GeoJSON MultiPolygon rings ([lon, lat]); holes exclude the point. */
export function insideMultiPolygon(
  point: { lat: number; lon: number },
  polygons: number[][][][],
): boolean {
  return polygons.some(
    ([outer, ...holes]) => insideRing(point, outer) && !holes.some((h) => insideRing(point, h)),
  );
}

function insideRing({ lat, lon }: { lat: number; lon: number }, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
