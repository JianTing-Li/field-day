import { describe, expect, it } from "vitest";
import { ApiError } from "@/contracts";
import { createRateLimiter, limitAgentRuns, visitorOf } from "./rate-limit";

const T0 = Date.parse("2026-10-29T12:00:00Z");
const HOUR = 3_600_000;
const req = (ip?: string) => new Request("http://localhost/api", { headers: ip ? { "x-forwarded-for": ip } : {} });

describe("createRateLimiter (D-JT19-1)", () => {
  it("allows 10 runs per visitor per rolling hour, then says when to retry", () => {
    const l = createRateLimiter();
    for (let i = 0; i < 10; i++) expect(l.take("a", T0 + i * 1000).ok).toBe(true);
    const r = l.take("a", T0 + 20_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retry_after_s).toBe(HOUR / 1000 - 20);
    expect(l.take("a", T0 + HOUR + 1).ok).toBe(true);
  });

  it("counts each visitor separately", () => {
    const l = createRateLimiter();
    for (let i = 0; i < 10; i++) l.take("a", T0);
    expect(l.take("a", T0).ok).toBe(false);
    expect(l.take("b", T0).ok).toBe(true);
  });

  it("stops everyone after the daily cap, and resets at the next UTC day", () => {
    const l = createRateLimiter({ per_visitor_per_hour: 10, global_per_day: 3 });
    expect(l.take("a", T0).ok).toBe(true);
    expect(l.take("b", T0).ok).toBe(true);
    expect(l.take("c", T0).ok).toBe(true);
    const r = l.take("d", T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("today's 3 agent runs");
    expect(l.take("d", Date.parse("2026-10-30T00:00:01Z")).ok).toBe(true);
  });

  it("does not count a refused run", () => {
    const l = createRateLimiter({ per_visitor_per_hour: 1, global_per_day: 2 });
    expect(l.take("a", T0).ok).toBe(true);
    expect(l.take("a", T0).ok).toBe(false);
    expect(l.take("b", T0).ok).toBe(true);
  });
});

describe("visitorOf", () => {
  it("uses the first x-forwarded-for address", () => {
    expect(visitorOf(req("203.0.113.5, 10.0.0.1"))).toBe("203.0.113.5");
    expect(visitorOf(req())).toBe("unknown");
  });
});

describe("limitAgentRuns", () => {
  const ok = async () => Response.json({ ran: true });

  it("runs the route without counting when agents are stubs", async () => {
    const limiter = createRateLimiter({ per_visitor_per_hour: 0, global_per_day: 0 });
    const res = await limitAgentRuns(req("1.1.1.1"), ok, { limiter, real: false });
    expect(res.status).toBe(200);
  });

  it("answers 429 rate_limited with Retry-After and skips the route when over the limit", async () => {
    const limiter = createRateLimiter({ per_visitor_per_hour: 1, global_per_day: 100 });
    let ran = 0;
    const route = async () => {
      ran++;
      return ok();
    };
    expect((await limitAgentRuns(req("1.1.1.1"), route, { limiter, real: true, now: () => T0 })).status).toBe(200);
    const res = await limitAgentRuns(req("1.1.1.1"), route, { limiter, real: true, now: () => T0 + 1000 });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(HOUR / 1000 - 1));
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe("rate_limited");
    expect(ran).toBe(1);
  });
});
