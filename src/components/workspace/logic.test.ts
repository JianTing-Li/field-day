import { describe, expect, it } from "vitest";
import { CheckId, LifecycleStatus, type CheckResult, type PlanVersion } from "@/contracts";
import { case02 } from "@fixtures/scenarios";
import {
  adaptationName,
  approveBlockedReason,
  availableActions,
  checkName,
  finalizeKey,
  formatLocal,
  parkName,
  sortChecks,
  templateName,
} from "./logic";

const snapshot = case02.snapshot("evt", 1);
const base: PlanVersion = {
  version: 2,
  based_on_version: 1,
  created_at: "2026-10-28T18:00:00Z",
  source: "planning",
  status: "needs_verification",
  plan: case02.planningOutput(1).plan,
  evidence_snapshot_id: snapshot.id,
  checks: null,
  facts: [],
  concerns: [],
  organizer_tasks: [],
  alternatives: null,
};
const at = (status: PlanVersion["status"], plan = base.plan): PlanVersion => ({ ...base, status, plan });

describe("availableActions", () => {
  it("only offers Approve on a ready version and Finalize on an approved one", () => {
    for (const s of LifecycleStatus.options) {
      const a = availableActions(at(s));
      expect(a.approve).toBe(s === "ready_for_approval");
      expect(a.finalize).toBe(s === "approved");
    }
  });

  it("offers only Generate (and Edit brief) before there is a plan", () => {
    const a = availableActions(at("draft", null));
    expect(a).toMatchObject({ generate: true, editBrief: true, recheck: false, reportChange: false, requestReview: false, confirm: false });
  });

  it("never offers changes or confirmations on a finalized version", () => {
    const a = availableActions(at("finalized"));
    expect(a).toMatchObject({ reportChange: false, requestReview: false, confirm: false, approve: false });
  });
});

describe("approveBlockedReason", () => {
  it("explains every status except ready_for_approval", () => {
    for (const s of LifecycleStatus.options) {
      const reason = approveBlockedReason(at(s));
      if (s === "ready_for_approval") expect(reason).toBeNull();
      else expect(reason).toBeTruthy();
    }
  });
});

describe("sortChecks", () => {
  it("puts failures first, then unknowns, then passes; critical before advisory", () => {
    const c = (check_id: CheckResult["check_id"], status: CheckResult["status"], critical = true) =>
      ({ check_id, status, critical }) as CheckResult;
    const sorted = sortChecks([
      c("duration.fits", "pass"),
      c("permissions.permit_review", "unknown", false),
      c("space_surface.space", "unknown"),
      c("heat.max_temperature", "fail"),
    ]);
    expect(sorted.map((x) => x.check_id)).toEqual([
      "heat.max_temperature",
      "space_surface.space",
      "permissions.permit_review",
      "duration.fits",
    ]);
  });
});

describe("names", () => {
  it("has a plain name for every check", () => {
    for (const id of CheckId.options) expect(checkName(id)).not.toBe(id);
  });

  it("looks up parks, templates and adaptations in the snapshot, falling back to the ID", () => {
    expect(parkName(snapshot, "park-a")).toBe(snapshot.park_candidates[0].name);
    expect(parkName(snapshot, "park-zzz")).toBe("park-zzz");
    expect(parkName(snapshot, null)).toBe("No park yet");
    expect(templateName(snapshot, "tpl-run-intervals-45")).toBe("Beginner walk-run intervals");
    expect(adaptationName(snapshot, "tpl-run-intervals-45", "adapt-stationary-circuit")).toContain("stationary circuit");
  });
});

describe("formatLocal", () => {
  it("shows New York local times without converting them", () => {
    expect(formatLocal("2026-07-16T10:00")).toBe("Thu, Jul 16 · 10:00 AM");
    expect(formatLocal("2026-07-16T00:30")).toBe("Thu, Jul 16 · 12:30 AM");
    expect(formatLocal("2026-07-16T13:05")).toBe("Thu, Jul 16 · 1:05 PM");
    expect(formatLocal(null)).toBe("No time yet");
  });
});

describe("finalizeKey", () => {
  it("is the same for repeats of one version and different across versions", () => {
    expect(finalizeKey("evt-1", 3)).toBe(finalizeKey("evt-1", 3));
    expect(finalizeKey("evt-1", 3)).not.toBe(finalizeKey("evt-1", 4));
  });
});

describe("applyOption", () => {
  it("is offered only when the current version has alternatives", () => {
    expect(availableActions(at("needs_verification")).applyOption).toBe(false);
    const review = case02.reviewerOutput(1);
    expect(availableActions({ ...at("needs_verification"), alternatives: review }).applyOption).toBe(true);
  });
});
