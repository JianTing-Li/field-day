import { describe, expect, it } from "vitest";
import { findParks, milesBetween, zipCentre, type PickerPark } from "./park-picker";

const parks: PickerPark[] = [
  { id: "park-b032", name: "Fort Greene Park", borough: "Brooklyn", location: { lat: 40.6915, lon: -73.9755 } },
  { id: "park-b073", name: "Prospect Park", borough: "Brooklyn", location: { lat: 40.6614, lon: -73.9697 } },
  { id: "park-m010", name: "Central Park", borough: "Manhattan", location: { lat: 40.7825, lon: -73.9655 } },
  { id: "park-x092", name: "Van Cortlandt Park", borough: "Bronx", location: { lat: 40.894, lon: -73.8918 } },
];

describe("park picker (D-JT24-13)", () => {
  it("finds parks by name or borough, case-insensitively", () => {
    expect(findParks(parks, { query: "prospect" }).map((p) => p.id)).toEqual(["park-b073"]);
    expect(findParks(parks, { query: "brooklyn" }).map((p) => p.id)).toEqual(["park-b032", "park-b073"]);
  });

  it("narrows to one borough", () => {
    expect(findParks(parks, { borough: "Manhattan" }).map((p) => p.id)).toEqual(["park-m010"]);
  });

  it("sorts nearest first from a zip code, with miles", () => {
    const origin = zipCentre("11217")!; // Park Slope / Boerum Hill
    const ranked = findParks(parks, { origin });
    expect(ranked[0].id).toBe("park-b032");
    expect(ranked.at(-1)!.id).toBe("park-x092");
    expect(ranked[0].miles!).toBeLessThan(2);
  });

  it("knows NYC zip codes only", () => {
    expect(zipCentre("10027")).not.toBeNull();
    expect(zipCentre("90210")).toBeNull();
  });

  it("measures distance in miles", () => {
    expect(milesBetween({ lat: 40.6915, lon: -73.9755 }, { lat: 40.7825, lon: -73.9655 })).toBeCloseTo(6.3, 0);
  });
});
