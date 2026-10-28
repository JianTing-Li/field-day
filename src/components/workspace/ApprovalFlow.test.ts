import { describe, expect, it } from "vitest";
import type { OrganizerTask } from "@/contracts";
import { confirmable } from "./ApprovalFlow";

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
