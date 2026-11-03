import { describe, expect, it } from "vitest";
import { case02 } from "@fixtures/scenarios";
import { applyLabel, applyWork, changeLine } from "./changes";
import { weatherFacts, weatherIcon } from "./logic";

const snapshot = case02.snapshot("evt", 2);
const plan = case02.planningOutput(2).plan;
const brief = case02.brief;

describe("changes in plain words (JT-28)", () => {
  it("says what changed and what FieldDay does about it", () => {
    expect(changeLine({ type: "group_size", group_size: 500, said: "500 came" }, brief, plan, snapshot)).toMatchObject({
      what: `Group: ${brief.group_size} → 500 people`,
      then: "Re-plans for 500",
      note: false,
    });
    expect(changeLine({ type: "start_window", earliest: "07:00", latest: "10:00", said: "morning" }, brief, plan, snapshot).what).toBe(
      "Start 7:00 AM–10:00 AM",
    );
    expect(changeLine({ type: "note", said: "no money", reply: "FieldDay doesn't handle money." }, brief, plan, snapshot)).toMatchObject({
      then: "FieldDay doesn't handle money.",
      note: true,
    });
  });

  it("names the button and the wait by what the list does", () => {
    const note = { type: "note" as const, said: "x", reply: "y" };
    const rain = { type: "report" as const, what: "rain" as const, said: "rain" };
    const group = { type: "group_size" as const, group_size: 9, said: "9" };
    expect(applyLabel([note])).toBe("Got it");
    expect(applyLabel([rain, note])).toBe("Make this change");
    expect(applyLabel([rain, group])).toBe("Make these 2 changes");
    expect([applyWork([note]), applyWork([rain]), applyWork([rain, group])]).toEqual(["Saving your note", "Finding a fix", "Re-planning"]);
  });
});

describe("forecast next to its limits (JT-28)", () => {
  it("shows rain over the limit with a rain icon, never a sun", () => {
    const wet = {
      ...snapshot,
      items: snapshot.items.map((e) => (e.metric === "precipitation_probability" ? { ...e, value: 80 } : e)),
    };
    const rain = weatherFacts(wet, plan, brief.instructor_limits).find((f) => f.label === "Chance of rain");
    expect(rain).toMatchObject({ value: "80%", limit: "limit 40%", over: true, icon: "🌧" });
    expect(weatherIcon(wet, plan)).toBe("🌧");
    // Case 2 itself is hot and dry: over the heat limit, no rain icon.
    expect(weatherFacts(snapshot, plan, brief.instructor_limits)[0]).toMatchObject({ value: "93°F", over: true });
  });

  it("uses the organizer's stricter heat limit", () => {
    const facts = weatherFacts(snapshot, plan, { max_temperature_f: 80, max_aqi: null });
    expect(facts.find((f) => f.label === "Temperature")?.limit).toBe("limit 80°F");
  });
});
