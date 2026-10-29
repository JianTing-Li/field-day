import { describe, expect, it } from "vitest";
import { fromLocalDateTime, toLocalDateTime } from "./time";

describe("toLocalDateTime", () => {
  it("converts summer (EDT, UTC-4)", () => {
    expect(toLocalDateTime("2026-07-16T12:00:00Z")).toBe("2026-07-16T08:00");
    expect(toLocalDateTime("2026-07-16T08:00:00-04:00")).toBe("2026-07-16T08:00");
  });
  it("converts winter (EST, UTC-5)", () => {
    expect(toLocalDateTime("2026-12-03T14:30:00Z")).toBe("2026-12-03T09:30");
  });
  it("crosses midnight into the previous local day", () => {
    expect(toLocalDateTime("2026-10-30T02:00:00Z")).toBe("2026-10-29T22:00");
  });
  it("rejects invalid input", () => {
    expect(() => toLocalDateTime("not a date")).toThrow();
  });
});

describe("fromLocalDateTime", () => {
  it("round-trips on both sides of the November DST change", () => {
    expect(fromLocalDateTime("2026-10-29T09:00").toISOString()).toBe("2026-10-29T13:00:00.000Z");
    expect(fromLocalDateTime("2026-11-02T09:00").toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
  it("round-trips with toLocalDateTime", () => {
    for (const local of ["2026-03-09T07:15", "2026-07-16T08:00", "2026-12-31T23:59"]) {
      expect(toLocalDateTime(fromLocalDateTime(local))).toBe(local);
    }
  });
});
