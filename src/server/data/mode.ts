import type { DataMode } from "@/contracts";

/** Reads FIELDDAY_DATA_MODE (default: fixture). Live mode needs the API keys in .env.local. */
export function dataMode(): DataMode {
  return process.env.FIELDDAY_DATA_MODE === "live" ? "live" : "fixture";
}
