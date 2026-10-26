import type { ApiError } from "@/contracts";

export type ServiceErrorCode = ApiError["error"]["code"];

/** Thrown by the lifecycle service; API routes turn it into an ApiError response. */
export class ServiceError extends Error {
  constructor(
    public code: ServiceErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
