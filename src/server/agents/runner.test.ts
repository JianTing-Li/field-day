import { afterEach, describe, expect, it, vi } from "vitest";
import { case01 } from "@fixtures/scenarios";
import {
  PlanningOutput,
   type AgentDefinition,
  type AgentDeps,
  type PlanningInput,
  type ToolRegistry,
} from "@/contracts";
import { createBudget, DEFAULT_LIMITS } from "@/server/orchestrator/budget";
import { tools as realTools } from "@/server/tools";
import { createFakeRunner } from "./fake-runner";
import {
  createRunner,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_MAX_TOKENS,
  MAX_TURNS_PER_EXECUTION,
  runAgent,
} from "./runner";

const testPlanningDef: AgentDefinition<"planning"> = {
  name: "planning",
  system_prompt: "You are the test planning agent.",
  allowed_tools: ["get_park_candidates", "get_forecast", "check_plan"],
  output_schema: PlanningOutput,
  build_user_message: (input) =>
    JSON.stringify({
      event_version: input.context.event_version,
      evidence_snapshot_id: input.context.evidence_snapshot_id,
      title: input.brief.title,
    }),
};

function makeInput(version = 1, snapshotId = case01.SNAPSHOT_ID): PlanningInput {
  return {
    context: {
      event_id: "evt-case-01",
      event_version: version,
      evidence_snapshot_id: snapshotId,
      revision_round: 0,
      revision_available: false,
    },
    brief: case01.brief,
  };
}

function makeDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  const snapshot = case01.snapshot("evt-case-01", 1);
  return {
    tools: realTools,
    tool_context: {
      snapshot,
      brief: case01.brief,
      event_version: 1,
    },
    budget: createBudget(),
    ...overrides,
  };
}

describe("agent runner (JT-01)", () => {
  const originalModel = process.env.ANTHROPIC_MODEL;
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = originalModel;

    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  describe("prompt, model selection, and tool loop", () => {
    it("sends system prompt, user message, only allowed_tools, and uses DEFAULT_ANTHROPIC_MODEL", async () => {
      delete process.env.ANTHROPIC_MODEL;
      const fake = createFakeRunner([{ output: case01.planningOutput(1) }]);
      const deps = makeDeps();

      const res = await fake(testPlanningDef, makeInput(), deps);

      expect(res.ok).toBe(true);
      expect(fake.calls).toHaveLength(1);
      const call = fake.calls[0].params;
      expect(call.model).toBe(DEFAULT_ANTHROPIC_MODEL);
      expect(call.system).toBe(testPlanningDef.system_prompt);
      expect(call.messages[0]).toEqual({
        role: "user",
        content: testPlanningDef.build_user_message(makeInput()),
      });
      const offeredToolNames = (call.tools ?? []).map((t) => ("name" in t ? t.name : ""));
      expect(offeredToolNames).toEqual(["get_park_candidates", "get_forecast", "check_plan"]);
    });

    it("reads model ID from ANTHROPIC_MODEL when set", async () => {
      process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";
      const fake = createFakeRunner([{ output: case01.planningOutput(1) }]);

      const res = await fake(testPlanningDef, makeInput(), makeDeps());

      expect(res.ok).toBe(true);
      expect(fake.calls[0].params.model).toBe("claude-sonnet-4-6");
    });

    it("runs multi-turn tool calls, passes tool_context, and returns validated output", async () => {
      const deps = makeDeps();
      const spyForecast = vi.fn(realTools.get_forecast);
      const spyCandidates = vi.fn(realTools.get_park_candidates);
      const customTools: ToolRegistry = {
        ...realTools,
        get_forecast: spyForecast,
        get_park_candidates: spyCandidates,
      };

      const fake = createFakeRunner([
        {
          tool_calls: [
            { id: "tu-1", name: "get_park_candidates", input: { park_ids: ["park-a"] } },
            {
              id: "tu-2",
              name: "get_forecast",
              input: {
                park_id: "park-a",
                start_time: "2026-10-29T09:00",
                end_time: "2026-10-29T09:45",
              },
            },
          ],
          usage: { input_tokens: 120, output_tokens: 40, elapsed_ms: 10 },
        },
        (call) => {
          // Verify tool_result blocks were appended to the conversation
          const lastMsg = call.params.messages[call.params.messages.length - 1];
          expect(lastMsg.role).toBe("user");
          expect(Array.isArray(lastMsg.content)).toBe(true);
          return {
            tool_calls: [
              { id: "tu-3", name: "check_plan", input: { plan: case01.planningOutput(1).plan } },
            ],
            usage: { input_tokens: 200, output_tokens: 60, elapsed_ms: 15 },
          };
        },
        {
          text: "```json\n" + JSON.stringify(case01.planningOutput(1), null, 2) + "\n```",
          usage: { input_tokens: 250, output_tokens: 150, elapsed_ms: 20 },
        },
      ]);

      const res = await fake(testPlanningDef, makeInput(), { ...deps, tools: customTools });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.output).toEqual(case01.planningOutput(1));
      }
      expect(spyCandidates).toHaveBeenCalledWith({ park_ids: ["park-a"] }, deps.tool_context);
      expect(spyForecast).toHaveBeenCalledWith(
        {
          park_id: "park-a",
          start_time: "2026-10-29T09:00",
          end_time: "2026-10-29T09:45",
        },
        deps.tool_context,
      );
      expect(res.usage).toEqual({
        agent_executions: 1,
        model_requests: 3,
        tool_calls: 3,
        input_tokens: 570,
        output_tokens: 250,
        elapsed_ms: 45,
      });
      expect(deps.budget.used()).toEqual(res.usage);
    });
  });

  describe("tool errors (fail fast)", () => {
    it("fails fast with tool_error when model calls a tool not in allowed_tools", async () => {
      const spyAir = vi.fn(realTools.get_air_quality);
      const deps = makeDeps({
        tools: { ...realTools, get_air_quality: spyAir },
      });
      const fake = createFakeRunner([
        {
          tool_calls: [
            {
              name: "get_air_quality", // not in testPlanningDef.allowed_tools
              input: {
                park_id: "park-a",
                start_time: "2026-10-29T09:00",
                end_time: "2026-10-29T09:45",
              },
            },
          ],
        },
      ]);

      const res = await fake(testPlanningDef, makeInput(), deps);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("tool_error");
        expect(res.error.message).toContain("get_air_quality");
      }
      expect(spyAir).not.toHaveBeenCalled();
      expect(res.usage.tool_calls).toBe(0);
    });

    it("fails fast with tool_error when tool input fails ToolSchemas validation", async () => {
      const spyForecast = vi.fn(realTools.get_forecast);
      const deps = makeDeps({
        tools: { ...realTools, get_forecast: spyForecast },
      });
      const fake = createFakeRunner([
        {
          tool_calls: [
            {
              name: "get_forecast",
              input: { park_id: "", start_time: "not-a-timestamp" }, // invalid
            },
          ],
        },
      ]);

      const res = await fake(testPlanningDef, makeInput(), deps);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("tool_error");
        expect(res.error.message).toContain("get_forecast");
      }
      expect(spyForecast).not.toHaveBeenCalled();
      expect(res.usage.tool_calls).toBe(0);
    });

    it("fails fast with tool_error when a tool handler throws", async () => {
      const deps = makeDeps({
        tools: {
          ...realTools,
          get_park_candidates: () => {
            throw new Error("snapshot read failure");
          },
        },
      });
      const fake = createFakeRunner([
        {
          tool_calls: [{ name: "get_park_candidates", input: { park_ids: null } }],
        },
      ]);

      const res = await fake(testPlanningDef, makeInput(), deps);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("tool_error");
        expect(res.error.message).toContain("snapshot read failure");
      }
      expect(res.usage.tool_calls).toBe(1);
    });
  });

  describe("output validation and single repair attempt", () => {
    it("repairs invalid JSON on the single repair attempt and counts it against budget", async () => {
      const deps = makeDeps();
      const fake = createFakeRunner([
        { text: "{ not valid json", usage: { input_tokens: 100, output_tokens: 30, elapsed_ms: 5 } },
        {
          output: case01.planningOutput(1),
          usage: { input_tokens: 150, output_tokens: 80, elapsed_ms: 7 },
        },
      ]);

      const res = await fake(testPlanningDef, makeInput(), deps);

      expect(res.ok).toBe(true);
      expect(fake.calls).toHaveLength(2);
      expect(res.usage.model_requests).toBe(2);
      expect(res.usage.input_tokens).toBe(250);
      expect(res.usage.output_tokens).toBe(110);
      expect(deps.budget.used().model_requests).toBe(2);
    });

    it("returns invalid_output when both initial output and repair attempt fail schema validation", async () => {
      const deps = makeDeps();
      const fake = createFakeRunner([
        { output: { event_version: 1, evidence_snapshot_id: case01.SNAPSHOT_ID, status: "wrong" } },
        { output: { still: "invalid" } },
        // A 3rd step should never be reached because at most 1 repair attempt is allowed
        { output: case01.planningOutput(1) },
      ]);

      const res = await fake(testPlanningDef, makeInput(), deps);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("invalid_output");
      }
      expect(fake.calls).toHaveLength(2);
      expect(res.usage.model_requests).toBe(2);
    });

    it("asks for up to DEFAULT_MAX_TOKENS output tokens, enough for long specialist answers", async () => {
      const fake = createFakeRunner([{ output: case01.planningOutput(1) }]);

      await fake(testPlanningDef, makeInput(), makeDeps());

      expect(DEFAULT_MAX_TOKENS).toBeGreaterThanOrEqual(16_384);
      expect(fake.calls[0].params.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    });

    it("returns invalid_output immediately without a repair attempt when stop_reason is max_tokens", async () => {
      const deps = makeDeps();
      const fake = createFakeRunner([
        {
          text: '{"event_version": 1, "incomplete": ',
          stop_reason: "max_tokens",
        },
        // Must not be called for repair
        { output: case01.planningOutput(1) },
      ]);

      const res = await fake(testPlanningDef, makeInput(), deps);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("invalid_output");
        expect(res.error.message).toContain("max_tokens");
      }
      expect(fake.calls).toHaveLength(1);
      expect(res.usage.model_requests).toBe(1);
    });
  });

  describe("stale context rejection", () => {
    it("returns stale_context when output event_version does not match input", async () => {
      const fake = createFakeRunner([
        {
          output: {
            ...case01.planningOutput(1),
            event_version: 2, // input has version 1
          },
        },
      ]);

      const res = await fake(testPlanningDef, makeInput(1, case01.SNAPSHOT_ID), makeDeps());

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("stale_context");
        expect(res.error.message).toContain("event_version");
      }
    });

    it("returns stale_context when output evidence_snapshot_id does not match input", async () => {
      const fake = createFakeRunner([
        {
          output: {
            ...case01.planningOutput(1),
            evidence_snapshot_id: "snap-outdated",
          },
        },
      ]);

      const res = await fake(testPlanningDef, makeInput(1, case01.SNAPSHOT_ID), makeDeps());

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("stale_context");
        expect(res.error.message).toContain("evidence_snapshot_id");
      }
    });
  });

  describe("budget tracking and exhaustion", () => {
    it("returns budget_exhausted when agent_executions limit is already reached", async () => {
      const budget = createBudget({ ...DEFAULT_LIMITS, agent_executions: 0 });
      const fake = createFakeRunner([{ output: case01.planningOutput(1) }]);

      const res = await fake(testPlanningDef, makeInput(), makeDeps({ budget }));

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("budget_exhausted");
      }
      expect(fake.calls).toHaveLength(0);
    });

    it("returns budget_exhausted when repair attempt exceeds model_requests cap", async () => {
      const budget = createBudget({ ...DEFAULT_LIMITS, model_requests: 1 });
      const fake = createFakeRunner([
        { text: "not json" },
        { output: case01.planningOutput(1) },
      ]);

      const res = await fake(testPlanningDef, makeInput(), makeDeps({ budget }));

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("budget_exhausted");
      }
      expect(fake.calls).toHaveLength(1);
    });

    it("returns budget_exhausted when tool_calls limit is exceeded", async () => {
      const budget = createBudget({ ...DEFAULT_LIMITS, tool_calls: 1 });
      const fake = createFakeRunner([
        {
          tool_calls: [
            { name: "get_park_candidates", input: { park_ids: null } },
            {
              name: "get_forecast",
              input: {
                park_id: "park-a",
                start_time: "2026-10-29T09:00",
                end_time: "2026-10-29T09:45",
              },
            },
          ],
        },
      ]);

      const res = await fake(testPlanningDef, makeInput(), makeDeps({ budget }));

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("budget_exhausted");
      }
      expect(res.usage.tool_calls).toBe(1);
    });

    it("returns budget_exhausted when token usage (including cache tokens) exceeds limit", async () => {
      const budget = createBudget({ ...DEFAULT_LIMITS, input_tokens: 150 });
      const fake = createFakeRunner([
        {
          output: case01.planningOutput(1),
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 40,
            cache_read_input_tokens: 20,
            output_tokens: 50,
          },
        },
      ]);

      const res = await fake(testPlanningDef, makeInput(), makeDeps({ budget }));

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("budget_exhausted");
      }
      expect(res.usage.input_tokens).toBe(160);
    });

    it("passes remaining elapsed_ms as per-request timeout and returns budget_exhausted when no time remains", async () => {
      const budget = createBudget({ ...DEFAULT_LIMITS, elapsed_ms: 100 });
      budget.record({ elapsed_ms: 40 });
      const fake = createFakeRunner([
        { output: case01.planningOutput(1), usage: { elapsed_ms: 60 } },
      ]);

      const res1 = await fake(testPlanningDef, makeInput(), makeDeps({ budget }));
      expect(res1.ok).toBe(true);
      expect(fake.calls[0].options).toEqual({ timeout: 60 });

      // Now elapsed_ms is 100/100 (0 remaining): next call must fail before calling the client
      const fake2 = createFakeRunner([{ output: case01.planningOutput(1) }]);
      const res2 = await fake2(testPlanningDef, makeInput(), makeDeps({ budget }));
      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.error.kind).toBe("budget_exhausted");
      }
      expect(fake2.calls).toHaveLength(0);
    });

    it("returns budget_exhausted when exceeding MAX_TURNS_PER_EXECUTION (counting repair)", async () => {
      // 7 tool-call turns + 1 invalid output turn = 8 turns; the 9th turn (repair) exceeds MAX_TURNS_PER_EXECUTION (8)
      const toolTurns = Array.from({ length: MAX_TURNS_PER_EXECUTION - 1 }, () => ({
        tool_calls: [{ name: "get_park_candidates", input: { park_ids: ["park-a"] } }],
      }));
      const fake = createFakeRunner([
        ...toolTurns,
        { text: "{ invalid json on turn 8" },
        { output: case01.planningOutput(1) },
      ]);

      const res = await fake(testPlanningDef, makeInput(), makeDeps());

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("budget_exhausted");
        expect(res.error.message).toContain(String(MAX_TURNS_PER_EXECUTION));
      }
      expect(fake.calls).toHaveLength(MAX_TURNS_PER_EXECUTION);
      expect(res.usage.model_requests).toBe(MAX_TURNS_PER_EXECUTION);
    });
  });

  describe("API / model errors", () => {
    it("never throws when the SDK throws an error and returns model_error", async () => {
      const fake = createFakeRunner([{ error: new Error("529 Overloaded") }]);

      const res = await fake(testPlanningDef, makeInput(), makeDeps());

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("model_error");
        expect(res.error.message).toContain("529 Overloaded");
      }
      expect(res.usage.model_requests).toBe(1);
    });

    it("returns model_error without throwing when ANTHROPIC_API_KEY is missing on default runner", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const runner = createRunner();

      const res = await runner(testPlanningDef, makeInput(), makeDeps());

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe("model_error");
        expect(res.error.message).toContain("ANTHROPIC_API_KEY");
      }
    });
  });

  describe("fakeRunner.install()", () => {
    it("temporarily routes the shared runAgent export through the fake runner", async () => {
      const fake = createFakeRunner([{ output: case01.planningOutput(1) }]);
      const restore = fake.install();
      try {
        const res = await runAgent(testPlanningDef, makeInput(), makeDeps());
        expect(res.ok).toBe(true);
        expect(fake.calls).toHaveLength(1);
      } finally {
        restore();
      }
    });
  });
});

