import { z } from "zod";
import type { AdapterResult, ConditionsRequest, DataMode, EvidenceItem, FetchAirQuality } from "@/contracts";
import { toLocalDateTime } from "@/server/time";
import fixtureForecast from "@fixtures/sources/airnow/forecast-central-park.json";
import fixtureObservation from "@fixtures/sources/airnow/observation-central-park.json";

/**
 * AirNow adapter (owner: Yadan, task YT-02). AIRNOW_API_KEY stays server-side.
 * Reporting-area values are regional, and observations never stand in for a future forecast.
 * Fixture: read fixtures/sources/airnow/.
 *
 * Uses the web services AirNow released in June 2026. The older /aq/forecast/latLong/ and
 * /aq/observation/latLong/current/ services were retired on 2026-10-01 and return HTTP 410.
 */

const AIRNOW_BASE = "https://www.airnowapi.org";
const FORECAST_PATH = "/aq/forecast/current/";
const OBSERVATION_PATH = "/aq/observation/current/ziplatlong/";
const TIMEOUT_MS = 10_000;
const REGIONAL = "Regional reporting-area value, not a park-level measurement";

/** One HTTP response, live or recorded. `url` never contains the API key. */
export interface AirNowResponse {
  url: string;
  status: number;
  retrieved_at: string;
  body: unknown;
}

/** Fetches one AirNow URL (without the key). Throws only on network errors. */
export type AirNowFetcher = (url: string) => Promise<AirNowResponse>;

// Only the fields we use. The forecast "discussion" text is never read.
const ForecastRow = z.object({
  dateValid: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reportingArea: z.string(),
  reportingAreaCode: z.string(),
  parameterName: z.string(),
  aqi: z.number().nullable(),
  categoryName: z.string().nullable(),
});
type ForecastRow = z.infer<typeof ForecastRow>;

const ObservationRow = z.object({
  dateObserved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hourObserved: z.string().regex(/^\d{2}:\d{2}$/),
  localTimeZone: z.string(),
  reportingAreaName: z.string(),
  siteID: z.union([z.string(), z.number()]),
  parameterName: z.string(),
  nowcastAQI: z.number().nullable(),
  aqiCategoryName: z.string().nullable(),
});
type ObservationRow = z.infer<typeof ObservationRow>;

/** AirNow reports some errors as HTTP 200 with this body (e.g. no reporting area nearby). */
const WebServiceError = z.object({ WebServiceError: z.array(z.unknown()) });

/** US time zone abbreviations AirNow uses for observation hours. */
const UTC_OFFSETS: Record<string, string> = {
  EST: "-05:00",
  EDT: "-04:00",
  CST: "-06:00",
  CDT: "-05:00",
  MST: "-07:00",
  MDT: "-06:00",
  PST: "-08:00",
  PDT: "-07:00",
};

export const fetchAirQuality: FetchAirQuality = (req, mode) =>
  fetchAirQualityWith(req, mode, mode === "live" ? liveFetcher() : fixtureFetcher);

/** The adapter with the HTTP layer passed in, so tests can feed it recorded responses. */
export async function fetchAirQualityWith(
  req: ConditionsRequest,
  mode: DataMode,
  fetcher: AirNowFetcher | null,
): Promise<AdapterResult> {
  const gap = (reason: string) => `AirNow data for ${req.park_id} not available: ${reason}`;
  if (!fetcher) {
    return {
      origin: mode,
      items: [],
      coverage_gaps: [gap("AIRNOW_API_KEY is not set, so live AirNow requests are disabled")],
    };
  }

  const query = `?format=application/json&latitude=${req.lat.toFixed(4)}&longitude=${req.lon.toFixed(4)}`;
  const [forecast, observation] = await Promise.all([
    get(fetcher, `${AIRNOW_BASE}${FORECAST_PATH}${query}`, ForecastRow),
    get(fetcher, `${AIRNOW_BASE}${OBSERVATION_PATH}${query}`, ObservationRow),
  ]);

  const items: EvidenceItem[] = [];
  const coverage_gaps: string[] = [];

  // Forecasts: one per pollutant per day. Every event day needs at least one.
  if ("error" in forecast) {
    coverage_gaps.push(gap(`forecast request ${forecast.error}`));
  } else {
    const days = eventDays(req);
    const used = forecast.rows.filter((r) => days.includes(r.dateValid));
    items.push(...used.map((r) => forecastItem(r, req, mode, forecast.response)));
    for (const day of days) {
      if (!used.some((r) => r.dateValid === day)) {
        coverage_gaps.push(`AirNow has no forecast for ${req.park_id} on ${day}`);
      }
    }
  }

  // Observations: only for the hour they measured, and only if that hour is part of the event.
  // A current reading is never used for a future event.
  if ("error" in observation) {
    coverage_gaps.push(gap(`observation request ${observation.error}`));
  } else {
    for (const r of observation.rows) {
      const period = observedPeriod(r);
      if (!period) {
        coverage_gaps.push(gap("an observation's time zone was not recognized"));
      } else if (period.from < req.end_time && period.to > req.start_time) {
        items.push(observationItem(r, period, req, mode, observation.response));
      }
    }
  }

  return { origin: mode, items, coverage_gaps };
}

async function get<T>(
  fetcher: AirNowFetcher,
  url: string,
  row: z.ZodType<T>,
): Promise<{ response: AirNowResponse; rows: T[] } | { error: string }> {
  let response: AirNowResponse;
  try {
    response = await fetcher(url);
  } catch {
    return { error: "failed (network error or timeout)" };
  }
  // Only the status code is reported; the provider's error text is never passed on.
  if (response.status !== 200) return { error: `failed with HTTP ${response.status}` };
  if (WebServiceError.safeParse(response.body).success) return { error: "returned an error message" };
  const parsed = z.array(row).safeParse(response.body);
  if (!parsed.success) return { error: "returned a response in an unexpected format" };
  return { response, rows: parsed.data };
}

/** Event-local dates the event touches, e.g. ["2026-10-28"]. An end at exactly midnight is not a new day. */
function eventDays(req: ConditionsRequest): string[] {
  const days: string[] = [];
  const endDate = req.end_time.slice(0, 10);
  const last = req.end_time.endsWith("T00:00") && endDate > req.start_time.slice(0, 10) ? addDays(endDate, -1) : endDate;
  for (let d = req.start_time.slice(0, 10); d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** "15:00 EDT" marks the end of the hour measured, so the value covers 14:00 to 15:00. */
function observedPeriod(r: ObservationRow): { from: string; to: string } | null {
  const offset = UTC_OFFSETS[r.localTimeZone.toUpperCase()];
  if (!offset) return null;
  const end = new Date(`${r.dateObserved}T${r.hourObserved}:00${offset}`);
  if (Number.isNaN(end.getTime())) return null;
  return { from: toLocalDateTime(new Date(end.getTime() - 3_600_000)), to: toLocalDateTime(end) };
}

function forecastItem(r: ForecastRow, req: ConditionsRequest, mode: DataMode, res: AirNowResponse): EvidenceItem {
  // AirNow uses -1 when the agency issued only a category, not a number.
  const value = r.aqi !== null && r.aqi >= 0 ? r.aqi : null;
  return baseItem(req, mode, res, {
    id: `airnow-forecast-${r.reportingAreaCode}-${r.dateValid}-${slug(r.parameterName)}`,
    evidence_type: "forecast",
    value,
    category: r.categoryName,
    pollutant: r.parameterName,
    missing_reason: value === null ? "AirNow forecast gave a category only, no AQI number" : null,
    valid_from: `${r.dateValid}T00:00`,
    valid_to: `${addDays(r.dateValid, 1)}T00:00`,
    area_label: r.reportingArea,
    record_id: r.reportingAreaCode,
    extra: ["Daily forecast: one value for the whole day, not hour by hour"],
  });
}

function observationItem(
  r: ObservationRow,
  period: { from: string; to: string },
  req: ConditionsRequest,
  mode: DataMode,
  res: AirNowResponse,
): EvidenceItem {
  const value = r.nowcastAQI !== null && r.nowcastAQI >= 0 ? r.nowcastAQI : null;
  return baseItem(req, mode, res, {
    id: `airnow-observation-${r.siteID}-${period.from}-${slug(r.parameterName)}`,
    evidence_type: "observation",
    value,
    category: r.aqiCategoryName,
    pollutant: r.parameterName,
    missing_reason: value === null ? "AirNow observation gave no AQI number" : null,
    valid_from: period.from,
    valid_to: period.to,
    area_label: r.reportingAreaName,
    record_id: String(r.siteID),
    extra: ["NowCast AQI from the nearest monitor for this pollutant"],
  });
}

function baseItem(
  req: ConditionsRequest,
  mode: DataMode,
  res: AirNowResponse,
  f: {
    id: string;
    evidence_type: "forecast" | "observation";
    value: number | null;
    category: string | null;
    pollutant: string;
    missing_reason: string | null;
    valid_from: string;
    valid_to: string;
    area_label: string;
    record_id: string;
    extra: string[];
  },
): EvidenceItem {
  const limitations = [REGIONAL, ...f.extra];
  if (mode === "fixture") limitations.push(`Recorded AirNow response from ${res.retrieved_at}, not current data`);
  return {
    id: f.id,
    metric: "aqi",
    evidence_type: f.evidence_type,
    origin: mode,
    source: { name: "AirNow", url: res.url, record_id: f.record_id },
    value: f.value,
    unit: "AQI",
    category: f.category,
    pollutant: f.pollutant,
    missing_reason: f.missing_reason,
    retrieved_at: res.retrieved_at,
    valid_from: f.valid_from,
    valid_to: f.valid_to,
    applies_to: { scope: "reporting_area", park_id: req.park_id, area_label: f.area_label },
    freshness: { status: "unknown", assessed_at: null, note: "Freshness is assessed by the harness" },
    limitations,
    confirms_check_id: null,
  };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Live HTTP. The key is added here and nowhere else, so it never ends up in evidence or logs. */
function liveFetcher(): AirNowFetcher | null {
  const key = process.env.AIRNOW_API_KEY?.trim();
  if (!key) return null;
  return async (url) => {
    const res = await fetch(`${url}&api_key=${encodeURIComponent(key)}`, {
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

/** Fixture mode always answers with the recorded Central Park responses (retrieved 2026-10-27). */
const fixtureFetcher: AirNowFetcher = async (url) => {
  if (url.startsWith(`${AIRNOW_BASE}${FORECAST_PATH}`)) return fixtureForecast;
  if (url.startsWith(`${AIRNOW_BASE}${OBSERVATION_PATH}`)) return fixtureObservation;
  return { url, status: 404, retrieved_at: fixtureForecast.retrieved_at, body: null };
};
