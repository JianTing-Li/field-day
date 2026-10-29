import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanVersion } from "@/contracts";
import { BlockersCard } from "./sections";

const concern = { id: "c1", description: "Template pending instructor review", blocking: true, related_check_ids: [] };

function card(status: PlanVersion["status"]) {
  const version = { status, concerns: [concern], organizer_tasks: [] } as unknown as PlanVersion;
  return renderToStaticMarkup(createElement(BlockersCard, { version, snapshot: null }));
}

describe("BlockersCard (D-JT23-1)", () => {
  it("calls the agent's concerns notes to review on a version ready for approval", () => {
    const html = card("ready_for_approval");
    expect(html).toContain("Review before approving");
    expect(html).toContain("can be approved");
    expect(html).not.toContain("What&#x27;s blocking this plan");
    expect(html).toContain("Template pending instructor review");
  });

  it("keeps them as blockers when the version needs verification", () => {
    const html = card("needs_verification");
    expect(html).toContain("What&#x27;s blocking this plan");
    expect(html).toContain("Blocking: ");
  });
});

describe("BlockersCard to-dos", () => {
  const task = (id: string, park_id: string) => ({
    id,
    description: `Confirm space at ${park_id}`,
    resolves_check_id: "space_surface.space" as const,
    park_id,
    start_time: "2026-07-16T08:00",
  });
  const version = {
    status: "needs_verification",
    concerns: [],
    plan: { park_id: "park-a", start_time: "2026-07-16T08:00" },
    checks: { blockers: ["space_surface.space"] },
    organizer_tasks: [task("t-a", "park-a"), task("t-b", "park-b")],
  } as unknown as PlanVersion;

  it("puts tasks that unblock this plan first, and other parks' tasks under Good to know", () => {
    const html = renderToStaticMarkup(createElement(BlockersCard, { version, snapshot: null }));
    const must = html.indexOf("Must do before approving");
    const good = html.indexOf("Good to know");
    expect(must).toBeGreaterThan(-1);
    expect(good).toBeGreaterThan(must);
    expect(html.indexOf("Confirm space at park-a")).toBeLessThan(good);
    expect(html.indexOf("Confirm space at park-b")).toBeGreaterThan(good);
  });
});

describe("BlockersCard done tasks", () => {
  it("shows a confirmed task as done, without a Confirm button", () => {
    const version = {
      status: "needs_verification",
      concerns: [],
      plan: { park_id: "park-a", start_time: "2026-07-16T08:00" },
      checks: { blockers: [], checks: [{ check_id: "space_surface.space", status: "pass" }] },
      organizer_tasks: [
        { id: "t1", description: "Confirm space", resolves_check_id: "space_surface.space", park_id: "park-a", start_time: "2026-07-16T08:00" },
      ],
    } as unknown as PlanVersion;
    const html = renderToStaticMarkup(
      createElement(BlockersCard, { version, snapshot: null, taskAction: () => createElement("button", null, "Confirm") }),
    );
    expect(html).toContain(">Done</h3>");
    expect(html).not.toContain(">Confirm</button>");
  });
});

describe("BlockersCard settled concerns", () => {
  it("hides a blocking concern once its check passes", () => {
    const version = {
      status: "needs_verification",
      plan: { park_id: "park-a", start_time: "2026-07-16T08:00" },
      concerns: [
        { id: "c1", description: "Space is not confirmed", blocking: true, related_check_ids: ["space_surface.space"] },
        { id: "c2", description: "No air-quality forecast", blocking: true, related_check_ids: ["air_quality.max_aqi"] },
      ],
      checks: {
        blockers: ["air_quality.max_aqi"],
        checks: [
          { check_id: "space_surface.space", status: "pass" },
          { check_id: "air_quality.max_aqi", status: "unknown" },
        ],
      },
      organizer_tasks: [],
    } as unknown as PlanVersion;
    const html = renderToStaticMarkup(createElement(BlockersCard, { version, snapshot: null }));
    expect(html).not.toContain("Space is not confirmed");
    expect(html).toContain("No air-quality forecast");
  });
});
