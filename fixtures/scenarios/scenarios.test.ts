import { describe, expect, it } from "vitest";
import {
  EventBrief,
  EvidenceSnapshot,
  LogisticsOutput,
  ParkCandidate,
  PlanningOutput,
  ReviewerOutput,
  WorkoutOutput,
  WorkoutTemplate,
} from "@/contracts";
import parks from "@/server/content/parks.json";
import workouts from "@/server/content/workouts.json";
import { case01, case02 } from "./index";

describe("content files match contracts", () => {
  it("parks.json", () => {
    for (const p of parks) expect(() => ParkCandidate.parse(p)).not.toThrow();
  });
  it("workouts.json", () => {
    for (const t of workouts) expect(() => WorkoutTemplate.parse(t)).not.toThrow();
  });
  it("every park a scenario uses is a curated park", () => {
    const curated = new Set(parks.map((p) => p.id));
    for (const c of [case01, case02]) {
      const snap = c.snapshot("evt", 1);
      expect(snap.park_candidates.map((p) => p.id).sort()).toEqual([...c.brief.allowed_park_ids].sort());
      for (const id of c.brief.allowed_park_ids) expect(curated).toContain(id);
      for (const t of snap.park_time_candidates) expect(curated).toContain(t.park_id);
    }
  });
});

describe("Case 1 fixture", () => {
  it("matches contracts", () => {
    EventBrief.parse(case01.brief);
    EvidenceSnapshot.parse(case01.snapshot("evt-1", 1));
    PlanningOutput.parse(case01.planningOutput(1));
  });
  it("passes every critical check", () => {
    expect(case01.planningOutput(1).rule_checks?.overall).toBe("pass");
  });
});

describe("Case 2 fixture", () => {
  it("matches contracts", () => {
    EventBrief.parse(case02.brief);
    EvidenceSnapshot.parse(case02.snapshot("evt-2", 1));
    PlanningOutput.parse(case02.planningOutput(1));
    LogisticsOutput.parse(case02.logisticsOutput(1));
    WorkoutOutput.parse(case02.workoutOutput(1));
    ReviewerOutput.parse(case02.reviewerOutput(1));
  });
  it("blocks the original plan and keeps combined options unresolved", () => {
    expect(case02.planningOutput(1).rule_checks?.overall).toBe("fail");
    const review = case02.reviewerOutput(1);
    expect(review.status).toBe("needs_verification");
    expect(review.recommendation).toBeNull();
    for (const o of review.ranked_options) expect(o.checks.overall).toBe("unknown");
  });
  it("only references evidence IDs that exist in the snapshot", () => {
    const ids = new Set(case02.snapshot("evt-2", 1).items.map((e) => e.id));
    const review = case02.reviewerOutput(1);
    for (const o of review.ranked_options) {
      for (const id of o.evidence_ids) expect(ids).toContain(id);
    }
  });
});
