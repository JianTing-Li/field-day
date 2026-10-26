import type { FetchAirQuality } from "@/contracts";

/**
 * AirNow adapter (owner: Yadan, task YT-02). AIRNOW_API_KEY stays server-side.
 * Reporting-area values are regional, and observations never stand in for a future forecast.
 * Fixture: read fixtures/sources/airnow/.
 *
 * PLACEHOLDER: returns no evidence and an explicit gap.
 */
export const fetchAirQuality: FetchAirQuality = async (req, mode) => ({
  origin: mode,
  items: [],
  coverage_gaps: [`AirNow data for ${req.park_id} not available: adapter not implemented yet (YT-02)`],
});
