import { describe, expect, it } from "vitest";
import { LifecycleStatus } from "@/contracts";
import { STATUS, formatEventDate, formatUpdated, versionText } from "./format";

describe("STATUS", () => {
  it("has a label, hint and icon for every lifecycle status", () => {
    for (const s of LifecycleStatus.options) {
      expect(STATUS[s].label.length).toBeGreaterThan(0);
      expect(STATUS[s].hint.length).toBeGreaterThan(0);
      expect(STATUS[s].icon.length).toBeGreaterThan(0);
    }
  });

  it("never shows needs_verification as anything that sounds ready", () => {
    expect(STATUS.needs_verification.label).toBe("Needs checking");
    expect(STATUS.needs_verification.tone).toBe("warning");
  });
});

describe("formatEventDate", () => {
  it("keeps the calendar day, whatever the time zone", () => {
    expect(formatEventDate("2026-10-29")).toBe("Thu, Oct 29, 2026");
    expect(formatEventDate("2026-01-01")).toBe("Thu, Jan 1, 2026");
  });

  it("returns the raw text for something that isn't a date", () => {
    expect(formatEventDate("soon")).toBe("soon");
  });
});

describe("formatUpdated", () => {
  it("shows New York time", () => {
    expect(formatUpdated("2026-10-28T18:05:00Z")).toBe("Oct 28, 2:05 PM");
    // After clocks fall back on Nov 1, New York is UTC-5.
    expect(formatUpdated("2026-11-02T18:05:00Z")).toBe("Nov 2, 1:05 PM");
  });
});

describe("versionText", () => {
  it("says when nothing is finalized", () => {
    expect(versionText(2, null)).toEqual({ current: "v2", finalized: "Not finalized" });
  });

  it("marks a finalized version that is still current", () => {
    expect(versionText(3, 3).finalized).toBe("v3 (current)");
  });

  it("shows an older finalized version once a newer draft exists", () => {
    expect(versionText(4, 3)).toEqual({ current: "v4", finalized: "v3" });
  });
});
