import { describe, expect, it } from "vitest";
import { ToolSchemas, type EvidenceSnapshot, type ToolContext } from "@/contracts";
import { case01, case02 } from "../../../fixtures/scenarios";
import { evidence } from "../../../fixtures/scenarios/helpers";
import { tools } from "./index";

function makeCtx(snapshot: EvidenceSnapshot, brief = case02.brief, event_version = 1): ToolContext {
  return { snapshot, brief, event_version };
}

describe("agent tools (JT-02)", () => {
  describe("get_park_candidates", () => {
    it("returns all park and park_time candidates when park_ids is null", async () => {
      const ctx = makeCtx(case02.snapshot("evt-2", 1));
      const out = await tools.get_park_candidates({ park_ids: null }, ctx);
      ToolSchemas.get_park_candidates.output.parse(out);
      expect(out.park_candidates.map((p) => p.id)).toEqual(["park-a", "park-b"]);
      expect(out.park_time_candidates.map((c) => c.id)).toEqual([
        "cand-a-0800",
        "cand-a-1000",
        "cand-b-0800",
      ]);
    });

    it("filters park_candidates and park_time_candidates by park_ids", async () => {
      const ctx = makeCtx(case02.snapshot("evt-2", 1));
      const out = await tools.get_park_candidates({ park_ids: ["park-b"] }, ctx);
      ToolSchemas.get_park_candidates.output.parse(out);
      expect(out.park_candidates.map((p) => p.id)).toEqual(["park-b"]);
      expect(out.park_time_candidates.map((c) => c.id)).toEqual(["cand-b-0800"]);
    });
  });

  describe("get_workout_templates", () => {
    it("returns all templates when template_ids is null and filters when provided", async () => {
      const ctx = makeCtx(case01.snapshot("evt-1", 1), case01.brief);
      const all = await tools.get_workout_templates({ template_ids: null }, ctx);
      ToolSchemas.get_workout_templates.output.parse(all);
      expect(all.templates.length).toBeGreaterThanOrEqual(2);

      const one = await tools.get_workout_templates({ template_ids: ["tpl-bodyweight-45"] }, ctx);
      ToolSchemas.get_workout_templates.output.parse(one);
      expect(one.templates.map((t) => t.id)).toEqual(["tpl-bodyweight-45"]);
    });
  });

  describe("get_forecast", () => {
    it("returns matching forecast items and no gaps for Case 1 window", async () => {
      const ctx = makeCtx(case01.snapshot("evt-1", 1), case01.brief);
      const out = await tools.get_forecast(
        {
          park_id: "park-a",
          start_time: "2026-10-29T09:00",
          end_time: "2026-10-29T09:45",
        },
        ctx,
      );
      ToolSchemas.get_forecast.output.parse(out);
      expect(out.items.map((e) => e.id)).toEqual(["ev-c1-temp-0900"]);
      expect(out.coverage_gaps).toEqual([]);
    });

    it("filters by time window and park_id on Case 2 (excludes other hours and other parks)", async () => {
      const ctx = makeCtx(case02.snapshot("evt-2", 1));

      const at0800 = await tools.get_forecast(
        {
          park_id: "park-a",
          start_time: "2026-07-16T08:00",
          end_time: "2026-07-16T08:45",
        },
        ctx,
      );
      ToolSchemas.get_forecast.output.parse(at0800);
      expect(at0800.items.map((e) => e.id)).toEqual(["ev-c2-temp-0800-park-a"]);
      expect(at0800.coverage_gaps).toEqual([]);

      const at1000 = await tools.get_forecast(
        {
          park_id: "park-a",
          start_time: "2026-07-16T10:00",
          end_time: "2026-07-16T10:45",
        },
        ctx,
      );
      expect(at1000.items.map((e) => e.id)).toEqual(["ev-c2-temp-1000-park-a"]);
      expect(at1000.coverage_gaps).toEqual([]);
    });

    it("combines contiguous hourly periods to cover a multi-hour window without gaps", async () => {
      const snap = case01.snapshot("evt-1", 1);
      snap.items.push(
        evidence({
          id: "ev-c1-temp-1000",
          metric: "temperature",
          value: 65,
          unit: "F",
          source: "NWS (fixture)",
          park_id: "park-a",
          scope: "forecast_grid",
          valid_from: "2026-10-29T10:00",
          valid_to: "2026-10-29T11:00",
        }),
      );
      const ctx = makeCtx(snap, case01.brief);

      const out = await tools.get_forecast(
        {
          park_id: "park-a",
          start_time: "2026-10-29T09:15",
          end_time: "2026-10-29T10:30",
        },
        ctx,
      );
      expect(out.items.map((e) => e.id)).toEqual(["ev-c1-temp-0900", "ev-c1-temp-1000"]);
      expect(out.coverage_gaps).toEqual([]);
    });

    it("reports a coverage gap when an interval is only partially covered", async () => {
      const ctx = makeCtx(case01.snapshot("evt-1", 1), case01.brief);
      // ev-c1-temp-0900 covers 09:00..10:00; requesting 09:30..10:30 leaves 10:00..10:30 uncovered
      const out = await tools.get_forecast(
        {
          park_id: "park-a",
          start_time: "2026-10-29T09:30",
          end_time: "2026-10-29T10:30",
        },
        ctx,
      );
      expect(out.items.map((e) => e.id)).toEqual(["ev-c1-temp-0900"]);
      expect(out.coverage_gaps).toEqual([
        "Missing temperature coverage for park-a from 2026-10-29T10:00 to 2026-10-29T10:30 (requested 2026-10-29T09:30 to 2026-10-29T10:30)",
      ]);
    });

    it("reports a coverage gap when no forecast items overlap the requested window", async () => {
      const ctx = makeCtx(case02.snapshot("evt-2", 1));
      // 09:00..09:45 has no forecast in Case 2 (only 08:00..09:00 and 10:00..11:00 exist)
      const out = await tools.get_forecast(
        {
          park_id: "park-a",
          start_time: "2026-07-16T09:00",
          end_time: "2026-07-16T09:45",
        },
        ctx,
      );
      expect(out.items).toEqual([]);
      expect(out.coverage_gaps).toEqual([
        "No temperature evidence for park-a covering 2026-07-16T09:00 to 2026-07-16T09:45",
      ]);
    });

    it("reports missing_reason when an overlapping forecast item has value === null", async () => {
      const snap = case01.snapshot("evt-1", 1);
      snap.items.push(
        evidence({
          id: "ev-c1-wind-missing",
          metric: "wind_speed",
          value: null,
          missing_reason: "NWS wind sensor offline",
          source: "NWS (fixture)",
          park_id: "park-a",
          scope: "forecast_grid",
          valid_from: "2026-10-29T09:00",
          valid_to: "2026-10-29T10:00",
        }),
      );
      const ctx = makeCtx(snap, case01.brief);

      const out = await tools.get_forecast(
        {
          park_id: "park-a",
          start_time: "2026-10-29T09:00",
          end_time: "2026-10-29T09:45",
        },
        ctx,
      );
      expect(out.items.map((e) => e.id)).toEqual(["ev-c1-temp-0900", "ev-c1-wind-missing"]);
      expect(out.coverage_gaps).toEqual([
        "wind_speed missing for park-a (2026-10-29T09:00 to 2026-10-29T09:45): NWS wind sensor offline",
      ]);
    });

    it("surfaces relevant snapshot-level coverage_gaps and ignores other parks or AQI gaps", async () => {
      const snap = case01.snapshot("evt-1", 1);
      snap.coverage_gaps = [
        "NWS forecast for park-a partially degraded",
        "NWS forecast for park-b not available: HTTP 503",
        "AirNow data for park-a not available",
      ];
      const ctx = makeCtx(snap, case01.brief);

      const out = await tools.get_forecast(
        {
          park_id: "park-a",
          start_time: "2026-10-29T09:00",
          end_time: "2026-10-29T09:45",
        },
        ctx,
      );
      expect(out.coverage_gaps).toEqual(["NWS forecast for park-a partially degraded"]);
    });
  });

  describe("get_air_quality", () => {
    it("returns regional (park_id: null) AQI evidence overlapping the window", async () => {
      const ctx = makeCtx(case02.snapshot("evt-2", 1));
      const out = await tools.get_air_quality(
        {
          park_id: "park-b",
          start_time: "2026-07-16T08:00",
          end_time: "2026-07-16T08:45",
        },
        ctx,
      );
      ToolSchemas.get_air_quality.output.parse(out);
      expect(out.items.map((e) => e.id)).toEqual(["ev-c2-aqi"]);
      expect(out.coverage_gaps).toEqual([]);
    });

    it("reports a coverage gap when requested window is outside AQI valid period", async () => {
      const ctx = makeCtx(case02.snapshot("evt-2", 1));
      const out = await tools.get_air_quality(
        {
          park_id: "park-a",
          start_time: "2026-07-17T08:00",
          end_time: "2026-07-17T08:45",
        },
        ctx,
      );
      expect(out.items).toEqual([]);
      expect(out.coverage_gaps).toEqual([
        "No aqi evidence for park-a covering 2026-07-17T08:00 to 2026-07-17T08:45",
      ]);
    });
  });

  describe("check_plan", () => {
    it("delegates to checkPlan with ctx brief, snapshot, and event_version", async () => {
      const snap = case01.snapshot("evt-1", 3);
      const ctx = makeCtx(snap, case01.brief, 3);
      const plan = case01.planningOutput(3).plan!;
      const res = await tools.check_plan({ plan }, ctx);
      ToolSchemas.check_plan.output.parse(res);
      expect(res.event_version).toBe(3);
      expect(res.evidence_snapshot_id).toBe(snap.id);
    });
  });
});
