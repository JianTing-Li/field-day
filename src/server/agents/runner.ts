import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { z } from "zod";
import {
  ToolSchemas,
  ZERO_USAGE,
  type AgentDefinition,
  type AgentDeps,
  type AgentErrorKind,
  type AgentIO,
  type AgentName,
  type AgentResult,
  type RunAgent,
  type ToolHandler,
  type ToolName,
  type Usage,
} from "@/contracts";

/** Default model ID used when ANTHROPIC_MODEL is not set (see D-022 in docs/decisions.md). */
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

/** Maximum model turns per single agent execution, including the optional repair turn. */
export const MAX_TURNS_PER_EXECUTION = 8;

const DEFAULT_MAX_TOKENS = 4096;

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_park_candidates:
    "Read park candidates and park-time candidates from the bound evidence snapshot.",
  get_forecast:
    "Read weather forecast evidence items and coverage gaps for a park and time window from the bound evidence snapshot.",
  get_air_quality:
    "Read air quality evidence items and coverage gaps for a park and time window from the bound evidence snapshot.",
  get_workout_templates:
    "Read workout templates from the bound evidence snapshot.",
  check_plan:
    "Run deterministic harness policy and rule checks against a candidate event plan.",
};

/** Minimal Anthropic Messages client interface used by the runner. */
export interface AnthropicMessageClient {
  messages: {
    create: (
      params: MessageCreateParamsNonStreaming,
      options?: { timeout?: number },
    ) => Promise<Message>;
  };
}

export interface RunnerOptions {
  /** Injected client for unit tests / fake runner. Defaults to the Anthropic SDK client. */
  client?: AnthropicMessageClient;
  /** Explicit model override. Defaults to process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL. */
  model?: string;
  /** Max output tokens per request. Defaults to 4096. */
  maxTokens?: number;
  /** Clock function for elapsed_ms measurement. Defaults to Date.now. */
  now?: () => number;
}

function buildAnthropicTools(allowedTools: ToolName[]): Tool[] {
  const uniqueTools = Array.from(new Set(allowedTools));
  return uniqueTools.map((name) => {
    const rawSchema = {
      ...(z.toJSONSchema(ToolSchemas[name].input) as Record<string, unknown>),
    };
    delete rawSchema.$schema;
    return {
      name,
      description: TOOL_DESCRIPTIONS[name],
      input_schema: {
        ...rawSchema,
        type: "object",
      },
    };
  });
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function extractTextContent(message: Message): string {
  return message.content
    .filter((block): block is Extract<Message["content"][number], { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function parseJsonText(text: string): { ok: true; data: unknown } | { ok: false; error: string } {
  if (!text) {
    return { ok: false, error: "Model returned empty text output instead of JSON" };
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (firstErr) {
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch && fencedMatch[1]) {
      try {
        return { ok: true, data: JSON.parse(fencedMatch[1].trim()) };
      } catch (secondErr) {
        return {
          ok: false,
          error: `Invalid JSON inside code block: ${secondErr instanceof Error ? secondErr.message : String(secondErr)}`,
        };
      }
    }
    return {
      ok: false,
      error: `Invalid JSON output: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}`,
    };
  }
}

function resolveDefaultClient(): AnthropicMessageClient {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  return new Anthropic({ apiKey, maxRetries: 1 });
}

/**
 * Creates an agent runner with optional injected client/clock for testing.
 */
export function createRunner(options: RunnerOptions = {}): RunAgent {
  const now = options.now ?? Date.now;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  return async function runAgentWithOptions<N extends AgentName>(
    definition: AgentDefinition<N>,
    input: AgentIO[N]["input"],
    deps: AgentDeps,
  ): Promise<AgentResult<N>> {
    const usage: Usage = { ...ZERO_USAGE };

    const fail = (kind: AgentErrorKind, message: string): AgentResult<N> => ({
      ok: false,
      error: { kind, message },
      usage: { ...usage },
    });

    if (!deps.budget.record({ agent_executions: 1 })) {
      return fail("budget_exhausted", `Agent execution limit exceeded before running ${definition.name}`);
    }
    usage.agent_executions += 1;

    const model = options.model ?? (process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL);
    const allowedSet = new Set<ToolName>(definition.allowed_tools);
    const anthropicTools = buildAnthropicTools(definition.allowed_tools);

    const messages: MessageParam[] = [
      {
        role: "user",
        content: definition.build_user_message(input),
      },
    ];

    const callModel = async (): Promise<
      { ok: true; message: Message } | { ok: false; result: AgentResult<N> }
    > => {
      if (usage.model_requests >= MAX_TURNS_PER_EXECUTION) {
        return {
          ok: false,
          result: fail(
            "budget_exhausted",
            `Per-execution turn limit (${MAX_TURNS_PER_EXECUTION}) exceeded in ${definition.name}`,
          ),
        };
      }

      const remainingMs = deps.budget.limits.elapsed_ms - deps.budget.used().elapsed_ms;
      if (remainingMs <= 0) {
        return {
          ok: false,
          result: fail("budget_exhausted", `Elapsed time budget exhausted before calling ${definition.name}`),
        };
      }

      if (!deps.budget.record({ model_requests: 1 })) {
        return {
          ok: false,
          result: fail("budget_exhausted", `Model request limit exceeded in ${definition.name}`),
        };
      }
      usage.model_requests += 1;

      const startMs = now();
      let response: Message;
      try {
        const client = options.client ?? resolveDefaultClient();
        const params: MessageCreateParamsNonStreaming = {
          model,
          max_tokens: maxTokens,
          system: definition.system_prompt,
          messages: [...messages],
          ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
        };
        response = await client.messages.create(params, { timeout: remainingMs });
      } catch (err) {
        const elapsedMs = Math.max(0, now() - startMs);
        usage.elapsed_ms += elapsedMs;
        deps.budget.record({ elapsed_ms: elapsedMs });
        return {
          ok: false,
          result: fail(
            "model_error",
            `Anthropic API error in ${definition.name}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        };
      }

      const elapsedMs = Math.max(0, now() - startMs);
      const inputTokens =
        response.usage.input_tokens +
        (response.usage.cache_creation_input_tokens ?? 0) +
        (response.usage.cache_read_input_tokens ?? 0);
      const outputTokens = response.usage.output_tokens;

      usage.input_tokens += inputTokens;
      usage.output_tokens += outputTokens;
      usage.elapsed_ms += elapsedMs;

      if (
        !deps.budget.record({
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          elapsed_ms: elapsedMs,
        })
      ) {
        return {
          ok: false,
          result: fail("budget_exhausted", `Token or elapsed time budget exceeded in ${definition.name}`),
        };
      }

      return { ok: true, message: response };
    };

    // 1. Run initial call and tool loop
    let currentMessage: Message;
    while (true) {
      const step = await callModel();
      if (!step.ok) return step.result;
      currentMessage = step.message;

      if (currentMessage.stop_reason === "max_tokens") {
        return fail(
          "invalid_output",
          `Model response truncated at max_tokens in ${definition.name}`,
        );
      }

      const toolUses = currentMessage.content.filter(
        (block): block is ToolUseBlock => block.type === "tool_use",
      );

      if (toolUses.length === 0) {
        break;
      }

      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        if (!allowedSet.has(toolUse.name as ToolName)) {
          return fail(
            "tool_error",
            `Tool "${toolUse.name}" is not in allowed_tools for agent "${definition.name}"`,
          );
        }

        const toolName = toolUse.name as ToolName;
        const toolSchema = ToolSchemas[toolName];
        const parsedInput = toolSchema.input.safeParse(toolUse.input);
        if (!parsedInput.success) {
          return fail(
            "tool_error",
            `Invalid input for tool "${toolName}": ${formatZodIssues(parsedInput.error)}`,
          );
        }

        if (!deps.budget.record({ tool_calls: 1 })) {
          return fail("budget_exhausted", `Tool call limit exceeded in ${definition.name}`);
        }
        usage.tool_calls += 1;

        const handler = deps.tools[toolName] as ToolHandler<ToolName>;
        let rawToolOutput: unknown;
        try {
          rawToolOutput = await handler(parsedInput.data as never, deps.tool_context);
        } catch (err) {
          return fail(
            "tool_error",
            `Tool "${toolName}" threw an error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        const parsedToolOutput = toolSchema.output.safeParse(rawToolOutput);
        if (!parsedToolOutput.success) {
          return fail(
            "tool_error",
            `Tool "${toolName}" returned invalid output: ${formatZodIssues(parsedToolOutput.error)}`,
          );
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(parsedToolOutput.data),
        });
      }

      messages.push({
        role: "assistant",
        content: currentMessage.content as ContentBlockParam[],
      });
      messages.push({
        role: "user",
        content: toolResults,
      });
    }

    // 2. Validate final JSON output (with at most 1 repair attempt, counted against budget)
    const validateMessageOutput = (
      msg: Message,
    ): { ok: true; data: AgentIO[N]["output"] } | { ok: false; reason: string } => {
      if (msg.stop_reason === "max_tokens") {
        return { ok: false, reason: `Model response truncated at max_tokens in ${definition.name}` };
      }

      const unexpectedToolUse = msg.content.some((block) => block.type === "tool_use");
      if (unexpectedToolUse) {
        return { ok: false, reason: "Model requested tool_use during output repair instead of returning JSON" };
      }

      const rawText = extractTextContent(msg);
      const jsonResult = parseJsonText(rawText);
      if (!jsonResult.ok) {
        return { ok: false, reason: jsonResult.error };
      }

      const schemaResult = definition.output_schema.safeParse(jsonResult.data);
      if (!schemaResult.success) {
        return {
          ok: false,
          reason: `Output failed ${definition.name} schema validation: ${formatZodIssues(schemaResult.error)}`,
        };
      }

      return { ok: true, data: schemaResult.data };
    };

    let validation = validateMessageOutput(currentMessage);
    if (!validation.ok) {
      messages.push({
        role: "assistant",
        content: currentMessage.content as ContentBlockParam[],
      });
      messages.push({
        role: "user",
        content: `Your previous response was invalid (${validation.reason}). Respond ONLY with a valid JSON object matching the required output schema. Do not call any tools or include extra commentary.`,
      });

      const repairStep = await callModel();
      if (!repairStep.ok) return repairStep.result;

      validation = validateMessageOutput(repairStep.message);
      if (!validation.ok) {
        return fail("invalid_output", validation.reason);
      }
    }

    const validatedOutput = validation.data;

    // 3. Reject stale context (event_version or evidence_snapshot_id mismatch)
    if (
      validatedOutput.event_version !== input.context.event_version ||
      validatedOutput.evidence_snapshot_id !== input.context.evidence_snapshot_id
    ) {
      return fail(
        "stale_context",
        `Output context mismatch: expected event_version=${input.context.event_version} and evidence_snapshot_id=${input.context.evidence_snapshot_id}, got event_version=${validatedOutput.event_version} and evidence_snapshot_id=${validatedOutput.evidence_snapshot_id}`,
      );
    }

    return {
      ok: true,
      output: validatedOutput,
      usage: { ...usage },
    };
  };
}

let activeRunner: RunAgent = createRunner();

/**
 * Shared agent runner. Sends system prompt + build_user_message(input) to Claude,
 * runs the read-only tool loop against deps.tools, validates final JSON against
 * definition.output_schema (with at most 1 repair attempt), rejects stale context,
 * and records all usage against deps.budget.
 */
export const runAgent: RunAgent = (definition, input, deps) =>
  activeRunner(definition, input, deps);

/**
 * Replaces the active runner implementation (used by fake-runner in agent tests)
 * and returns a restore function to reset it back.
 */
export function setRunnerForTesting(runner: RunAgent | null): () => void {
  const previous = activeRunner;
  activeRunner = runner ?? createRunner();
  return () => {
    activeRunner = previous;
  };
}
