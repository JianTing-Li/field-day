import { z } from "zod";
import type { AdapterResult, ConditionsRequest, DataMode, EvidenceItem, FetchForecast } from "@/contracts";
import { fromLocalDateTime, toLocalDateTime } from "@/server/time";
import fixturePoints from "@fixtures/sources/nws/points-central-park.json";
import fixtureHourly from "@fixtures/sources/nws/forecast-hourly-okx-34-45.json";

/**
 * NWS forecast adapter (owner: Yadan, task YT-01). Port of weather.py.
 * Live: GET /points/{lat},{lon} -> follow the hourly-forecast URL, send the
 * NWS_USER_AGENT header. Fixture: read fixtures/sources/nws/.
 * Never throws on provider failure: return items plus explicit coverage gaps.
 */

const NWS_BASE = "https://api.weather.gov";
const TIMEOUT_MS = 10_000;

/** One HTTP response, live or recorded. Recorded fixtures use this same shape. */
export interface NwsResponse {
  url: string;
  status: number;
  retrieved_at: string;
  body: unknown;
}

/** Fetches one NWS URL. Throws only on network errors; HTTP errors come back as a status. */
export type NwsFetcher = (url: string) => Promise<NwsResponse>;

// Only the fields we use. Everything else in the response is ignored, and the
// free-text fields (shortForecast, detailedForecast) are never read.
const PointsBody = z.object({
  properties: z.object({
    gridId: z.string(),
    gridX: z.number(),
    gridY: z.number(),
    forecastHourly: z.url(),
  }),
});

const Period = z.object({
  startTime: z.string(),
  endTime: z.string(),
  temperature: z.number().nullable(),
  temperatureUnit: z.string(),
  probabilityOfPrecipitation: z.object({ unitCode: z.string(), value: z.number().nullable() }),
  windSpeed: z.string(),
});
type Period = z.infer<typeof Period>;

const HourlyBody = z.object({ properties: z.object({ periods: z.array(Period) }) });

export const fetchForecast: FetchForecast = (req, mode) =>
  fetchForecastWith(req, mode, mode === "live" ? liveFetcher() : fixtureFetcher);

/** The adapter with the HTTP layer passed in, so tests can feed it recorded responses. */
export async function fetchForecastWith(
  req: ConditionsRequest,
  mode: DataMode,
  fetcher: NwsFetcher | null,
): Promise<AdapterResult> {
  const fail = (reason: string): AdapterResult => ({
    origin: mode,
    items: [],
    coverage_gaps: [`NWS forecast for ${req.park_id} not available: ${reason}`],
  });
  if (!fetcher) return fail("NWS_USER_AGENT is not set, so live NWS requests are disabled");

  const lat = req.lat.toFixed(4);
  const lon = req.lon.toFixed(4);
  const points = await get(fetcher, `${NWS_BASE}/points/${lat},${lon}`, PointsBody);
  if ("error" in points) return fail(`points lookup ${points.error}`);
  const { gridId, gridX, gridY, forecastHourly } = points.body.properties;

  const hourly = await get(fetcher, forecastHourly, HourlyBody);
  if ("error" in hourly) return fail(`hourly forecast ${hourly.error}`);

  const eventStart = fromLocalDateTime(req.start_time).getTime();
  const eventEnd = fromLocalDateTime(req.end_time).getTime();
  const overlapping = hourly.body.properties.periods.filter(
    (p) => Date.parse(p.startTime) < eventEnd && Date.parse(p.endTime) > eventStart,
  );

  const grid = `${gridId}/${gridX},${gridY}`;
  const context: ItemContext = {
    req,
    mode,
    grid,
    url: forecastHourly,
    retrievedAt: hourly.response.retrieved_at,
  };
  return {
    origin: mode,
    items: overlapping.flatMap((p) => periodItems(p, context)),
    coverage_gaps: missingIntervals(overlapping, eventStart, eventEnd).map(
      ([from, to]) =>
        `NWS hourly forecast for ${req.park_id} (grid ${grid}) does not cover ` +
        `${toLocalDateTime(new Date(from))} to ${toLocalDateTime(new Date(to))}`,
    ),
  };
}

async function get<T>(
  fetcher: NwsFetcher,
  url: string,
  schema: z.ZodType<T>,
): Promise<{ response: NwsResponse; body: T } | { error: string }> {
  let response: NwsResponse;
  try {
    response = await fetcher(url);
  } catch {
    return { error: "failed (network error or timeout)" };
  }
  // Only the status code is reported; the provider's error text is never passed on.
  if (response.status !== 200) return { error: `failed with HTTP ${response.status}` };
  const parsed = schema.safeParse(response.body);
  if (!parsed.success) return { error: "returned a response in an unexpected format" };
  return { response, body: parsed.data };
}

interface ItemContext {
  req: ConditionsRequest;
  mode: DataMode;
  grid: string;
  url: string;
  retrievedAt: string;
}

/** One hourly period -> temperature, precipitation probability and wind speed evidence. */
function periodItems(p: Period, c: ItemContext): EvidenceItem[] {
  const validFrom = toLocalDateTime(p.startTime);
  const validTo = toLocalDateTime(p.endTime);
  const wind = parseWindSpeed(p.windSpeed);
  const limitations = ["NWS forecast for a ~2.5 km grid cell, not the exact park location"];
  if (c.mode === "fixture") {
    limitations.push(`Recorded NWS response from ${c.retrievedAt}, not a current forecast`);
  }

  const item = (
    metric: EvidenceItem["metric"],
    value: number | null,
    unit: string | null,
    missing: string,
    extra: string[] = [],
  ): EvidenceItem => ({
    // UTC start in the ID: on the fall-back night two periods share the same local start.
    id: `nws-${c.grid.replace(/[/,]/g, "-")}-${new Date(p.startTime).toISOString().slice(0, 16)}Z-${metric}`,
    metric,
    evidence_type: "forecast",
    origin: c.mode,
    source: { name: "NWS", url: c.url, record_id: c.grid },
    value,
    unit,
    category: null,
    pollutant: null,
    missing_reason: value === null ? missing : null,
    retrieved_at: c.retrievedAt,
    valid_from: validFrom,
    valid_to: validTo,
    applies_to: { scope: "forecast_grid", park_id: c.req.park_id, area_label: `NWS grid ${c.grid}` },
    freshness: { status: "unknown", assessed_at: null, note: "Freshness is assessed by the harness" },
    limitations: [...limitations, ...extra],
    confirms_check_id: null,
  });

  return [
    item("temperature", p.temperature, p.temperatureUnit, "NWS gave no temperature for this hour"),
    item(
      "precipitation_probability",
      p.probabilityOfPrecipitation.value,
      p.probabilityOfPrecipitation.unitCode.replace(/^wmoUnit:/, ""),
      "NWS gave no precipitation probability for this hour",
    ),
    item(
      "wind_speed",
      wind.value,
      wind.unit,
      "NWS wind speed could not be read as a number",
      wind.range ? ["NWS gave a wind speed range; the higher value is used"] : [],
    ),
  ];
}

/** "8 mph" -> 8 mph; "5 to 10 mph" -> 10 mph (the higher value, to stay on the safe side). */
export function parseWindSpeed(text: string): { value: number | null; unit: string | null; range: boolean } {
  const m = /^\s*(\d+(?:\.\d+)?)(?:\s+to\s+(\d+(?:\.\d+)?))?\s+([a-z/]+)\s*$/i.exec(text);
  if (!m) return { value: null, unit: null, range: false };
  return { value: Number(m[2] ?? m[1]), unit: m[3], range: m[2] !== undefined };
}

/** Parts of [start, end) that no period covers, as [from, to] millisecond pairs. */
function missingIntervals(periods: Period[], start: number, end: number): [number, number][] {
  const spans = periods
    .map((p) => [Date.parse(p.startTime), Date.parse(p.endTime)] as const)
    .sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = start;
  for (const [from, to] of spans) {
    if (from > cursor) gaps.push([cursor, Math.min(from, end)]);
    cursor = Math.max(cursor, to);
    if (cursor >= end) break;
  }
  if (cursor < end) gaps.push([cursor, end]);
  return gaps;
}

/** Live HTTP. Returns null when NWS_USER_AGENT is missing (NWS requires one). */
function liveFetcher(): NwsFetcher | null {
  const userAgent = process.env.NWS_USER_AGENT?.trim();
  if (!userAgent) return null;
  return async (url) => {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent, Accept: "application/geo+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON body: the schema check reports it as an unexpected format.
    }
    return { url, status: res.status, retrieved_at: new Date().toISOString(), body };
  };
}

/** Recorded responses. Fixture mode always answers with the Central Park recording. */
const fixtureFetcher: NwsFetcher = async (url) => {
  if (url.startsWith(`${NWS_BASE}/points/`)) return fixturePoints;
  if (url === fixtureHourly.url) return fixtureHourly;
  return { url, status: 404, retrieved_at: fixtureHourly.retrieved_at, body: null };
};
