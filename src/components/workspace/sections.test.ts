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
