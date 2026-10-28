import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidenceItem, type ConditionsRequest } from "@/contracts";
import forecast from "@fixtures/sources/airnow/forecast-central-park.json";
import observation from "@fixtures/sources/airnow/observation-central-park.json";
import retired from "@fixtures/sources/airnow/error-retired-410.json";
import invalidKey from "@fixtures/sources/airnow/error-invalid-key.json";
import noArea from "@fixtures/sources/airnow/error-no-reporting-area-200.json";
import { fetchAirQuality, fetchAirQualityWith, type AirNowFetcher } from "./air";

// Recorded 2026-10-27 15:22 EDT for Central Park: PM2.5 forecasts for 10-27 (AQI 50, Good) and
// 10-28 (AQI 51, Moderate); observations for the hour ending 15:00 EDT (PM2.5 19, ozone 26).
const req = (start_time: string, end_time: string): ConditionsRequest => ({
  park_id: "park-a",
  lat: 40.7812,
  lon: -73.9665,
  start_time,
  end_time,
});

const FORECAST = "https://www.airnowapi.org/aq/forecast/current/";
const OBSERVATION = "https://www.airnowapi.org/aq/observation/current/ziplatlong/";

/** Answers from the recordings, with optional overrides by URL prefix. */
function recorded(overrides: Record<string, () => unknown> = {}): AirNowFetcher {
  return async (url) => {
    for (const [prefix, answer] of Object.entries(overrides)) {
      if (url.startsWith(prefix)) return answer() as never;
    }
    if (url.startsWith(FORECAST)) return forecast;
    if (url.startsWith(OBSERVATION)) return observation;
    throw new Error(`unexpected URL ${url}`);
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchAirQuality (fixture mode)", () => {
  it("uses only the forecast for a future event", async () => {
    const result = await fetchAirQuality(req("2026-10-28T08:00", "2026-10-28T09:30"), "fixture");

    expect(result.coverage_gaps).toEqual([]);
    expect(result.items).toHaveLength(1);
    const [item] = result.items;
    expect(() => EvidenceItem.parse(item)).not.toThrow();
    expect(item).toMatchObject({
      metric: "aqi",
      evidence_type: "forecast",
      origin: "fixture",
      value: 51,
      unit: "AQI",
      category: "Moderate",
      pollutant: "PM2.5",
      valid_from: "2026-10-28T00:00",
      valid_to: "2026-10-29T00:00",
      source: { name: "AirNow", record_id: "ny003" },
      applies_to: { scope: "reporting_area", park_id: "park-a", area_label: "New York City Region" },
    });
    expect(item.limitations).toContain("Regional reporting-area value, not a park-level measurement");
    expect(item.limitations.some((l) => l.includes("Recorded AirNow response"))).toBe(true);
  });

  it("never lets a current reading stand in for a later event, even on the same day", async () => {
    const result = await fetchAirQuality(req("2026-10-27T18:00", "2026-10-27T19:00"), "fixture");
    expect(result.items.map((i) => i.evidence_type)).toEqual(["forecast"]);
  });

  it("adds observations only for the hour they measured, when the event covers it", async () => {
    const result = await fetchAirQuality(req("2026-10-27T14:00", "2026-10-27T15:30"), "fixture");
    const observed = result.items.filter((i) => i.evidence_type === "observation");
    expect(observed.map((i) => [i.pollutant, i.value, i.category])).toEqual([
      ["PM2.5", 19, "Good"],
      ["OZONE", 26, "Good"],
    ]);
    // "15:00 EDT" marks the end of the hour measured.
    for (const i of observed) expect([i.valid_from, i.valid_to]).toEqual(["2026-10-27T14:00", "2026-10-27T15:00"]);
    for (const i of result.items) expect(() => EvidenceItem.parse(i)).not.toThrow();
  });

  it("gives a gap, not a value, for a day AirNow has no forecast for", async () => {
    const result = await fetchAirQuality(req("2026-10-30T08:00", "2026-10-30T09:00"), "fixture");
    expect(result.items).toEqual([]);
    expect(result.coverage_gaps).toEqual(["AirNow has no forecast for park-a on 2026-10-30"]);
  });

  it("checks every day of an event that runs past midnight", async () => {
    const result = await fetchAirQuality(req("2026-10-28T23:00", "2026-10-29T01:00"), "fixture");
    expect(result.items.map((i) => i.valid_from)).toEqual(["2026-10-28T00:00"]);
    expect(result.coverage_gaps).toEqual(["AirNow has no forecast for park-a on 2026-10-29"]);
  });
});

describe("fetchAirQualityWith (failures become gaps)", () => {
  const event = req("2026-10-28T08:00", "2026-10-28T09:00");

  it.each([
    ["the retired service (HTTP 410)", retired, "failed with HTTP 410"],
    ["an invalid key (HTTP 401)", invalidKey, "failed with HTTP 401"],
    ["an error sent as HTTP 200", noArea, "returned an error message"],
  ])("handles %s", async (_name, response, reason) => {
    const result = await fetchAirQualityWith(
      event,
      "live",
      recorded({ [FORECAST]: () => response, [OBSERVATION]: () => response }),
    );
    expect(result.items).toEqual([]);
    expect(result.coverage_gaps).toEqual([
      `AirNow data for park-a not available: forecast request ${reason}`,
      `AirNow data for park-a not available: observation request ${reason}`,
    ]);
    // The provider's own error text is never passed on.
    expect(result.coverage_gaps.join(" ")).not.toContain("WebServiceError");
    expect(result.coverage_gaps.join(" ")).not.toContain("retired as of");
  });

  it("keeps the forecast when only the observation request fails", async () => {
    const result = await fetchAirQualityWith(event, "live", recorded({ [OBSERVATION]: () => retired }));
    expect(result.items).toHaveLength(1);
    expect(result.coverage_gaps).toEqual(["AirNow data for park-a not available: observation request failed with HTTP 410"]);
  });

  it("handles network errors and timeouts", async () => {
    const result = await fetchAirQualityWith(event, "live", async () => {
      throw new Error("timeout");
    });
    expect(result.items).toEqual([]);
    expect(result.coverage_gaps[0]).toContain("network error or timeout");
  });

  it("handles a response in an unexpected format", async () => {
    const result = await fetchAirQualityWith(
      event,
      "live",
      recorded({ [FORECAST]: () => ({ ...forecast, body: [{ surprise: true }] }) }),
    );
    expect(result.items.filter((i) => i.evidence_type === "forecast")).toEqual([]);
    expect(result.coverage_gaps[0]).toContain("unexpected format");
  });

  it("treats a category-only forecast (AQI -1) as missing, keeping the category", async () => {
    const body = forecast.body.map((r) => ({ ...r, aqi: -1 }));
    const result = await fetchAirQualityWith(event, "live", recorded({ [FORECAST]: () => ({ ...forecast, body }) }));
    const [item] = result.items;
    expect(item).toMatchObject({ value: null, category: "Moderate" });
    expect(item.missing_reason).toContain("category only");
    expect(() => EvidenceItem.parse(item)).not.toThrow();
  });

  it("gives a gap for an observation in a time zone it doesn't know", async () => {
    const body = observation.body.slice(0, 1).map((r) => ({ ...r, localTimeZone: "XYZ" }));
    const result = await fetchAirQualityWith(
      event,
      "live",
      recorded({ [OBSERVATION]: () => ({ ...observation, body }) }),
    );
    expect(result.coverage_gaps).toEqual(["AirNow data for park-a not available: an observation's time zone was not recognized"]);
  });
});

describe("live mode and the API key", () => {
  const event = req("2026-10-28T08:00", "2026-10-28T09:00");

  it("refuses live mode without AIRNOW_API_KEY, without making a request", async () => {
    vi.stubEnv("AIRNOW_API_KEY", "");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await fetchAirQuality(event, "live");
    expect(spy).not.toHaveBeenCalled();
    expect(result.coverage_gaps[0]).toContain("AIRNOW_API_KEY is not set");
  });

  it("sends the key to AirNow but never puts it in the evidence", async () => {
    vi.stubEnv("AIRNOW_API_KEY", "test-key-123");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      const body = url.startsWith(FORECAST) ? forecast.body : observation.body;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const result = await fetchAirQuality(event, "live");

    expect(calls).toHaveLength(2);
    for (const url of calls) expect(url).toContain("api_key=test-key-123");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].origin).toBe("live");
    expect(JSON.stringify(result)).not.toContain("test-key-123");
  });
});
