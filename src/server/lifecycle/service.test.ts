import { describe, expect, it } from "vitest";
import * as svc from "./service";

describe("stub lifecycle service", () => {
  it("seeds Case 1 (ready) and Case 2 (blocked)", async () => {
    const { events } = await svc.listEvents();
    const byId = Object.fromEntries(events.map((e) => [e.id, e.status]));
    expect(byId["evt-case-01"]).toBe("ready_for_approval");
    expect(byId["evt-case-02"]).toBe("needs_verification");
  });

  it("walks Case 2 from conflict review to a single finalized event", async () => {
    let { event } = await svc.getEvent("evt-case-02");

    ({ event } = await svc.requestReview(event.id, { version: event.current_version }));
    const review = event.versions.at(-1)!.alternatives!;
    expect(review.status).toBe("needs_verification");

    ({ event } = await svc.applyOption(event.id, {
      version: event.current_version,
      combined_option_id: "combo-1",
    }));
    expect(event.versions.at(-1)!.status).toBe("needs_verification");

    await expect(
      svc.approve(event.id, {
        version: event.current_version,
        evidence_snapshot_id: event.versions.at(-1)!.evidence_snapshot_id!,
      }),
    ).rejects.toMatchObject({ code: "blocked" });

    // A confirmation for Astoria Park must not resolve the McCarren Park check.
    ({ event } = await svc.addConfirmation(event.id, {
      version: event.current_version,
      check_id: "space_surface.space",
      park_id: "park-q004",
      start_time: null,
      statement: "Astoria Park lawn is open",
      note: null,
    }));
    expect(event.versions.at(-1)!.status).toBe("needs_verification");

    ({ event } = await svc.addConfirmation(event.id, {
      version: event.current_version,
      check_id: "space_surface.space",
      park_id: "park-b058",
      start_time: "2026-07-16T08:00",
      statement: "Open lawn fits 18 people",
      note: null,
    }));
    expect(event.versions.at(-1)!.status).toBe("ready_for_approval");

    ({ event } = await svc.approve(event.id, {
      version: event.current_version,
      evidence_snapshot_id: event.versions.at(-1)!.evidence_snapshot_id!,
    }));

    const first = await svc.finalize(event.id, { version: event.current_version, idempotency_key: "k1" });
    const again = await svc.finalize(event.id, { version: event.current_version, idempotency_key: "k2" });
    expect(first.finalized).toBe(true);
    expect(again.finalized).toBe(true);
    expect(again.event.finalized?.finalized_at).toBe(first.event.finalized?.finalized_at);
  });

  it("rejects actions on an outdated version", async () => {
    const { event } = await svc.getEvent("evt-case-01");
    await expect(svc.generateDraft(event.id, { version: 1 })).rejects.toMatchObject({
      code: "stale_version",
    });
  });
});
