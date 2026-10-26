import { describe, expect, it } from "vitest";
import { case01 } from "@fixtures/scenarios";
import type { CheckResult } from "@/contracts";
import { checkPlan, summarizeChecks } from "./check-plan";

const assessed = { park_id: "park-a", start_time: "2026-10-29T09:00", workout_template_id: "t" };
const c = (status: CheckResult["status"], critical = true): CheckResult => ({
  check_id: `x.${status}.${critical}`,
  area: "heat",
  status,
  critical,
  reason: "test",
  evidence_ids: [],
  policy_version: "test",
  assessed,
});

describe("summarizeChecks", () => {
  it("passes only when all critical checks pass", () => {
    expect(summarizeChecks(1, "s", [c("pass"), c("fail", false)]).overall).toBe("pass");
  });
  it("is unknown when a critical check is unknown", () => {
    const r = summarizeChecks(1, "s", [c("pass"), c("unknown")]);
    expect(r.overall).toBe("unknown");
    expect(r.blockers).toEqual(["x.unknown.true"]);
  });
  it("fails when any critical check fails", () => {
    expect(summarizeChecks(1, "s", [c("unknown"), c("fail")]).overall).toBe("fail");
  });
});

describe("checkPlan with placeholder rules", () => {
  it("blocks (unknown) until rule modules are implemented", () => {
    const out = checkPlan({
      plan: case01.planningOutput(1).plan,
      brief: case01.brief,
      snapshot: case01.snapshot("evt", 1),
      event_version: 1,
    });
    expect(out.overall).toBe("unknown");
    expect(out.evidence_snapshot_id).toBe(case01.SNAPSHOT_ID);
  });
});
