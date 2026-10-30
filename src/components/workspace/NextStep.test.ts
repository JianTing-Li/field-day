import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FieldDayEvent, PlanVersion } from "@/contracts";
import { PlanSummary } from "./NextStep";

const version = { version: 1, status: "draft", plan: null } as unknown as PlanVersion;
const event = { brief: { group_size: 12 }, updated_at: "2026-10-29T19:00:00Z", finalized: null } as unknown as FieldDayEvent;
const step = { tone: "neutral" as const, title: "Start with a plan", body: "…", action: "generate" as const, label: "Draft a plan" };

function render(busy: string | null) {
  return renderToStaticMarkup(createElement(PlanSummary, { event, version, snapshot: null, step, busy, onAction: () => {} }));
}

describe("PlanSummary while FieldDay works", () => {
  it("shows what is happening and how long it usually takes, instead of the button", () => {
    const html = render("Drafting a plan");
    expect(html).toContain("Drafting a plan…");
    expect(html).toContain("0:00");
    expect(html).toContain("Usually 20 to 90 seconds");
    expect(html).toContain('aria-live="polite"');
  });

  it("shows the next-step button when idle", () => {
    const html = render(null);
    expect(html).toContain(">Draft a plan</button>");
    expect(html).not.toContain("Usually");
  });
});
