import { describe, expect, it } from "vitest";
import { case01 } from "@fixtures/scenarios";
import { POST } from "./route";

const post = (brief: unknown) =>
  POST(new Request("http://test/api/events", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" }, body: JSON.stringify({ brief }) }));

describe("POST /api/events (JT-25)", () => {
  it("refuses an out-of-range brief before it counts against the creation limit", async () => {
    const past = { ...case01.brief, date: "2020-01-01" };
    for (let i = 0; i < 25; i++) expect((await post(past)).status).toBe(400);
    const date = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    expect((await post({ ...case01.brief, date })).status).toBe(200);
  });
});
