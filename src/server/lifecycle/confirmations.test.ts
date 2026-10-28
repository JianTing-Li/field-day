import { describe, expect, it } from "vitest";
import type { CheckPlanResult, OrganizerConfirmation } from "@/contracts";
import { case02 } from "@fixtures/scenarios";
import { applyConfirmations, confirmationLayout, planLayout } from "./confirmations";

// combo-1 is Park A at 8 a.m.; combo-2 is Park B at 8 a.m. Both are the stationary adaptation with space unknown.
const review = case02.reviewerOutput(3);
const parkA = review.ranked_options[0].checks;
const parkB = review.ranked_options[1].checks;
const templates = case02.snapshot("evt-2", 3).workout_templates;

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
    layout: "stationary",
    ...c,
  };
}

const space = (r: CheckPlanResult) => r.checks.find((c) => c.check_id === "space_surface.space")!;

describe("applyConfirmations", () => {
  it("resolves the stated check at the stated park for the same layout", () => {
    const { checks, changed } = applyConfirmations(parkA, [conf({})], "stationary");
    expect(changed).toBe(true);
    expect(space(checks).status).toBe("pass");
    expect(space(checks).reason).toContain("Organizer confirmed");
    expect(checks.overall).toBe("pass");
  });

  it("never carries over to another park", () => {
    const { checks, changed } = applyConfirmations(parkB, [conf({ park_id: "park-a" })], "stationary");
    expect(changed).toBe(false);
    expect(space(checks).status).toBe("unknown");
    expect(checks.overall).toBe("unknown");
  });

  it("applies only at the stated time when one is given", () => {
    expect(applyConfirmations(parkA, [conf({ start_time: "2026-07-16T10:00" })], "stationary").changed).toBe(false);
    expect(applyConfirmations(parkA, [conf({ start_time: "2026-07-16T08:00" })], "stationary").changed).toBe(true);
  });

  it("resolves only the stated check", () => {
    const { checks, changed } = applyConfirmations(parkA, [conf({ check_id: "space_surface.surface" })], "stationary");
    expect(changed).toBe(false);
    expect(space(checks).status).toBe("unknown");
  });

  it("never overrides a failed check", () => {
    const original = case02.planningOutput(2).rule_checks!; // Park A 10 a.m.: space fails
    const { checks, changed } = applyConfirmations(original, [conf({ layout: "running_lane" })], "running_lane");
    expect(changed).toBe(false);
    expect(space(checks).status).toBe("fail");
  });

  it("a running-lane confirmation does not resolve stationary space, and the reverse", () => {
    expect(applyConfirmations(parkA, [conf({ layout: "running_lane" })], "stationary").changed).toBe(false);
    expect(applyConfirmations(parkA, [conf({ layout: "stationary" })], "running_lane").changed).toBe(false);
  });

  it("a confirmation with no known layout never resolves space or surface", () => {
    expect(applyConfirmations(parkA, [conf({ layout: null })], "stationary").changed).toBe(false);
    expect(applyConfirmations(parkA, [conf({ layout: undefined })], "stationary").changed).toBe(false);
    expect(applyConfirmations(parkA, [conf({})], null).changed).toBe(false);
  });
});

describe("layouts", () => {
  const running = case02.planningOutput(2).plan!; // run intervals, no adaptation
  const stationary = review.ranked_options[0].plan; // run intervals + stationary circuit

  it("works out the layout from the template and its adaptations", () => {
    expect(planLayout(running, templates)).toBe("running_lane");
    expect(planLayout(stationary, templates)).toBe("stationary");
  });

  it("is unknown for an unknown template or adaptation", () => {
    expect(planLayout({ ...running, workout_template_id: "tpl-unknown" }, templates)).toBeNull();
    expect(planLayout({ ...running, adaptation_ids: ["adapt-unknown"] }, templates)).toBeNull();
    expect(planLayout(null, templates)).toBeNull();
  });

  it("a new confirmation takes the current plan's layout only at the plan's park and time", () => {
    // stationary plan: Park A, 8 a.m.
    expect(confirmationLayout({ park_id: "park-a", start_time: "2026-07-16T08:00" }, stationary, templates)).toBe("stationary");
    expect(confirmationLayout({ park_id: "park-a", start_time: null }, stationary, templates)).toBe("stationary");
    expect(confirmationLayout({ park_id: "park-a", start_time: "2026-07-16T10:00" }, stationary, templates)).toBeNull();
    expect(confirmationLayout({ park_id: "park-b", start_time: null }, stationary, templates)).toBeNull();
  });
});
