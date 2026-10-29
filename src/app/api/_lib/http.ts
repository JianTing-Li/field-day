import type { z } from "zod";
import type { ApiError } from "@/contracts";
import { ServiceError, type ServiceErrorCode } from "@/server/lifecycle/errors";

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

/** Parses the JSON body with a contract schema, runs the handler, and maps errors. */
export async function handle<S extends z.ZodType, R>(
  request: Request,
  schema: S,
  run: (body: z.infer<S>) => Promise<R>,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse("invalid_request", "Request body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return errorResponse("invalid_request", "Invalid request", parsed.error.issues);
  return respond(() => run(parsed.data));
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
