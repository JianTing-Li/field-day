import { describe, expect, it } from "vitest";
import { LOGISTICS_SCHEMA_JSON, ReviewerModelOutput, REVIEWER_SCHEMA_JSON } from "./model-output";

const plan = {
  park_time_candidate_id: "cand-park-a-0800",
  park_id: "park-a",
  start_time: "2026-07-16T08:00",
  time_zone: "America/New_York",
  duration_minutes: 45,
  workout_template_id: "tpl-bodyweight-45",
  adaptation_ids: [],
  session_outline: ["Warm-up"],
};

describe("model output schemas (D-JT24-3)", () => {
  it("accepts a Reviewer answer without checks and fills a pending placeholder", () => {
    const parsed = ReviewerModelOutput.parse({
      event_version: 3,
      evidence_snapshot_id: "snap-x",
      status: "needs_verification",
      ranked_options: [
        {
          combined_option_id: "combo-1",
          logistics_option_id: null,
          workout_option_id: null,
          park_time_candidate_id: "cand-park-a-0800",
          plan,
          changes_from_original: [],
          tradeoffs: [],
          evidence_ids: [],
          unknowns: [],
        },
      ],
      recommendation: null,
      revision_requests: [],
      blocking_issues: [],
      organizer_tasks: [],
    });
    expect(parsed.ranked_options[0].checks).toEqual({
      event_version: 3,
      evidence_snapshot_id: "snap-x",
      overall: "unknown",
      checks: [],
      blockers: [],
    });
  });

  it("never shows the model a checks field to fill", () => {
    expect(REVIEWER_SCHEMA_JSON).not.toContain('"checks"');
    expect(LOGISTICS_SCHEMA_JSON).not.toContain('"checks"');
  });
});
