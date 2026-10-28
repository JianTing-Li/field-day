import { describe, expect, it } from "vitest";
import { CheckResult, type CandidatePlan, type CheckId, type EventBrief, type EvidenceItem, type RuleInput } from "@/contracts";
import { case01, case02 } from "@fixtures/scenarios";
import { evidence } from "@fixtures/scenarios/helpers";
import { workoutRules } from "./workout";

// Case 1: bodyweight circuit at Park A 9 a.m., organizer confirmed stationary space there.
// Case 2: run intervals; organizer reported Park A's running lane is unusable.

function plan(p: Partial<CandidatePlan>): CandidatePlan {
  return {
    park_time_candidate_id: null,
    park_id: "park-a",
    start_time: "2026-10-29T09:00",
    time_zone: "America/New_York",
    duration_minutes: 45,
    workout_template_id: "tpl-bodyweight-45",
    adaptation_ids: [],
    session_outline: [],
    ...p,
  };
}

function run(
  p: Partial<CandidatePlan>,
  opts: { scenario?: typeof case01 | typeof case02; brief?: Partial<EventBrief>; extra?: EvidenceItem[] } = {},
) {
  const scenario = opts.scenario ?? case01;
  const snapshot = scenario.snapshot("evt", 1);
  const input: RuleInput = {
    plan: plan(p),
    brief: { ...scenario.brief, ...opts.brief },
    snapshot: { ...snapshot, items: [...snapshot.items, ...(opts.extra ?? [])] },
    event_version: 1,
  };
  const checks = workoutRules(input);
  const get = (id: CheckId) => {
    const c = checks.find((x) => x.check_id === id);
    if (!c) throw new Error(`missing ${id}`);
    return c;
  };
  return { checks, get };
}

const confirm = (a: {
  id: string;
  check: CheckId;
  value: boolean | string;
  park_id?: string;
  layout?: string;
  valid_from?: string;
  valid_to?: string;
}) =>
  evidence({
    id: a.id,
    metric: a.check === "space_surface.space" ? "space_confirmation" : "surface_confirmation",
    evidence_type: "organizer_confirmation",
    value: a.value,
    category: a.layout ?? null,
    source: "Organizer",
    park_id: a.park_id ?? "park-a",
    valid_from: a.valid_from ?? null,
    valid_to: a.valid_to ?? null,
    confirms_check_id: a.check,
  });

const grass = confirm({ id: "ev-surface-grass", check: "space_surface.surface", value: "grass" });

describe("workoutRules", () => {
  it("returns exactly the four workout checks, all critical and valid", () => {
    const { checks } = run({});
    expect(checks.map((c) => c.check_id)).toEqual([
      "equipment.available",
      "duration.fits",
      "space_surface.space",
      "space_surface.surface",
    ]);
    for (const c of checks) {
      expect(() => CheckResult.parse(c)).not.toThrow();
      expect(c.critical).toBe(true);
      expect(c.assessed).toEqual({ park_id: "park-a", start_time: "2026-10-29T09:00", workout_template_id: "tpl-bodyweight-45" });
    }
  });

  it("Case 1: passes equipment, duration and space; surface stays unknown without a confirmation", () => {
    const { get } = run({});
    expect(get("equipment.available").status).toBe("pass");
    expect(get("duration.fits").status).toBe("pass");
    expect(get("space_surface.space")).toMatchObject({ status: "pass", evidence_ids: ["ev-c1-space-confirm"] });
    expect(get("space_surface.surface").status).toBe("unknown");
  });

  it("cites the template's reference record when the snapshot has it", () => {
    expect(run({}).get("equipment.available").evidence_ids).toEqual(["ev-tpl-bodyweight-45"]);
  });
});

describe("equipment.available", () => {
  const bands = { workout_template_id: "tpl-band-strength-45" };

  it("fails when the organizer is missing equipment", () => {
    const c = run(bands, { brief: { equipment_available: ["exercise_mat"] } }).get("equipment.available");
    expect(c.status).toBe("fail");
    expect(c.reason).toBe("Missing equipment: resistance_band");
  });

  it("passes when everything is on the list, ignoring case and spacing", () => {
    const c = run(bands, { brief: { equipment_available: ["Resistance band", "exercise-mat"] } }).get("equipment.available");
    expect(c.status).toBe("pass");
  });

  it("is unknown when no template is chosen", () => {
    expect(run({ workout_template_id: null }).get("equipment.available").status).toBe("unknown");
  });
});

describe("duration.fits", () => {
  it("adds adaptation changes to the template length", () => {
    const c = run({ adaptation_ids: ["adapt-short-30"], duration_minutes: 30 }).get("duration.fits");
    expect(c).toMatchObject({ status: "fail", reason: "Workout is 30 minutes; the event is 45 minutes" });
  });

  it("passes a shortened workout for a shorter event", () => {
    const c = run({ adaptation_ids: ["adapt-short-30"], duration_minutes: 30 }, { brief: { duration_minutes: 30 } });
    expect(c.get("duration.fits").status).toBe("pass");
  });

  it("fails when the plan's own length disagrees with the workout", () => {
    expect(run({ duration_minutes: 60 }).get("duration.fits").status).toBe("fail");
  });

  it("is unknown when the template is not in the snapshot", () => {
    const c = run({ workout_template_id: "tpl-made-up" }).get("duration.fits");
    expect(c).toMatchObject({ status: "unknown", reason: "Workout template tpl-made-up is not in the evidence snapshot" });
  });

  it("makes every check unknown for an adaptation the template doesn't permit", () => {
    const { checks } = run({ adaptation_ids: ["adapt-stationary-circuit"] });
    for (const c of checks) expect(c.status).toBe("unknown");
    expect(checks[0].reason).toContain("not permitted");
  });
});

describe("space_surface.space", () => {
  const c2 = { scenario: case02 };
  const runAt = (park_id: string, adapted: boolean) =>
    run(
      {
        park_id,
        start_time: "2026-07-16T08:00",
        workout_template_id: "tpl-run-intervals-45",
        adaptation_ids: adapted ? ["adapt-stationary-circuit"] : [],
      },
      c2,
    ).get("space_surface.space");

  it("Case 2: fails the running lane at Park A after the organizer reported it unusable", () => {
    expect(runAt("park-a", false)).toMatchObject({ status: "fail", evidence_ids: ["ev-c2-lane-unusable"] });
  });

  it("Case 2: the stationary adaptation at Park A is unknown, not resolved by the lane report", () => {
    expect(runAt("park-a", true)).toMatchObject({ status: "unknown", reason: "Stationary space at park-a is not confirmed" });
  });

  it("Case 2: Park A's report never carries over to Park B", () => {
    expect(runAt("park-b", false).status).toBe("unknown");
    expect(runAt("park-b", true).status).toBe("unknown");
  });

  it("Case 1: Park A's confirmation never carries over to Park B", () => {
    expect(run({ park_id: "park-b" }).get("space_surface.space").status).toBe("unknown");
  });

  it("passes an adapted layout only with a confirmation naming that layout", () => {
    const yes = confirm({ id: "ev-stationary-a", check: "space_surface.space", value: true, layout: "stationary" });
    const c = run(
      { start_time: "2026-07-16T08:00", workout_template_id: "tpl-run-intervals-45", adaptation_ids: ["adapt-stationary-circuit"] },
      { ...c2, extra: [yes] },
    ).get("space_surface.space");
    expect(c).toMatchObject({ status: "pass", evidence_ids: ["ev-stationary-a"] });
  });

  it("a confirmation for a different layout does not count", () => {
    const lane = confirm({ id: "ev-lane-a", check: "space_surface.space", value: true, layout: "running_lane" });
    const snapshot = case01.snapshot("evt", 1);
    const items = snapshot.items.filter((i) => i.id !== "ev-c1-space-confirm");
    const c = workoutRules({ plan: plan({}), brief: case01.brief, snapshot: { ...snapshot, items: [...items, lane] }, event_version: 1 });
    expect(c.find((x) => x.check_id === "space_surface.space")?.status).toBe("unknown");
  });

  it("a timed confirmation counts only for start times it covers", () => {
    const morning = confirm({
      id: "ev-morning",
      check: "space_surface.space",
      value: false,
      valid_from: "2026-10-29T07:00",
      valid_to: "2026-10-29T09:00",
    });
    expect(run({ start_time: "2026-10-29T08:00" }, { extra: [morning] }).get("space_surface.space").status).toBe("fail");
    // 09:00 is outside [07:00, 09:00), so only the untimed Case 1 confirmation applies.
    expect(run({ start_time: "2026-10-29T09:00" }, { extra: [morning] }).get("space_surface.space").status).toBe("pass");
  });

  it("a 'no' wins over a 'yes' for the same layout", () => {
    const no = confirm({ id: "ev-no", check: "space_surface.space", value: false });
    expect(run({}, { extra: [no] }).get("space_surface.space")).toMatchObject({ status: "fail", evidence_ids: ["ev-no"] });
  });

  it("is unknown when no park is chosen", () => {
    expect(run({ park_id: null }).get("space_surface.space").status).toBe("unknown");
  });
});

describe("space_surface.surface", () => {
  it("passes a confirmed surface the workout allows", () => {
    expect(run({}, { extra: [grass] }).get("space_surface.surface")).toMatchObject({
      status: "pass",
      evidence_ids: ["ev-surface-grass"],
    });
  });

  it("fails a confirmed surface the workout doesn't allow", () => {
    const c = run({ workout_template_id: "tpl-run-intervals-45" }, { extra: [grass] }).get("space_surface.surface");
    expect(c).toMatchObject({ status: "fail", reason: "Surface at park-a (grass) is not suitable; this workout needs paved or track" });
  });

  it("follows a yes/no suitability confirmation", () => {
    const no = confirm({ id: "ev-surface-no", check: "space_surface.surface", value: false });
    const yes = confirm({ id: "ev-surface-yes", check: "space_surface.surface", value: true });
    expect(run({}, { extra: [no] }).get("space_surface.surface").status).toBe("fail");
    expect(run({}, { extra: [yes] }).get("space_surface.surface").status).toBe("pass");
  });

  it("a surface confirmed at Park A never applies at Park B", () => {
    expect(run({ park_id: "park-b" }, { extra: [grass] }).get("space_surface.surface").status).toBe("unknown");
  });

  it("a space confirmation does not confirm the surface", () => {
    expect(run({}).get("space_surface.surface").status).toBe("unknown");
  });
});

describe("heat and air quality are not workout rules", () => {
  it("gives the same results whatever the temperature or AQI", () => {
    const base = run({}).checks;
    const scorching = evidence({
      id: "ev-hot",
      metric: "temperature",
      value: 105,
      unit: "F",
      source: "NWS (fixture)",
      park_id: "park-a",
      valid_from: "2026-10-29T09:00",
      valid_to: "2026-10-29T10:00",
    });
    const smoky = evidence({ id: "ev-smoke", metric: "aqi", value: 250, unit: "AQI", source: "AirNow (fixture)", park_id: null });
    expect(run({}, { extra: [scorching, smoky] }).checks).toEqual(base);
  });

  it("a lower-intensity adaptation passes nothing it wouldn't otherwise", () => {
    const base = run({}).checks.map((c) => c.status);
    expect(run({ adaptation_ids: ["adapt-low-impact"] }).checks.map((c) => c.status)).toEqual(base);
  });
});
