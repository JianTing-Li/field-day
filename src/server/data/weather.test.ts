import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidenceItem, type ConditionsRequest } from "@/contracts";
import points from "@fixtures/sources/nws/points-central-park.json";
import hourly from "@fixtures/sources/nws/forecast-hourly-okx-34-45.json";
import pointsError from "@fixtures/sources/nws/points-error-404.json";
import { fetchForecast, fetchForecastWith, parseWindSpeed, type NwsFetcher } from "./weather";

// The recording covers 2026-10-27T13:00 to 2026-11-03T00:00 (New York time) for grid OKX/34,45.
const req = (start_time: string, end_time: string): ConditionsRequest => ({
  park_id: "park-a",
  lat: 40.7812,
  lon: -73.9665,
  start_time,
  end_time,
});

/** Answers from the recordings, with optional overrides by URL. */
function recorded(overrides: Record<string, () => unknown> = {}): NwsFetcher {
  return async (url) => {
    for (const [prefix, answer] of Object.entries(overrides)) {
      if (url.startsWith(prefix)) return answer() as never;
    }
    if (url.startsWith("https://api.weather.gov/points/")) return points;
    if (url === hourly.url) return hourly;
    throw new Error(`unexpected URL ${url}`);
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("fetchForecast (fixture mode)", () => {
  it("returns temperature, precipitation and wind evidence for every hour of the event", async () => {
    const result = await fetchForecast(req("2026-10-28T08:00", "2026-10-28T09:30"), "fixture");

    expect(result.origin).toBe("fixture");
    expect(result.coverage_gaps).toEqual([]);
    expect(result.items).toHaveLength(6); // 08:00 and 09:00 periods x 3 metrics
    for (const item of result.items) expect(() => EvidenceItem.parse(item)).not.toThrow();

    const temp = result.items.find((i) => i.metric === "temperature" && i.valid_from === "2026-10-28T08:00");
    expect(temp).toMatchObject({
      value: 46,
      unit: "F",
      valid_to: "2026-10-28T09:00",
      evidence_type: "forecast",
      origin: "fixture",
      source: { name: "NWS", record_id: "OKX/34,45" },
      applies_to: { scope: "forecast_grid", park_id: "park-a", area_label: "NWS grid OKX/34,45" },
      retrieved_at: hourly.retrieved_at,
    });
    expect(temp?.limitations.some((l) => l.includes("Recorded NWS response"))).toBe(true);

    const rain = result.items.find((i) => i.metric === "precipitation_probability");
    expect(rain).toMatchObject({ value: 0, unit: "percent" });
    const wind = result.items.find((i) => i.metric === "wind_speed");
    expect(wind).toMatchObject({ value: 0, unit: "mph" });
  });

  it("gives a coverage gap, not a guessed value, when the event is outside the forecast", async () => {
    const result = await fetchForecast(req("2026-11-10T08:00", "2026-11-10T09:00"), "fixture");
    expect(result.items).toEqual([]);
    expect(result.coverage_gaps).toEqual([
      "NWS hourly forecast for park-a (grid OKX/34,45) does not cover 2026-11-10T08:00 to 2026-11-10T09:00",
    ]);
  });

  it("returns the covered hours and a gap for the part past the end of the forecast", async () => {
    const result = await fetchForecast(req("2026-11-02T23:00", "2026-11-03T01:00"), "fixture");
    expect(result.items).toHaveLength(3);
    expect(result.coverage_gaps).toEqual([
      "NWS hourly forecast for park-a (grid OKX/34,45) does not cover 2026-11-03T00:00 to 2026-11-03T01:00",
    ]);
  });

  it("keeps both 1 AM hours apart on the night clocks fall back", async () => {
    const result = await fetchForecast(req("2026-11-01T00:00", "2026-11-01T03:00"), "fixture");
    expect(result.coverage_gaps).toEqual([]);
    expect(result.items).toHaveLength(12); // 00:00, 01:00 EDT, 01:00 EST, 02:00
    expect(new Set(result.items.map((i) => i.id)).size).toBe(12);
  });
});

describe("fetchForecastWith (failures never throw)", () => {
  const event = req("2026-10-28T08:00", "2026-10-28T09:00");

  it("turns the recorded HTTP 404 into empty items plus a gap", async () => {
    const result = await fetchForecastWith(
      event,
      "live",
      recorded({ "https://api.weather.gov/points/": () => pointsError }),
    );
    expect(result).toEqual({
      origin: "live",
      items: [],
      coverage_gaps: ["NWS forecast for park-a not available: points lookup failed with HTTP 404"],
    });
  });

  it("does not pass the provider's error text on", async () => {
    const result = await fetchForecastWith(
      event,
      "live",
      recorded({ "https://api.weather.gov/points/": () => pointsError }),
    );
    expect(result.coverage_gaps.join(" ")).not.toContain(pointsError.body.detail);
  });

  it("handles a failed hourly request", async () => {
    const result = await fetchForecastWith(
      event,
      "live",
      recorded({ [hourly.url]: () => ({ ...hourly, status: 503, body: null }) }),
    );
    expect(result.items).toEqual([]);
    expect(result.coverage_gaps[0]).toContain("hourly forecast failed with HTTP 503");
  });

  it("handles network errors and timeouts", async () => {
    const result = await fetchForecastWith(event, "live", async () => {
      throw new Error("timeout");
    });
    expect(result.items).toEqual([]);
    expect(result.coverage_gaps[0]).toContain("network error or timeout");
  });

  it("handles a response in an unexpected format", async () => {
    const result = await fetchForecastWith(
      event,
      "live",
      recorded({ [hourly.url]: () => ({ ...hourly, body: { properties: {} } }) }),
    );
    expect(result.items).toEqual([]);
    expect(result.coverage_gaps[0]).toContain("unexpected format");
  });

  it("refuses live mode without NWS_USER_AGENT, without making a request", async () => {
    vi.stubEnv("NWS_USER_AGENT", "");
    const spy = vi.spyOn(globalThis, "fetch");
    const result = await fetchForecast(event, "live");
    expect(spy).not.toHaveBeenCalled();
    expect(result.coverage_gaps[0]).toContain("NWS_USER_AGENT is not set");
    spy.mockRestore();
  });

  it("explains a missing value instead of inventing one", async () => {
    const body = structuredClone(hourly.body);
    for (const p of body.properties.periods) p.probabilityOfPrecipitation.value = null as never;
    const result = await fetchForecastWith(event, "live", recorded({ [hourly.url]: () => ({ ...hourly, body }) }));
    const rain = result.items.find((i) => i.metric === "precipitation_probability");
    expect(rain).toMatchObject({ value: null, missing_reason: expect.stringContaining("no precipitation") });
    expect(() => EvidenceItem.parse(rain)).not.toThrow();
  });
});

describe("parseWindSpeed", () => {
  it("reads a single speed", () => {
    expect(parseWindSpeed("8 mph")).toEqual({ value: 8, unit: "mph", range: false });
  });
  it("uses the higher value of a range", () => {
    expect(parseWindSpeed("5 to 10 mph")).toEqual({ value: 10, unit: "mph", range: true });
  });
  it("returns null for text it cannot read", () => {
    expect(parseWindSpeed("calm")).toEqual({ value: null, unit: null, range: false });
  });
});
