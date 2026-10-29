import { describe, expect, it } from "vitest";
import { case02 } from "@fixtures/scenarios";
import { EMPTY_FORM, dateHint, equipmentId, equipmentLabel, fromBrief, toBrief, type BriefFormValues } from "./brief-form";

const filled: BriefFormValues = {
  ...EMPTY_FORM,
  title: "  Saturday bootcamp ",
  date: "2026-11-07",
  earliest: "08:00",
  latest: "10:00",
  duration_minutes: "45",
  group_size: "15",
  allowed_park_ids: ["park-b058", "park-q004"],
  preferred_park_id: "park-b058",
  workout_template_id: "tpl-bodyweight-45",
  equipment: ["exercise_mat"],
  other_equipment: "Cones, jump rope",
  exercise_exclusions: "Burpees\n\nBurpees\nBox jumps",
  max_temperature_f: "88",
  max_aqi: "100",
  limit_notes: "",
  priorities: "Keep the same park",
};

describe("toBrief", () => {
  it("builds a valid brief: trims text, splits lists, removes blanks and repeats", () => {
    const r = toBrief(filled);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.brief).toMatchObject({
      title: "Saturday bootcamp",
      time_zone: "America/New_York",
      start_window: { earliest: "08:00", latest: "10:00" },
      duration_minutes: 45,
      group_size: 15,
      equipment_available: ["exercise_mat", "cones", "jump_rope"],
      exercise_exclusions: ["Burpees", "Box jumps"],
      instructor_limits: { max_temperature_f: 88, max_aqi: 100, notes: null },
      priorities: ["Keep the same park"],
    });
  });

  it("turns blank optional fields into null", () => {
    const r = toBrief({ ...filled, preferred_park_id: "", workout_template_id: "", max_temperature_f: "", max_aqi: "" });
    expect(r.ok && r.brief).toMatchObject({
      preferred_park_id: null,
      workout_template_id: null,
      instructor_limits: { max_temperature_f: null, max_aqi: null },
    });
  });

  it("gives a friendly message for each missing required field", () => {
    const r = toBrief(EMPTY_FORM);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      title: "Give the event a name",
      date: "Pick the event date",
      group_size: "Enter how many people are coming (a whole number)",
      allowed_park_ids: "Choose at least one park",
    });
  });

  it("rejects numbers that aren't whole or positive", () => {
    const r = toBrief({ ...filled, group_size: "2.5", duration_minutes: "-10", max_aqi: "50.5", max_temperature_f: "hot" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["duration_minutes", "group_size", "max_aqi", "max_temperature_f"]);
  });

  it("explains a start window that runs backwards", () => {
    const r = toBrief({ ...filled, earliest: "11:00", latest: "09:00" });
    expect(!r.ok && r.errors.earliest).toBe("Earliest start must not be after latest start");
  });

  it("explains a preferred park that isn't allowed", () => {
    const r = toBrief({ ...filled, preferred_park_id: "park-x010" });
    expect(!r.ok && r.errors.preferred_park_id).toBe("Preferred park must be one of the allowed parks");
  });
});

describe("fromBrief", () => {
  it("round-trips a fixture brief through the form", () => {
    const form = fromBrief(case02.brief, ["resistance_band", "exercise_mat"]);
    const r = toBrief(form);
    expect(r.ok && r.brief).toEqual(case02.brief);
  });

  it("puts equipment no template uses in the free-text field", () => {
    const form = fromBrief({ ...case02.brief, equipment_available: ["exercise_mat", "jump_rope"] }, ["exercise_mat"]);
    expect(form.equipment).toEqual(["exercise_mat"]);
    expect(form.other_equipment).toBe("Jump rope");
  });
});

describe("equipment names", () => {
  it("matches the way templates name equipment", () => {
    expect(equipmentId(" Resistance band ")).toBe("resistance_band");
    expect(equipmentId("exercise-mat")).toBe("exercise_mat");
    expect(equipmentLabel("resistance_band")).toBe("Resistance band");
  });
});

describe("dates", () => {
  it("rejects a past date when today is known", () => {
    const r = toBrief({ ...filled, date: "2025-01-04" }, "2026-10-29");
    expect(!r.ok && r.errors.date).toBe("Pick today or a later date");
  });

  it("accepts today and later dates, and skips the rule without a today", () => {
    expect(toBrief({ ...filled, date: "2026-10-29" }, "2026-10-29").ok).toBe(true);
    expect(toBrief({ ...filled, date: "2025-01-04" }).ok).toBe(true);
  });

  it("notes when a date is beyond the forecast range", () => {
    expect(dateHint("2026-11-02", "2026-10-29")).toBeNull();
    expect(dateHint("2026-11-20", "2026-10-29")).toContain("Forecasts only reach about 7 days ahead");
    expect(dateHint("", "2026-10-29")).toBeNull();
  });
});
