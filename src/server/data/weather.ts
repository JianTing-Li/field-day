import type { FetchForecast } from "@/contracts";

/**
 * NWS forecast adapter (owner: Yadan, task YT-01). Port of weather.py.
 * Live: GET /points/{lat},{lon} -> follow the hourly-forecast URL, send the
 * NWS_USER_AGENT header. Fixture: read fixtures/sources/nws/.
 * Never throws on provider failure: return items plus explicit coverage gaps.
 *
 * PLACEHOLDER: returns no evidence and an explicit gap.
 */
export const fetchForecast: FetchForecast = async (req, mode) => ({
  origin: mode,
  items: [],
  coverage_gaps: [`NWS forecast for ${req.park_id} not available: adapter not implemented yet (YT-01)`],
});
