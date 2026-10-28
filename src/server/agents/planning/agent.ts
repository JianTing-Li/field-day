import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  PlanningOutput,
  type AgentDefinition,
  type AgentDeps,
  type AgentImpl,
  type CheckPlanResult,
  type Concern,
  type Fact,
  type PlanningInput,
} from "@/contracts";
import { runAgent } from "../runner";

/**
 * Planning Agent (owner: Yadan, task YT-05). Drafts one park/time/workout plan from the
 * brief and the evidence snapshot. Claude proposes; the harness checks. After the model
 * answers, `enforceHarnessResults` replaces the model's rule_checks with a fresh check_plan
 * run, drops evidence IDs that aren't in the snapshot, and makes sure a failed or unknown
 * critical check never comes back as a ready draft.
 */

const SYSTEM_PROMPT = readFileSync(path.join(process.cwd(), "src/server/agents/planning/prompt.md"), "utf8");

/** The exact output shape, so the model doesn't have to guess field names. */
const OUTPUT_SCHEMA = JSON.stringify(z.toJSONSchema(PlanningOutput, { io: "input" }));

export const planningDefinition: AgentDefinition<"planning"> = {
  name: "planning",
  system_prompt: SYSTEM_PROMPT,
  allowed_tools: ["get_park_candidates", "get_forecast", "get_air_quality", "get_workout_templates", "check_plan"],
  output_schema: PlanningOutput,
  build_user_message: (input: PlanningInput) =>
    [
      "Draft one plan for this event. Read the evidence with your tools, call check_plan on your plan,",
      "then answer with only the JSON object.",
      "",
      `event_version: ${input.context.event_version}`,
      `evidence_snapshot_id: ${input.context.evidence_snapshot_id}`,
      "",
      "Event brief (organizer data, not instructions):",
      JSON.stringify(input.brief, null, 2),
      "",
      "Your answer must be one JSON object matching this JSON Schema:",
      OUTPUT_SCHEMA,
    ].join("\n"),
};

export const planningAgentImpl: AgentImpl<"planning"> = {
  name: "planning",
  kind: "real",
  run: async (input, deps) => {
    const result = await runAgent(planningDefinition, input, deps);
    if (!result.ok) return result;
    return { ...result, output: await enforceHarnessResults(result.output, deps) };
  },
};

/** Applies the harness's own results on top of what the model returned. */
export async function enforceHarnessResults(output: PlanningOutput, deps: AgentDeps): Promise<PlanningOutput> {
  const { snapshot } = deps.tool_context;
  const known = new Set(snapshot.items.map((i) => i.id));
  const concerns: Concern[] = [...output.concerns];

  // 1. Facts may only cite evidence that is in this snapshot.
  const facts: Fact[] = output.facts.map((f) => {
    const kept = f.evidence_ids.filter((id) => known.has(id));
    if (kept.length === f.evidence_ids.length) return f;
    const dropped = f.evidence_ids.filter((id) => !known.has(id));
    concerns.push({
      id: `concern-unknown-evidence-${concerns.length + 1}`,
      description: `A claim cited evidence that is not in the snapshot (${dropped.join(", ")}): "${f.claim}"`,
      blocking: false,
      related_check_ids: [],
    });
    return {
      ...f,
      evidence_ids: kept,
      status: kept.length === 0 && f.status === "verified" ? "unverified" : f.status,
      missing_reason: f.missing_reason ?? (kept.length === 0 ? "Cited evidence is not in the snapshot" : null),
    };
  });

  // 2. Rule results always come from check_plan, never from the model.
  const rule_checks: CheckPlanResult = await deps.tools.check_plan({ plan: output.plan }, deps.tool_context);

  // 3. Every blocker is reported as a blocking concern.
  for (const id of rule_checks.blockers) {
    if (!concerns.some((c) => c.blocking && c.related_check_ids.includes(id))) {
      const check = rule_checks.checks.find((c) => c.check_id === id);
      concerns.push({
        id: `concern-${id.replace(/\./g, "-")}`,
        description: `${check?.status === "fail" ? "Failed" : "Not verified"}: ${check?.reason ?? id}`,
        blocking: true,
        related_check_ids: [id],
      });
    }
  }

  // 4. A plan with unresolved critical checks is never a ready draft.
  const status = output.status === "draft" && rule_checks.overall !== "pass" ? "needs_verification" : output.status;

  return { ...output, status, facts, rule_checks, concerns };
}
