import { describe, expect, it, vi } from "vitest";
import { EvidenceItem } from "@/contracts";
import recordedJson from "@fixtures/sources/parks/parks-properties.json";
import {
  fetchParkRecords,
  getCuratedParks,
  insideMultiPolygon,
  propertyId,
  type RecordedParksResponse,
} from "./parks";

const recorded = recordedJson as RecordedParksResponse;

function withRecords(edit: (records: RecordedParksResponse["records"]) => RecordedParksResponse["records"]) {
  return { ...recorded, records: edit(structuredClone(recorded.records)) };
}

describe("curated parks", () => {
  it("has 29 parks across all five boroughs with reviewed coordinates (D-020, D-JT24-13)", async () => {
    const parks = await getCuratedParks();
    expect(parks).toHaveLength(29);
    expect(new Set(parks.map((p) => p.borough))).toEqual(
      new Set(["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]),
    );
    for (const p of parks) {
      expect(p.location).not.toBeNull();
      expect(p.id).toMatch(/^park-[bmqrx]\d{3}$/);
    }
  });

  it("lists space and permission as unknown for every park", async () => {
    for (const p of await getCuratedParks()) {
      expect(p.unknowns).toContain("Usable workout space not confirmed");
      expect(p.unknowns).toContain("Permit requirement not confirmed");
    }
  });
});

describe("fetchParkRecords (fixture)", () => {
  it("returns one valid, fixture-labeled park_record per curated park with no gaps", async () => {
    const parks = await getCuratedParks();
    const result = await fetchParkRecords("fixture");
    expect(result.origin).toBe("fixture");
    expect(result.coverage_gaps).toEqual([]);
    expect(result.items.map((i) => i.id)).toEqual(parks.map((p) => p.evidence_id));
    for (const item of result.items) {
      expect(() => EvidenceItem.parse(item)).not.toThrow();
      expect(item.origin).toBe("fixture");
      expect(item.metric).toBe("park_record");
      expect(item.evidence_type).toBe("reference");
      expect(item.retrieved_at).toBe(recorded.retrieved_at);
      expect(item.limitations[0]).toMatch(/^Fixture data/);
      expect(item.limitations.join(" ")).toMatch(/do not prove usable workout space/);
    }
  });

  it("links each item to its Parks property ID", async () => {
    const parks = await getCuratedParks();
    const result = await fetchParkRecords("fixture");
    result.items.forEach((item, i) => {
      expect(item.source.record_id).toBe(propertyId(parks[i]));
      expect(item.applies_to).toEqual({ scope: "park", park_id: parks[i].id, area_label: null });
    });
  });

  it("every reviewed coordinate lies inside its recorded property boundary", async () => {
    for (const p of await getCuratedParks()) {
      const record = recorded.records.find((r) => r.gispropnum === propertyId(p));
      expect(record?.multipolygon, p.name).toBeDefined();
      expect(insideMultiPolygon(p.location!, record!.multipolygon!.coordinates), p.name).toBe(true);
    }
  });

  it("a missing record gives a null value with a reason and a gap", async () => {
    const result = await fetchParkRecords("fixture", {
      recorded: withRecords((rs) => rs.filter((r) => r.gispropnum !== "B058")),
    });
    const item = result.items.find((i) => i.source.record_id === "B058")!;
    expect(item.value).toBeNull();
    expect(item.missing_reason).toMatch(/No Parks Properties record/);
    expect(result.coverage_gaps).toEqual(["McCarren Park: No Parks Properties record found for B058"]);
  });

  it("a retired record is not used", async () => {
    const result = await fetchParkRecords("fixture", {
      recorded: withRecords((rs) => rs.map((r) => (r.gispropnum === "Q004" ? { ...r, retired: true } : r))),
    });
    const item = result.items.find((i) => i.source.record_id === "Q004")!;
    expect(item.value).toBeNull();
    expect(item.missing_reason).toMatch(/retired/);
  });

  it("flags name, borough and acreage that differ from the curated entry", async () => {
    const result = await fetchParkRecords("fixture", {
      recorded: withRecords((rs) =>
        rs.map((r) => (r.gispropnum === "M047" ? { ...r, signname: "Renamed Park", borough: "X", acres: "1" } : r)),
      ),
    });
    const gaps = result.coverage_gaps.filter((g) => g.startsWith("Thomas Jefferson Park"));
    expect(gaps).toHaveLength(3);
    const item = result.items.find((i) => i.source.record_id === "M047")!;
    expect(item.value).toBe("Renamed Park");
    expect(item.limitations).toEqual(expect.arrayContaining([expect.stringMatching(/differs from curated name/)]));
  });

  it("flags a coordinate outside the property boundary", async () => {
    // Move McCarren's boundary away from its reviewed coordinate.
    const far = [[[[-74, 40], [-74, 40.001], [-73.999, 40.001], [-74, 40]]]];
    const result = await fetchParkRecords("fixture", {
      recorded: withRecords((rs) =>
        rs.map((r) => (r.gispropnum === "B058" ? { ...r, multipolygon: { type: "MultiPolygon", coordinates: far } } : r)),
      ),
    });
    expect(result.coverage_gaps).toEqual(["McCarren Park: reviewed coordinate is outside the property boundary"]);
  });
});

describe("fetchParkRecords (live, injected fetch)", () => {
  const now = () => new Date("2026-10-28T13:00:00Z");

  it("queries the curated property IDs and labels results live", async () => {
    const fetchFn = vi.fn(async () => Response.json(recorded.records));
    const result = await fetchParkRecords("live", { fetch: fetchFn as unknown as typeof fetch, now });
    expect(result.origin).toBe("live");
    expect(result.coverage_gaps).toEqual([]);
    const url = new URL(String((fetchFn.mock.calls[0] as unknown[])[0]));
    // One request for every curated park, however many there are.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const ids = (await getCuratedParks()).map((p) => `'${propertyId(p)}'`).join(",");
    expect(url.searchParams.get("$where")).toBe(`gispropnum in(${ids})`);
    for (const item of result.items) {
      expect(item.origin).toBe("live");
      expect(item.retrieved_at).toBe("2026-10-28T13:00:00.000Z");
      expect(item.limitations.some((l) => l.startsWith("Fixture"))).toBe(false);
    }
  });

  it("an HTTP failure returns null-valued items and a gap instead of throwing", async () => {
    const fetchFn = vi.fn(async () => new Response("error", { status: 503 }));
    const result = await fetchParkRecords("live", { fetch: fetchFn as unknown as typeof fetch, now });
    expect(result.items).toHaveLength((await getCuratedParks()).length);
    for (const item of result.items) {
      expect(item.value).toBeNull();
      expect(item.missing_reason).toBe("Parks Properties request failed: HTTP 503");
      expect(() => EvidenceItem.parse(item)).not.toThrow();
    }
    expect(result.coverage_gaps).toEqual(["Parks Properties request failed: HTTP 503"]);
  });

  it("a network error or unexpected body never throws", async () => {
    const down = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const odd = vi.fn(async () => Response.json({ error: true }));
    for (const fetchFn of [down, odd]) {
      const result = await fetchParkRecords("live", { fetch: fetchFn as unknown as typeof fetch, now });
      expect(result.coverage_gaps).toHaveLength(1);
      expect(result.items.every((i) => i.value === null)).toBe(true);
    }
  });
});
