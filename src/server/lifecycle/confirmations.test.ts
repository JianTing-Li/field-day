import { describe, expect, it } from "vitest";
import type { OrganizerConfirmation } from "@/contracts";
import { case02 } from "@fixtures/scenarios";
import { applyConfirmations } from "./confirmations";

// combo-1 is Park A at 8 a.m.; combo-2 is Park B at 8 a.m. Both have space unknown.
const review = case02.reviewerOutput(3);
const parkA = review.ranked_options[0].checks;
const parkB = review.ranked_options[1].checks;

function conf(c: Partial<OrganizerConfirmation>): OrganizerConfirmation {
  return {
    id: "conf-1",
    check_id: "space_surface.space",
    park_id: "park-a",
    start_time: null,
    statement: "Open lawn fits 18 people",
    confirmed_by: "Organizer",
    confirmed_at: "2026-10-28T12:00:00Z",
    note: null,
    ...c,
  };
}

const space = (r: typeof parkA) => r.checks.find((c) => c.check_id === "space_surface.space")!;

describe("applyConfirmations", () => {
  it("resolves the stated check at the stated park", () => {
    const { checks, changed } = applyConfirmations(parkA, [conf({})]);
    expect(changed).toBe(true);
    expect(space(checks).status).toBe("pass");
    expect(space(checks).reason).toContain("Organizer confirmed");
    expect(checks.overall).toBe("pass");
  });

  it("never carries over to another park", () => {
    const { checks, changed } = applyConfirmations(parkB, [conf({ park_id: "park-a" })]);
    expect(changed).toBe(false);
    expect(space(checks).status).toBe("unknown");
    expect(checks.overall).toBe("unknown");
  });

  it("applies only at the stated time when one is given", () => {
    expect(applyConfirmations(parkA, [conf({ start_time: "2026-07-16T10:00" })]).changed).toBe(false);
    expect(applyConfirmations(parkA, [conf({ start_time: "2026-07-16T08:00" })]).changed).toBe(true);
  });

  it("resolves only the stated check", () => {
    const { checks, changed } = applyConfirmations(parkA, [conf({ check_id: "space_surface.surface" })]);
    expect(changed).toBe(false);
    expect(space(checks).status).toBe("unknown");
  });

  it("never overrides a failed check", () => {
    const original = case02.planningOutput(2).rule_checks!; // Park A 10 a.m.: space fails
    const { checks, changed } = applyConfirmations(original, [conf({})]);
    expect(changed).toBe(false);
    expect(space(checks).status).toBe("fail");
  });
});
