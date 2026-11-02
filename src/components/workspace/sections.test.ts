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

  it("shows every option side by side, FieldDay's pick first, with what each one changes (JT-28)", () => {
    const fix = html(createElement(SuggestedFix, { version, snapshot, busy: false, canApply: true, onApply: () => {} }));
    expect(fix).toContain("Best fix");
    expect(fix).toContain("Option 2");
    expect(fix).not.toContain("Other options");
    expect(fix).toContain("8:00 AM, not 10:00 AM");
    expect(fix).not.toContain("(placeholder)");
    expect(fix).not.toContain("organizer priority");
  });

  it("puts each forecast number next to its limit, with an icon that matches the rain (JT-28)", () => {
    const summary = html(
      createElement(PlanSummary, {
        event,
        version,
        snapshot,
        step: { tone: "warning", title: "x", body: "y", action: null, label: null },
        busy: null,
        onAction: () => {},
      }),
    );
    expect(summary).toContain("limit 40%");
    expect(summary).toContain("limit 90°F");
  });

  it("shows check results as OK, Problem or To check, never a question mark", () => {
    const checks = html(createElement(HowWeChecked, { checks: version.checks, snapshot }));
    expect(checks).toContain("How we checked");
    expect(checks).toMatch(/Problem|OK|To check/);
    expect(checks).not.toContain("?");
    expect(checks).not.toContain("Unknown");
  });

  it("takes changes in the organizer's own words, with shortcuts for the common ones (JT-28)", () => {
    const changed = html(
      createElement(SomethingChanged, {
        event,
        version,
        snapshot,
        busy: false,
        onRead: async () => ({ ok: true as const, items: [] }),
        onApply: async () => true,
        onRemove: () => {},
      }),
    );
    expect(changed).toContain("as many things as you like");
    for (const label of ["Space is closed", "Ground is wet", "Rain or storm", "New time", "Equipment missing", "Group size changed"]) {
      expect(changed).toContain(label);
    }
    expect(changed).toContain("Nothing changes until you confirm");
  });
});
