/**
 * Environmental policy values (owner: JT, task JT-04; freshness limits from JT-03).
 * PRD: these are open decisions. Until reviewed they may only be demonstrated with
 * labeled fixtures and cannot support real-world finalization.
 * Every value and its reasoning is recorded in docs/decisions.md (D-JT03-1, D-JT04-1).
 */
export const POLICY_CONFIG = {
  version: "unreviewed-demo-policy-v1",
  review_status: "unreviewed_demo_policy" as const,
  /** Shown in every environmental check reason so the label travels with the result. */
  label: "unreviewed demo policy",
  heat: {
    /** NWS hourly forecast air temperature. Humidity is not collected, so this is not a heat index. */
    metric: "temperature" as const,
    unit: "F",
    /** Inclusive: exactly 90°F passes, anything above fails. */
    max_value: 90,
  },
  rain: {
    /** NWS hourly probability of precipitation, in percent. Inclusive: exactly 40% passes, 41% fails (D-JT24-11). */
    max_probability_percent: 40,
  },
  air_quality: {
    /** Inclusive: AQI 100 (top of "Moderate") passes, 101 ("Unhealthy for Sensitive Groups") fails. */
    max_aqi: 100,
    /** Observations cannot stand in for a future forecast. */
    allow_observation_for_future: false,
  },
  /**
   * Maximum evidence age in hours, measured from retrieval to the snapshot's assessment time.
   * Based on how often each source updates; reference records (parks, templates) and
   * organizer confirmations have no age limit.
   */
  freshness: {
    nws_forecast_max_age_hours: 3,
    airnow_forecast_max_age_hours: 24,
    airnow_observation_max_age_hours: 2,
  },
};

/**
 * AQI ranges for AirNow's category names. A forecast that gives only a category passes when the
 * whole range is within the limit and fails when the whole range is above it.
 */
export const AQI_CATEGORY_RANGES: Record<string, { min: number; max: number }> = {
  good: { min: 0, max: 50 },
  moderate: { min: 51, max: 100 },
  "unhealthy for sensitive groups": { min: 101, max: 150 },
  unhealthy: { min: 151, max: 200 },
  "very unhealthy": { min: 201, max: 300 },
  hazardous: { min: 301, max: 500 },
};
