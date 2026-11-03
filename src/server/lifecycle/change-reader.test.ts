import { describe, expect, it } from "vitest";
import type { ChangeItem, EventBrief } from "@/contracts";
import type { AnthropicMessageClient } from "@/server/agents/runner";
import { readByRules, readChanges, tidy, UNREAD_REPLY, type ReadContext } from "./change-reader";

const brief: EventBrief = {
  title: "Run club",
  date: "2026-11-12",
  time_zone: "America/New_York",
  start_window: { earliest: "18:00", latest: "19:00" },
  duration_minutes: 45,
  group_size: 200,
  allowed_park_ids: ["park-a", "park-b"],
  preferred_park_id: "park-a",
  workout_template_id: null,
  equipment_available: ["exercise_mat", "cones"],
  exercise_exclusions: [],
  instructor_limits: { max_temperature_f: null, max_aqi: null, notes: null },
  priorities: [],
};
const ctx: ReadContext = {
  brief,
  plan: { park_id: "park-a", start_time: "2026-11-12T18:00" },
  parks: [
    { id: "park-a", name: "Park A" },
    { id: "park-b", name: "Park B" },
  ],
  today: "2026-11-02",
};
const types = (items: ChangeItem[]) => items.map((i) => (i.type === "report" ? `report:${i.what}` : i.type));

describe("reading changes with rules (JT-28)", () => {
  it("reads several changes from one message, and answers what it can't act on", () => {
    const items = tidy(readByRules("500 people showed up instead of 200, it's pouring, and I have no money", ctx), ctx);
    expect(types(items)).toEqual(["group_size", "report:rain", "note"]);
    expect(items[0]).toMatchObject({ group_size: 500 });
    expect(items[2]).toMatchObject({ type: "note", reply: expect.stringContaining("doesn't handle money") });
  });

  it("turns 'move it to the morning' into a new start window", () => {
    expect(readByRules("Can we move it to the morning?", ctx)).toEqual([
      { type: "start_window", earliest: "07:00", latest: "10:00", said: "Can we move it to the morning" },
    ]);
  });

  it("reads clock times, 'until' and ranges", () => {
    expect(readByRules("start at 9am", ctx)[0]).toMatchObject({ earliest: "09:00", latest: "09:00" });
    expect(readByRules("the instructor can't start until 6:30pm", ctx)[0]).toMatchObject({ earliest: "18:30", latest: "19:00" });
    expect(readByRules("anywhere between 7 and 9am", ctx)[0]).toMatchObject({ earliest: "07:00", latest: "09:00" });
  });

  it("reads a new day, length, missing equipment and exercises to skip", () => {
    expect(readByRules("move it to Saturday", ctx)[0]).toMatchObject({ type: "date", date: "2026-11-07" });
    expect(readByRules("we only have 30 minutes", ctx)[0]).toMatchObject({ type: "duration", duration_minutes: 30 });
    expect(readByRules("we forgot the mats", ctx)[0]).toMatchObject({ type: "equipment_missing", equipment: ["exercise_mat"] });
    expect(readByRules("no jumping please", ctx)[0]).toMatchObject({ type: "avoid_exercises", exercises: ["jumping"] });
  });

  it("drops another allowed park that is closed, and reports the plan's own park", () => {
    expect(readByRules("Park B is closed", ctx)[0]).toMatchObject({ type: "avoid_park", park_id: "park-b" });
    expect(readByRules("the lawn is fenced off", ctx)[0]).toMatchObject({ type: "report", what: "space" });
  });

  it("never stays silent: a part it can't read gets a note", () => {
    expect(readByRules("the vibes are off", ctx)).toEqual([{ type: "note", said: "the vibes are off", reply: UNREAD_REPLY }]);
  });
});

describe("checking what was read (JT-28)", () => {
  it("turns changes FieldDay can't make into notes that say why", () => {
    const items = tidy(
      [
        { type: "group_size", group_size: 900, said: "900 came" },
        { type: "date", date: "2026-10-01", said: "last month" },
        { type: "equipment_missing", equipment: ["kettlebell"], said: "no kettlebells" },
      ],
      ctx,
    );
    expect(items.map((i) => i.type)).toEqual(["note", "note", "note"]);
    expect(items[0]).toMatchObject({ reply: expect.stringContaining("up to 500 people") });
  });

  it("drops changes that change nothing, and a 'time doesn't work' once there's a new time", () => {
    const items = tidy(
      [
        { type: "group_size", group_size: 200, said: "200 people" },
        { type: "report", what: "time", said: "time doesn't work" },
        { type: "start_window", earliest: "10:00", latest: "08:00", said: "8 to 10" },
      ],
      ctx,
    );
    expect(items).toEqual([{ type: "start_window", earliest: "08:00", latest: "10:00", said: "8 to 10" }]);
  });
});

describe("reading changes with the model (JT-28)", () => {
  const client = (input: unknown): AnthropicMessageClient => ({
    messages: {
      create: async () =>
        ({ content: [{ type: "tool_use", id: "t", name: "report_changes", input }] }) as unknown as Awaited<
          ReturnType<AnthropicMessageClient["messages"]["create"]>
        >,
    },
  });

  it("keeps the valid items the model returns, checked like the rules' items", async () => {
    const r = await readChanges("x", ctx, {
      useModel: true,
      client: client({
        items: [
          { type: "duration", duration_minutes: 30, said: "only half an hour" },
          { type: "made_up", said: "?" },
          { type: "group_size", group_size: 900, said: "900" },
        ],
      }),
    });
    expect(r.read_by).toBe("model");
    expect(types(r.items)).toEqual(["duration", "note"]);
  });

  it("replaces a model note with the change the rules can make", async () => {
    const r = await readChanges("x", ctx, {
      useModel: true,
      client: client({ items: [{ type: "note", said: "500 people showed up instead of 200", reply: "Can't change the group." }] }),
    });
    expect(r.items).toEqual([{ type: "group_size", group_size: 500, said: "500 people showed up instead of 200" }]);
  });

  it("falls back to the rules when the model call fails", async () => {
    const failing: AnthropicMessageClient = { messages: { create: async () => Promise.reject(new Error("down")) } };
    const r = await readChanges("it's pouring", ctx, { useModel: true, client: failing });
    expect(r).toMatchObject({ read_by: "rules", items: [{ type: "report", what: "rain" }] });
  });
});
