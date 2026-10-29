import { describe, expect, it } from "vitest";
import type { CandidatePlan, OrganizerTask } from "@/contracts";
import { aboutCurrentPlan, confirmable } from "./ApprovalFlow";

const task = (t: Partial<OrganizerTask>): OrganizerTask => ({
  id: "task-1",
  description: "Confirm stationary space at Park A at 8 a.m.",
  resolves_check_id: "space_surface.space",
  park_id: "park-a",
  start_time: "2026-07-16T08:00",
  ...t,
});

describe("confirmable", () => {
  it("allows a task that names a check and a park", () => {
    expect(confirmable(task({}))).toBe(true);
    expect(confirmable(task({ start_time: null }))).toBe(true);
  });

  it("refuses a task with no check or no park, so a confirmation never floats free", () => {
    expect(confirmable(task({ resolves_check_id: null }))).toBe(false);
    expect(confirmable(task({ park_id: null }))).toBe(false);
  });
});

describe("aboutCurrentPlan", () => {
  const plan = { park_id: "park-a", start_time: "2026-07-16T08:00" } as CandidatePlan;

  it("is true for a task at the plan's park and time, or at its park with no time", () => {
    expect(aboutCurrentPlan(task({}), plan)).toBe(true);
    expect(aboutCurrentPlan(task({ start_time: null }), plan)).toBe(true);
  });

  it("is false for another park or another time, so Confirm isn't offered there", () => {
    expect(aboutCurrentPlan(task({ park_id: "park-b" }), plan)).toBe(false);
    expect(aboutCurrentPlan(task({ start_time: "2026-07-16T10:00" }), plan)).toBe(false);
  });

  it("is false when there is no plan yet", () => {
    expect(aboutCurrentPlan(task({}), null)).toBe(false);
  });
});
