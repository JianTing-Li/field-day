import { describe, expect, it } from "vitest";
import { case01, case02 } from "@fixtures/scenarios";
import { evidence } from "@fixtures/scenarios/helpers";
import type { CandidatePlan, EventBrief, EvidenceItem, RuleInput } from "@/contracts";
import { allowedParkCheck, logisticsRules, permitReviewCheck, startWindowCheck } from "./logistics";

/** Case 1 input (park-a, 2026-10-29T09:00, window 09:00–09:00, 15 people, permit confirmed). */
function input(
  plan: Partial<CandidatePlan> = {},
  brief: Partial<EventBrief> = {},
  items?: EvidenceItem[],
): RuleInput {
  const snapshot = case01.snapshot("evt", 1);
  return {
    plan: { ...case01.planningOutput(1).plan, ...plan },
    brief: { ...case01.brief, ...brief },
    snapshot: items ? { ...snapshot, items } : snapshot,
    event_version: 1,
  };
}

const permit = (park_id: string, value: boolean | null, extra: Partial<Parameters<typeof evidence>[0]> = {}) =>
  evidence({
    id: `ev-permit-${park_id}`,
    metric: "permission_confirmation",
    evidence_type: "organizer_confirmation",
    value,
    missing_reason: value === null ? "Organizer has not answered" : null,
    source: "Organizer",
    park_id,
    confirms_check_id: "permissions.permit_review",
    ...extra,
  });

describe("allowedParkCheck", () => {
  it("passes an allowed park and cites its park record", () => {
    const r = allowedParkCheck(input());
    expect(r.status).toBe("pass");
    expect(r.evidence_ids).toEqual(["ev-park-a-record"]);
    expect(r.assessed.park_id).toBe("park-a");
  });
  it("fails a park the organizer did not allow", () => {
    expect(allowedParkCheck(input({ park_id: "park-z" })).status).toBe("fail");
  });
  it("is unknown, not pass, when no park is selected", () => {
    expect(allowedParkCheck(input({ park_id: null })).status).toBe("unknown");
  });
});

describe("startWindowCheck", () => {
  const wide = { start_window: { earliest: "08:00", latest: "10:00" } };
  it("passes inside the window, including both ends", () => {
    for (const t of ["08:00", "09:15", "10:00"]) {
      expect(startWindowCheck(input({ start_time: `2026-10-29T${t}` }, wide)).status).toBe("pass");
    }
  });
  it("fails before or after the window", () => {
    expect(startWindowCheck(input({ start_time: "2026-10-29T07:59" }, wide)).status).toBe("fail");
    expect(startWindowCheck(input({ start_time: "2026-10-29T10:01" }, wide)).status).toBe("fail");
  });
  it("fails on a different date", () => {
    expect(startWindowCheck(input({ start_time: "2026-10-30T09:00" }, wide)).status).toBe("fail");
  });
  it("is unknown, not pass, when no start time is selected", () => {
    expect(startWindowCheck(input({ start_time: null })).status).toBe("unknown");
  });
  it("is critical", () => {
    expect(startWindowCheck(input()).critical).toBe(true);
  });
});

describe("permitReviewCheck", () => {
  const noRecords = case01.snapshot("evt", 1).items.filter((e) => e.metric !== "permission_confirmation");

  it("is always non-critical", () => {
    expect(permitReviewCheck(input({}, { group_size: 40 }, noRecords)).critical).toBe(false);
  });
  it("warns (unknown) at 20 or more with no record", () => {
    const r = permitReviewCheck(input({}, { group_size: 20 }, noRecords));
    expect(r.status).toBe("unknown");
    expect(r.reason).toMatch(/meets the 20-or-more/);
  });
  it("is unknown, not pass, below 20 with no record", () => {
    const r = permitReviewCheck(input({}, { group_size: 19 }, noRecords));
    expect(r.status).toBe("unknown");
    expect(r.reason).toMatch(/below the 20-or-more/);
  });
  it("passes with an organizer record for the same park", () => {
    const r = permitReviewCheck(input({}, { group_size: 25 }, [...noRecords, permit("park-a", true)]));
    expect(r.status).toBe("pass");
    expect(r.evidence_ids).toEqual(["ev-permit-park-a"]);
  });
  it("fails when the organizer records permission is not in place", () => {
    expect(permitReviewCheck(input({}, {}, [...noRecords, permit("park-a", false)])).status).toBe("fail");
  });
  it("stays unknown when the organizer record has no answer", () => {
    expect(permitReviewCheck(input({}, {}, [...noRecords, permit("park-a", null)])).status).toBe("unknown");
  });
  it("never carries a Park A record over to Park B", () => {
    const r = permitReviewCheck(
      input({ park_id: "park-b" }, { group_size: 25, allowed_park_ids: ["park-a", "park-b"] }, [
        ...noRecords,
        permit("park-a", true),
      ]),
    );
    expect(r.status).toBe("unknown");
  });
  it("only uses a time-scoped record for a start time inside its valid period", () => {
    const scoped = permit("park-a", true, { valid_from: "2026-10-29T08:00", valid_to: "2026-10-29T08:45" });
    expect(permitReviewCheck(input({ start_time: "2026-10-29T08:00" }, {}, [...noRecords, scoped])).status).toBe("pass");
    expect(permitReviewCheck(input({ start_time: "2026-10-29T09:00" }, {}, [...noRecords, scoped])).status).toBe("unknown");
  });
});

describe("logisticsRules on scenario fixtures", () => {
  it("Case 1: all three checks pass", () => {
    const checks = logisticsRules(input());
    expect(checks.map((c) => [c.check_id, c.status])).toEqual([
      ["event_constraints.start_window", "pass"],
      ["event_constraints.allowed_park", "pass"],
      ["permissions.permit_review", "pass"],
    ]);
  });
  it("Case 2: Park B at 8 a.m. is allowed and in the window; permit status stays unknown", () => {
    const checks = logisticsRules({
      plan: { ...case02.planningOutput(1).plan, park_id: "park-b", start_time: "2026-07-16T08:00" },
      brief: case02.brief,
      snapshot: case02.snapshot("evt", 1),
      event_version: 1,
    });
    expect(checks.map((c) => c.status)).toEqual(["pass", "pass", "unknown"]);
  });
});
