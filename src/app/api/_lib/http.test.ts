import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "@/contracts";
import { handleAgentRun, MAX_BODY_BYTES, parseBody } from "./http";
import { createRateLimiter } from "./rate-limit";

const Body = z.object({ version: z.number().int().positive() });
const post = (body: string, ip = "1.1.1.1") =>
  new Request("http://localhost/api", { method: "POST", body, headers: { "x-forwarded-for": ip } });

describe("parseBody (F-09)", () => {
  it("refuses a body over the size limit before parsing it", async () => {
    const r = await parseBody(post(JSON.stringify({ version: 1, pad: "x".repeat(MAX_BODY_BYTES) })), Body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(ApiError.parse(await r.response.json()).error.message).toBe("Request is too large");
  });

  it("returns the parsed body when it is valid", async () => {
    expect(await parseBody(post('{"version":2}'), Body)).toEqual({ ok: true, data: { version: 2 } });
  });
});

describe("handleAgentRun (F-08)", () => {
  it("never spends an agent run on a malformed request", async () => {
    const limiter = createRateLimiter({ per_visitor_per_hour: 1, global_per_day: 100 });
    let ran = 0;
    const run = async () => {
      ran++;
      return { ok: true };
    };
    for (let i = 0; i < 5; i++) {
      expect((await handleAgentRun(post("garbage"), Body, run, { limiter, real: true })).status).toBe(400);
    }
    expect((await handleAgentRun(post('{"version":1}'), Body, run, { limiter, real: true })).status).toBe(200);
    expect((await handleAgentRun(post('{"version":1}'), Body, run, { limiter, real: true })).status).toBe(429);
    expect(ran).toBe(1);
  });
});
