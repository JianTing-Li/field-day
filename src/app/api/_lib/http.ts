import type { z } from "zod";
import type { ApiError } from "@/contracts";
import { ServiceError, type ServiceErrorCode } from "@/server/lifecycle/errors";
import { limitAgentRuns } from "./rate-limit";

const STATUS: Record<ServiceErrorCode, number> = {
  invalid_request: 400,
  not_found: 404,
  stale_version: 409,
  blocked: 409,
  budget_exhausted: 429,
  rate_limited: 429,
  upstream_unavailable: 503,
  internal: 500,
};

function errorResponse(code: ServiceErrorCode, message: string, details?: unknown) {
  const body: ApiError = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  return Response.json(body, { status: STATUS[code] });
}

/** Largest request body any route accepts (F-09). A full brief is about 1 KB. */
export const MAX_BODY_BYTES = 32_000;

/** Reads the JSON body and checks it with a contract schema; on failure, the error response to send. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse("invalid_request", "Request is too large") };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse("invalid_request", "Request is too large") };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: errorResponse("invalid_request", "Request body must be JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: errorResponse("invalid_request", "Invalid request", parsed.error.issues) };
  return { ok: true, data: parsed.data };
}

/** Parses the JSON body with a contract schema, runs the handler, and maps errors. */
export async function handle<S extends z.ZodType, R>(
  request: Request,
  schema: S,
  run: (body: z.infer<S>) => Promise<R>,
): Promise<Response> {
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  return respond(() => run(body.data));
}

/**
 * Like handle, for routes that run agents: the body is checked first, and only a valid request
 * takes one of the visitor's agent runs (F-08). A malformed request never uses up the quota.
 */
export async function handleAgentRun<S extends z.ZodType, R>(
  request: Request,
  schema: S,
  run: (body: z.infer<S>) => Promise<R>,
  deps?: Parameters<typeof limitAgentRuns>[2],
): Promise<Response> {
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  return limitAgentRuns(request, () => respond(() => run(body.data)), deps);
}

/** Runs a handler with no request body and maps errors. */
export async function respond<R>(run: () => Promise<R>): Promise<Response> {
  try {
    return Response.json(await run());
  } catch (e) {
    if (e instanceof ServiceError) return errorResponse(e.code, e.message, e.details);
    console.error(e);
    return errorResponse("internal", "Unexpected server error");
  }
}
