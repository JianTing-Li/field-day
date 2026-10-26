/**
 * Environmental policy values (owner: JT, task JT-04).
 * PRD: these are open decisions. Until reviewed they may only be demonstrated with
 * labeled fixtures and cannot support real-world finalization.
 * Record every value and its source in docs/decisions.md.
 */
export const POLICY_CONFIG = {
  version: "unreviewed-demo-policy-v0",
  review_status: "unreviewed_demo_policy" as const,
  heat: {
    /** Evidence metric and unit the heat check reads. */
    metric: "temperature" as const,
    unit: "F",
    max_value: null as number | null,
  },
  air_quality: {
    max_aqi: null as number | null,
    /** Observations cannot stand in for a future forecast. */
    allow_observation_for_future: false,
  },
};
