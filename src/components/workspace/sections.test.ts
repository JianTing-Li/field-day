import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { case02 } from "@fixtures/scenarios";
import type { FieldDayEvent, PlanVersion } from "@/contracts";
import { SuggestedFix } from "./Alternatives";
import { SomethingChanged } from "./Disruptions";
import { problemLines } from "./logic";
import { PlanSummary } from "./NextStep";
import { HowWeChecked } from "./sections";

const snapshot = case02.snapshot("evt", 2);
const out = case02.planningOutput(2);
const version = {
  version: 2,
  status: "needs_verification",
  plan: out.plan,
  checks: out.rule_checks,
  concerns: [],
  organizer_tasks: [],
  facts: [],
  alternatives: case02.reviewerOutput(2),
} as unknown as PlanVersion;
const event = {
  id: "evt",
  brief: case02.brief,
  updated_at: "2026-10-29T19:00:00Z",
  finalized: null,
} as unknown as FieldDayEvent;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("event page in plain words (JT-24)", () => {
  it("says what's wrong in the summary, without opening the alternatives", () => {
    const lines = problemLines(version, snapshot);
    expect(lines.some((l) => l.startsWith("Too hot:"))).toBe(true);
    const summary = html(
      createElement(PlanSummary, {
        event,
        version,
        snapshot,
        step: { tone: "warning", title: "x", body: "y", action: "alternatives", label: "See alternatives" },
        busy: null,
        onAction: () => {},
        problems: lines,
      }),
    );
    expect(summary).toContain("This plan won&#x27;t work as it is");
    expect(summary).toContain("Too hot:");
  });

  it("puts one suggested fix up front and the rest behind one button", () => {
    const fix = html(createElement(SuggestedFix, { version, snapshot, busy: false, canApply: true, onApply: () => {} }));
    expect(fix).toContain("Suggested fix");
    expect(fix.match(/Use this plan/g)).toHaveLength(1);
    expect(fix).toContain("Other options (1)");
  });

  it("shows check results as OK, Problem or To check, never a question mark", () => {
    const checks = html(createElement(HowWeChecked, { checks: version.checks, snapshot }));
    expect(checks).toContain("How we checked");
    expect(checks).toMatch(/Problem|OK|To check/);
    expect(checks).not.toContain("?");
    expect(checks).not.toContain("Unknown");
  });

  it("offers every kind of change right on the page, including rain", () => {
    const changed = html(
      createElement(SomethingChanged, {
        event,
        version,
        snapshot,
        busy: false,
        onReport: async () => true,
        onEditBrief: async () => true,
        onRemove: () => {},
      }),
    );
    for (const label of ["Space is closed", "Ground is wet or unsafe", "Rain or storm", "Time doesn&#x27;t work", "Equipment missing", "Group size changed", "Something else"]) {
      expect(changed).toContain(label);
    }
  });
});
