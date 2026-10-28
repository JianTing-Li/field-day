import { describe, expect, it } from "vitest";
import { case02 } from "@fixtures/scenarios";
import { changeValue } from "./Alternatives";

const snapshot = case02.snapshot("evt", 1);

describe("changeValue", () => {
  it("puts each kind of change in words", () => {
    expect(changeValue({ field: "park", from: null, to: "park-b" }, "park-b", snapshot, null)).toBe(snapshot.park_candidates[1].name);
    expect(changeValue({ field: "start_time", from: null, to: null }, "2026-07-16T08:00", snapshot, null)).toBe("Thu, Jul 16 · 8:00 AM");
    expect(changeValue({ field: "workout", from: null, to: null }, "tpl-bodyweight-45", snapshot, null)).toBe("Beginner bodyweight circuit");
    expect(
      changeValue({ field: "adaptation", from: null, to: null }, "adapt-stationary-circuit", snapshot, "tpl-run-intervals-45"),
    ).toContain("stationary circuit");
    expect(changeValue({ field: "duration", from: null, to: null }, "30", snapshot, null)).toBe("30 min");
  });

  it("says 'none' for an empty side and keeps unknown text as is", () => {
    expect(changeValue({ field: "adaptation", from: null, to: "x" }, null, snapshot, null)).toBe("none");
    expect(changeValue({ field: "start_time", from: "10:00", to: "08:00" }, "10:00", snapshot, null)).toBe("10:00");
  });
});
