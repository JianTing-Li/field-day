import type { z } from "zod";
import { ApiError } from "@/contracts";

/**
 * Browser-side calls to the FieldDay API (owner: Yadan). Every response is checked against its
 * contract, so the UI never renders data in a shape it doesn't expect.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number | null;
      code: ApiError["error"]["code"] | "network" | "bad_response";
      message: string;
      /** Extra information from the API, e.g. the blocking check IDs for "blocked". */
      details?: unknown;
    };

export function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<ApiResult<z.infer<S>>> {
  return apiRequest(path, schema);
}

/** POST/PUT a JSON body. */
export function apiSend<S extends z.ZodType>(
  method: "POST" | "PUT",
  path: string,
  body: unknown,
  schema: S,
): Promise<ApiResult<z.infer<S>>> {
  return apiRequest(path, schema, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function apiRequest<S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}): Promise<ApiResult<z.infer<S>>> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init, headers: { Accept: "application/json", ...init.headers } });
  } catch {
    return { ok: false, status: null, code: "network", message: "Could not reach the FieldDay server" };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Handled below as a bad response.
  }

  if (!res.ok) {
    const err = ApiError.safeParse(body);
    return err.success
      ? {
          ok: false,
          status: res.status,
          code: err.data.error.code,
          message: err.data.error.message,
          ...(err.data.error.details === undefined ? {} : { details: err.data.error.details }),
        }
      : { ok: false, status: res.status, code: "bad_response", message: `The server answered with HTTP ${res.status}` };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: res.status, code: "bad_response", message: "The server sent data in an unexpected shape" };
  }
  return { ok: true, data: parsed.data };
}
