import { describe, expect, it } from "vitest";
import { LifecycleStatus, type CheckPlanResult, type PlanVersion } from "@/contracts";
import { case01 } from "@fixtures/scenarios";
import {
  ACTION_FROM,
  TRANSITIONS,
  assertCanStart,
  deriveStatus,
  transition,
  type LifecycleAction,
} from "./transitions";

const STATUSES = LifecycleStatus.options;
const ACTIONS: LifecycleAction[] = [...(Object.keys(ACTION_FROM) as LifecycleAction[]), "invalidate_approval"];

function version(status: PlanVersion["status"]): PlanVersion {
  return {
    version: 2,
    based_on_version: 1,
    created_at: "2026-10-28T12:00:00Z",
    source: "planning",
    status,
    plan: null,
    evidence_snapshot_id: null,
    checks: { event_version: 2, evidence_snapshot_id: "snap", overall: "unknown", checks: [], blockers: ["space_surface.space"] },
    facts: [],
    concerns: [],
    organizer_tasks: [],
    alternatives: null,
  };
}

describe("transition table", () => {
  it("allows exactly the listed in-place transitions", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        for (const action of ACTIONS) {
          const allowed = TRANSITIONS.some((t) => t.from === from && t.to === to && t.action === action);
          const v = version(from);
          if (allowed) {
            transition(v, to, action);
            expect(v.status).toBe(to);
          } else {
            expect(() => transition(v, to, action)).toThrow(expect.objectContaining({ code: "invalid_request" }));
            expect(v.status).toBe(from);
          }
        }
      }
    }
  });

  it("never leaves finalized", () => {
    expect(TRANSITIONS.filter((t) => t.from === "finalized")).toEqual([]);
  });
});

describe("assertCanStart", () => {
  it("blocks approving needs_verification with the blockers", () => {
    expect(() => assertCanStart("approve", version("needs_verification"))).toThrow(
      expect.objectContaining({ code: "blocked", details: ["space_surface.space"] }),
    );
  });

  it("rejects actions that cannot start from a status", () => {
    for (const action of Object.keys(ACTION_FROM) as (keyof typeof ACTION_FROM)[]) {
      for (const status of STATUSES) {
        const v = version(status);
        if (ACTION_FROM[action].includes(status)) {
          expect(() => assertCanStart(action, v)).not.toThrow();
        } else if (!(action === "approve" && status === "needs_verification")) {
          expect(() => assertCanStart(action, v)).toThrow(expect.objectContaining({ code: "invalid_request" }));
        }
      }
    }
  });

  it("keeps the finalized version read-only except for new versions", () => {
    const f = version("finalized");
    // report_change is allowed: it adds a new version and leaves the finalized one as it was (D-JT24-12).
    for (const action of ["add_confirmation", "approve", "request_review"] as const) {
      expect(() => assertCanStart(action, f)).toThrow(/finalized/);
    }
  });
});

describe("deriveStatus", () => {
  const out = case01.planningOutput(2);
  const pass = out.rule_checks!;
  const unknown: CheckPlanResult = { ...pass, overall: "unknown", blockers: ["space_surface.space"] };

  it("no plan is a draft", () => {
    expect(deriveStatus(null, null)).toBe("draft");
  });
  it("passing checks are ready for approval", () => {
    expect(deriveStatus(out.plan, pass, "draft")).toBe("ready_for_approval");
  });
  it("unknown or failed checks need verification", () => {
    expect(deriveStatus(out.plan, unknown)).toBe("needs_verification");
    expect(deriveStatus(out.plan, { ...pass, overall: "fail" })).toBe("needs_verification");
    expect(deriveStatus(out.plan, null)).toBe("needs_verification");
  });
  it("passing checks win over the agent's status (D-JT23-1)", () => {
    expect(deriveStatus(out.plan, pass, "needs_verification")).toBe("ready_for_approval");
    expect(deriveStatus(out.plan, pass, "no_feasible_option")).toBe("ready_for_approval");
  });
  it("keeps the agent's no_feasible_option when the checks don't pass", () => {
    expect(deriveStatus(out.plan, { ...pass, overall: "fail" }, "no_feasible_option")).toBe("no_feasible_option");
    expect(deriveStatus(out.plan, unknown, "no_feasible_option")).toBe("no_feasible_option");
    expect(deriveStatus(null, null, "no_feasible_option")).toBe("no_feasible_option");
  });
  it("never lets the agent's draft make unknown checks ready", () => {
    expect(deriveStatus(out.plan, unknown, "draft")).toBe("needs_verification");
  });
});
