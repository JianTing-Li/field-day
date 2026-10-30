import type { ApiError } from "@/contracts";
import { agentMode } from "@/server/orchestrator/agents";

/**
 * Agent-run rate limit for the public demo (owner: JT, task JT-19, D-JT19-1). Applies only when
 * FIELDDAY_AGENTS=real, because only real agents spend Anthropic credits.
 *
 * Counts live in memory, per server instance: a new instance starts at zero. At demo traffic one
 * instance serves nearly every request, and the spend limit on the Anthropic workspace backs it up.
 */

export interface RateLimits {
  per_visitor_per_hour: number;
  global_per_day: number;
}

export const AGENT_RUN_LIMITS: RateLimits = {
  /** Agent runs per visitor (IP address) in any rolling hour. */
  per_visitor_per_hour: 18,
  /** Agent runs for everyone together since the start of the current UTC day. */
  global_per_day: 180,
};

const HOUR_MS = 3_600_000;

export interface RateLimiter {
  /** Records one run for `visitor` at `now` if it is allowed; otherwise says when to retry. */
  take(visitor: string, now: number): { ok: true } | { ok: false; retry_after_s: number; reason: string };
}

/** New events per visitor and per day, in every mode: creating is free, so it's the cheap way to fill the database (F-09). */
export const EVENT_CREATION_LIMITS: RateLimits = { per_visitor_per_hour: 20, global_per_day: 300 };

/** `what` names the counted thing in the refusal message, e.g. "agent runs". */
export function createRateLimiter(limits: RateLimits = AGENT_RUN_LIMITS, what = "agent runs"): RateLimiter {
  const runs = new Map<string, number[]>();
  let day = "";
  let dayCount = 0;
  return {
    take(visitor, now) {
      const today = new Date(now).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        dayCount = 0;
      }
      if (dayCount >= limits.global_per_day) {
        const nextDay = Date.parse(`${today}T00:00:00Z`) + 24 * HOUR_MS;
        return {
          ok: false,
          retry_after_s: Math.ceil((nextDay - now) / 1000),
          reason: `The demo has used today's ${limits.global_per_day} ${what}. Try again tomorrow (UTC).`,
        };
      }
      const recent = (runs.get(visitor) ?? []).filter((t) => t > now - HOUR_MS);
      if (recent.length >= limits.per_visitor_per_hour) {
        runs.set(visitor, recent);
        const retry = Math.ceil((recent[0] + HOUR_MS - now) / 1000);
        return {
          ok: false,
          retry_after_s: retry,
          reason: `You've used ${limits.per_visitor_per_hour} ${what} in the last hour. Try again in ${Math.ceil(retry / 60)} min.`,
        };
      }
      recent.push(now);
      runs.set(visitor, recent);
      dayCount += 1;
      return { ok: true };
    },
  };
}

/** The visitor's IP address. Vercel puts the client address first in x-forwarded-for. */
export function visitorOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

const globalForLimiter = globalThis as unknown as {
  __fieldDayRateLimiter?: RateLimiter;
  __fieldDayCreateLimiter?: RateLimiter;
};

function limiter(): RateLimiter {
  globalForLimiter.__fieldDayRateLimiter ??= createRateLimiter();
  return globalForLimiter.__fieldDayRateLimiter;
}

function createLimiter(): RateLimiter {
  globalForLimiter.__fieldDayCreateLimiter ??= createRateLimiter(EVENT_CREATION_LIMITS, "new events");
  return globalForLimiter.__fieldDayCreateLimiter;
}

function refused(r: { retry_after_s: number; reason: string }): Response {
  const body: ApiError = { error: { code: "rate_limited", message: r.reason } };
  return Response.json(body, { status: 429, headers: { "Retry-After": String(r.retry_after_s) } });
}

/** Wraps event creation with its own limit, in stub and real mode alike. */
export async function limitEventCreation(
  request: Request,
  run: () => Promise<Response>,
  deps: { limiter?: RateLimiter; now?: () => number } = {},
): Promise<Response> {
  const r = (deps.limiter ?? createLimiter()).take(visitorOf(request), (deps.now ?? Date.now)());
  return r.ok ? run() : refused(r);
}

/**
 * Wraps a route that runs agents. With real agents, a visitor over the limit gets 429
 * `rate_limited` and nothing runs; with stub agents the route runs unchecked.
 */
export async function limitAgentRuns(
  request: Request,
  run: () => Promise<Response>,
  deps: { limiter?: RateLimiter; now?: () => number; real?: boolean } = {},
): Promise<Response> {
  if (!(deps.real ?? agentMode() === "real")) return run();
  const r = (deps.limiter ?? limiter()).take(visitorOf(request), (deps.now ?? Date.now)());
  return r.ok ? run() : refused(r);
}
