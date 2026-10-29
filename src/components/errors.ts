import type { ApiResult } from "./api-client";

/**
 * Plain-language explanations for every way an API call can fail (owner: Yadan, task YT-12).
 * Every failure says that nothing was saved, so the organizer never wonders whether it half-worked.
 */

export type ApiFailure = Extract<ApiResult<unknown>, { ok: false }>;

export interface ErrorView {
  title: string;
  body: string;
  /** The page's data is out of date; offer a reload instead of a retry. */
  reload: boolean;
  tone: "danger" | "warning";
}

export function describeError(e: ApiFailure, action = "That"): ErrorView {
  switch (e.code) {
    case "stale_version":
      return {
        title: "This event changed since you opened it",
        body: "Nothing was saved. Reload to see the latest version, then try again.",
        reload: true,
        tone: "warning",
      };
    case "blocked":
      return { title: `${action} is blocked`, body: `${e.message}. Nothing was saved.`, reload: false, tone: "warning" };
    case "upstream_unavailable":
      return {
        title: "Weather, air-quality or park data is unavailable right now",
        body: "Nothing was saved. Try again in a moment. FieldDay never fills missing data with guesses.",
        reload: false,
        tone: "warning",
      };
    case "budget_exhausted":
      return {
        title: "The planning run hit its limit",
        body: "Nothing was saved: the agents used up their allowed time or calls before finishing. Try again.",
        reload: false,
        tone: "warning",
      };
    case "rate_limited":
      return {
        title: "The demo's agent limit was reached",
        body: `${e.message} Nothing was saved.`,
        reload: false,
        tone: "warning",
      };
    case "network":
      return {
        title: "Can't reach FieldDay",
        body: "Check your connection and try again. Nothing was saved.",
        reload: false,
        tone: "danger",
      };
    case "not_found":
      return { title: "This event doesn't exist", body: `${e.message}.`, reload: false, tone: "danger" };
    default:
      return { title: `${action} didn't work`, body: `${e.message}. Nothing was saved.`, reload: false, tone: "danger" };
  }
}
