import { describe, expect, it } from "vitest";
import { LifecycleStatus } from "@/contracts";
import { STATUS, daysFrom, formatClock, formatEventDate, formatUpdated, startWindowText, todayInNewYork, versionText } from "./format";

describe("STATUS", () => {
  it("has a label and hint for every lifecycle status, and no symbol except the lock", () => {
    for (const s of LifecycleStatus.options) {
      expect(STATUS[s].label.length).toBeGreaterThan(0);
      expect(STATUS[s].hint.length).toBeGreaterThan(0);
      expect(STATUS[s].icon).toBe(s === "finalized" ? "🔒" : undefined);
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

describe("formatClock and startWindowText", () => {
  it("shows AM/PM times", () => {
    expect(formatClock("08:00")).toBe("8:00 AM");
    expect(formatClock("00:30")).toBe("12:30 AM");
    expect(formatClock("12:00")).toBe("12:00 PM");
    expect(formatClock("13:45")).toBe("1:45 PM");
  });

  it("says 'starts at' when the window is one time, 'between' otherwise", () => {
    expect(startWindowText("09:00", "09:00")).toBe("starts at 9:00 AM");
    expect(startWindowText("08:00", "10:00")).toBe("starts between 8:00 AM and 10:00 AM");
  });
});

describe("todayInNewYork and daysFrom", () => {
  it("uses New York's date, not UTC's", () => {
    // 02:00 UTC on Oct 30 is still the evening of Oct 29 in New York.
    expect(todayInNewYork(new Date("2026-10-30T02:00:00Z"))).toBe("2026-10-29");
  });

  it("counts whole days, negative for the past", () => {
    expect(daysFrom("2026-10-29", "2026-11-05")).toBe(7);
    expect(daysFrom("2026-10-29", "2026-10-28")).toBe(-1);
  });
});
