import { describe, expect, it } from "vitest";
import { shiftDate } from "@fixtures/scenarios";

describe("shiftDate (D-JT24-14)", () => {
  it("moves every date by the same number of days", () => {
    const moved = shiftDate({ start: "2026-07-14T09:00", until: "2026-07-15T00:00" }, "2026-07-14", "2026-11-01");
    expect(moved).toEqual({ start: "2026-11-01T09:00", until: "2026-11-02T00:00" });
  });

  it("leaves a missing stub answer missing, so the stub reports not_implemented instead of crashing", () => {
    expect(shiftDate(undefined, "2026-07-14", "2026-11-01")).toBeUndefined();
    expect(shiftDate(null, "2026-07-14", "2026-11-01")).toBeNull();
  });
});
