import type {
  ContentBlock,
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages/messages";
import type { AgentDeps, AgentIO, AgentName, AgentResult, AgentDefinition, RunAgent } from "@/contracts";
import {
  createRunner,
  DEFAULT_ANTHROPIC_MODEL,
  setRunnerForTesting,
  type AnthropicMessageClient,
} from "./runner";

/**
 * Scripted fake runner for agent unit tests (owner: JT, task JT-01).
 *
 * Runs the real `createRunner` pipeline (prompt building, `allowed_tools` filtering,
 * `ToolSchemas` input/output validation, `deps.tools` execution with `deps.tool_context`,
 * `output_schema` validation + single repair attempt, `stale_context` check, and
 * `deps.budget` usage tracking) against an in-memory scripted Claude client with
 * zero network calls.
 *
 * ## How to use in agent tests (YT-05, YT-06, JT-12, JT-13)
 *
 * ### Pattern 1 — Pass `fakeRunner` directly to `definition`:
 * ```ts
 * import { createFakeRunner } from "@/server/agents/fake-runner";
 * import { createBudget } from "@/server/orchestrator/budget";
 * import { tools } from "@/server/tools";
 * import { case01 } from "@fixtures/scenarios";
 * import { planningDefinition } from "./agent";
 *
 * const fake = createFakeRunner([
 *   {
 *     tool_calls: [
 *       { name: "get_park_candidates", input: { park_ids: ["park-a"] } },
 *       {
 *         name: "get_forecast",
 *         input: { park_id: "park-a", start_time: "2026-10-29T09:00", end_time: "2026-10-29T09:45" },
 *       },
 *       { name: "check_plan", input: { plan: case01.planningOutput(1).plan } },
 *     ],
 *   },
 *   { output: case01.planningOutput(1) },
 * ]);
 *
 * const result = await fake(planningDefinition, input, {
 *   tools,
 *   tool_context: { snapshot: case01.snapshot("evt-1", 1), brief: case01.brief, event_version: 1 },
 *   budget: createBudget(),
 * });
 * expect(result.ok).toBe(true);
 * expect(fake.calls).toHaveLength(2);
 * ```
 *
 * ### Pattern 2 — Install temporarily when calling `planningAgent.run(input, deps)`:
 * ```ts
 * const fake = createFakeRunner([{ output: case01.planningOutput(1) }]);
 * const restore = fake.install();
 * try {
 *   const result = await planningAgent.run(input, deps);
 *   expect(result.ok).toBe(true);
 * } finally {
 *   restore();
 * }
 * ```
 */

export interface FakeToolCallSpec {
  /** Optional custom tool_use block ID (defaults to `toolu_fake_<turn>_<index>`). */
  id?: string;
  /** Tool name (may be any string so tests can also verify disallowed tool names). */
  name: string;
  /** Raw tool input sent in the simulated `tool_use` block. */
  input: unknown;
}

export interface FakeUsageSpec {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /** Simulated wall-clock duration in milliseconds for this model call (default: 5). */
  elapsed_ms?: number;
}

export interface FakeToolCallStep {
  /** One or more tool calls the simulated model wants to make on this turn. */
  tool_calls?: FakeToolCallSpec[];
  /** Alias for `tool_calls`. */
  toolCalls?: FakeToolCallSpec[];
  /** Optional text block accompanying the tool calls. */
  text?: string;
  /** Optional override for stop_reason (defaults to "tool_use"). */
  stop_reason?: Message["stop_reason"];
  /** Optional token/time usage for this turn. */
  usage?: FakeUsageSpec;
}

export interface FakeOutputStep {
  /** Final JSON output object (serialized with JSON.stringify) or raw text string. */
  output?: unknown;
  /** Raw text output (useful for testing malformed JSON or fenced code blocks). */
  text?: string;
  /** Optional override for stop_reason (defaults to "end_turn"). */
  stop_reason?: Message["stop_reason"];
  /** Optional token/time usage for this turn. */
  usage?: FakeUsageSpec;
}

export interface FakeErrorStep {
  /** Error to throw from `client.messages.create` to simulate an API/network failure. */
  error: Error | string;
  /** Optional elapsed time before failing (default: 5). */
  elapsed_ms?: number;
}

export type FakeStepObject = FakeToolCallStep | FakeOutputStep | FakeErrorStep;

export interface RecordedModelCall {
  /** 0-based turn index within this fake runner. */
  turn: number;
  /** Raw parameters passed to `client.messages.create`. */
  params: MessageCreateParamsNonStreaming;
  /** Request options (such as per-request `timeout`) passed to `client.messages.create`. */
  options?: { timeout?: number };
}

export type FakeStep =
  | FakeStepObject
  | ((call: RecordedModelCall, turn: number) => FakeStepObject | Promise<FakeStepObject>);

export interface FakeRunnerOptions {
  /** Model override passed to `createRunner`. */
  model?: string;
  /** Default token/time usage applied when a step omits `usage`. */
  defaultUsage?: FakeUsageSpec;
}

export interface FakeRunner extends RunAgent {
  /** Alias for calling the fake runner directly (`fake.runAgent(def, input, deps)`). */
  runAgent: RunAgent;
  /** Underlying mocked Anthropic client. */
  client: AnthropicMessageClient;
  /** Recorded `messages.create` calls in order. */
  calls: RecordedModelCall[];
  /**
   * Installs this fake runner as the active `runAgent` export in `src/server/agents/runner.ts`.
   * Returns a `restore()` function to reset the active runner after the test.
   */
  install: () => () => void;
}

function isErrorStep(step: FakeStepObject): step is FakeErrorStep {
  return "error" in step && step.error !== undefined;
}

function getToolCalls(step: FakeStepObject): FakeToolCallSpec[] | undefined {
  if ("tool_calls" in step && Array.isArray(step.tool_calls)) {
    return step.tool_calls;
  }
  if ("toolCalls" in step && Array.isArray(step.toolCalls)) {
    return step.toolCalls;
  }
  return undefined;
}

export function createFakeRunner(steps: FakeStep[], options: FakeRunnerOptions = {}): FakeRunner {
  const calls: RecordedModelCall[] = [];
  let clockMs = 1_000;
  let stepCursor = 0;

  const defaultInputTokens = options.defaultUsage?.input_tokens ?? 100;
  const defaultOutputTokens = options.defaultUsage?.output_tokens ?? 50;
  const defaultElapsedMs = options.defaultUsage?.elapsed_ms ?? 5;

  const client: AnthropicMessageClient = {
    messages: {
      create: async (
        params: MessageCreateParamsNonStreaming,
        requestOptions?: { timeout?: number },
      ): Promise<Message> => {
        const turn = calls.length;
        const recorded: RecordedModelCall = { turn, params, options: requestOptions };
        calls.push(recorded);

        const rawStep = steps[stepCursor++];
        if (!rawStep) {
          throw new Error(
            `FakeRunner exhausted scripted steps at turn ${turn} (only ${steps.length} step(s) configured)`,
          );
        }

        const step = typeof rawStep === "function" ? await rawStep(recorded, turn) : rawStep;

        if (isErrorStep(step)) {
          clockMs += step.elapsed_ms ?? defaultElapsedMs;
          throw typeof step.error === "string" ? new Error(step.error) : step.error;
        }

        const stepUsage = step.usage;
        clockMs += stepUsage?.elapsed_ms ?? defaultElapsedMs;

        const toolCalls = getToolCalls(step);
        const content: ContentBlock[] = [];

        if (toolCalls && toolCalls.length > 0) {
          if (step.text) {
            content.push({
              type: "text",
              text: step.text,
              citations: null,
            });
          }
          toolCalls.forEach((tc, idx) => {
            content.push({
              type: "tool_use",
              id: tc.id ?? `toolu_fake_${turn}_${idx}`,
              name: tc.name,
              input: tc.input,
              caller: { type: "direct" },
            });
          });
        } else {
          const textPayload =
            "text" in step && typeof step.text === "string"
              ? step.text
              : "output" in step && step.output !== undefined
                ? typeof step.output === "string"
                  ? step.output
                  : JSON.stringify(step.output)
                : "";
          content.push({
            type: "text",
            text: textPayload,
            citations: null,
          });
        }

        const stopReason =
          "stop_reason" in step && step.stop_reason !== undefined
            ? step.stop_reason
            : toolCalls && toolCalls.length > 0
              ? "tool_use"
              : "end_turn";

        return {
          id: `msg_fake_${turn}`,
          type: "message",
          role: "assistant",
          model: params.model || DEFAULT_ANTHROPIC_MODEL,
          content,
          container: null,
          diagnostics: null,
          stop_details: null,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: {
            input_tokens: stepUsage?.input_tokens ?? defaultInputTokens,
            output_tokens: stepUsage?.output_tokens ?? defaultOutputTokens,
            cache_creation: null,
            cache_creation_input_tokens: stepUsage?.cache_creation_input_tokens ?? null,
            cache_read_input_tokens: stepUsage?.cache_read_input_tokens ?? null,
            inference_geo: null,
            output_tokens_details: null,
            server_tool_use: null,
            service_tier: "standard",
            speed: "standard",
          },
        };
      },
    },
  };

  const innerRunner = createRunner({
    client,
    model: options.model,
    now: () => clockMs,
  });

  const fakeRunner = (<N extends AgentName>(
    definition: AgentDefinition<N>,
    input: AgentIO[N]["input"],
    deps: AgentDeps,
  ): Promise<AgentResult<N>> => innerRunner(definition, input, deps)) as FakeRunner;

  fakeRunner.runAgent = innerRunner;
  fakeRunner.client = client;
  fakeRunner.calls = calls;
  fakeRunner.install = () => setRunnerForTesting(innerRunner);

  return fakeRunner;
}

