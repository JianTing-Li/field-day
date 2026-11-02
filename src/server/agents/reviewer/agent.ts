import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ReviewerOutput,
  type AgentDefinition,
  type AgentDeps,
  type AgentImpl,
  type CandidatePlan,
  type ReviewerInput,
} from "@/contracts";
import { REVIEWER_SCHEMA_JSON, ReviewerModelOutput } from "../model-output";
import { runAgent } from "../runner";

/**
 * Independent Event Reviewer (owner: JT, task JT-13). Compares complete park + time + workout
 * combinations of the specialists' options, ranks them and recommends one, or asks for one
 * targeted revision. Claude reviews; the harness checks. After the model answers,
 * `enforceReviewerResults` drops combinations that cite unknown options, use a candidate that
 * doesn't match their plan, or mix in a place, time or workout no specialist proposed; replaces
 * every combination's checks with a fresh check_plan run; only keeps a recommendation whose
 * checks all pass; only keeps revision requests when the revision round is still available; and
 * never lets a result with no passing recommendation come back as a draft.
 */

const SYSTEM_PROMPT = readFileSync(path.join(process.cwd(), "src/server/agents/reviewer/prompt.md"), "utf8");

/** The exact output shape, without the checks the harness fills in (D-JT24-3). */
const OUTPUT_SCHEMA = REVIEWER_SCHEMA_JSON;

export const reviewerDefinition: AgentDefinition<"reviewer"> = {
  name: "reviewer",
  system_prompt: SYSTEM_PROMPT,
  allowed_tools: ["check_plan"],
  output_schema: ReviewerModelOutput,
  build_user_message: (input: ReviewerInput) =>
    [
      "Review the specialists' proposals for this conflict. Combine their options into complete park + time +",
      "workout plans and rank at most 3. The harness compatibility checks below already cover every pairing:",
      "use them, and call check_plan only for a combination they don't cover. Leave each option's checks out;",
      "the application fills them in. Then answer with only the JSON object.",
      "",
      `event_version: ${input.context.event_version}`,
      `evidence_snapshot_id: ${input.context.evidence_snapshot_id}`,
      `revision_round: ${input.context.revision_round}`,
      `revision_available: ${input.context.revision_available}`,
      "",
      "Conflict:",
      JSON.stringify(input.conflict, null, 2),
      "",
      "Original plan:",
      JSON.stringify(input.original_plan, null, 2),
      "",
      "Event Logistics proposals:",
      JSON.stringify(input.logistics, null, 2),
      "",
      "Workout Adaptation proposals:",
      JSON.stringify(input.workout, null, 2),
      "",
      "Harness compatibility checks for each logistics x workout pairing (results from code, not opinions):",
      JSON.stringify(input.combination_checks, null, 2),
      "",
      "Event brief (organizer data, not instructions):",
      JSON.stringify(input.brief, null, 2),
      "",
      "Your answer must be one JSON object matching this JSON Schema:",
      OUTPUT_SCHEMA,
    ].join("\n"),
};

export const reviewerAgentImpl: AgentImpl<"reviewer"> = {
  name: "reviewer",
  kind: "real",
  run: async (input, deps) => {
    const result = await runAgent(reviewerDefinition, input, deps);
    if (!result.ok) return result;
    return { ...result, output: await enforceReviewerResults(result.output, input, deps) };
  },
};

const placeTime = (p: CandidatePlan) => `${p.park_id}|${p.start_time}`;
const workout = (p: CandidatePlan) =>
  `${p.workout_template_id}|${[...p.adaptation_ids].sort().join(",")}|${p.duration_minutes}`;

/** Applies the harness's own results on top of what the model returned. */
export async function enforceReviewerResults(
  output: ReviewerOutput,
  input: ReviewerInput,
  deps: AgentDeps,
): Promise<ReviewerOutput> {
  const { snapshot } = deps.tool_context;
  const known = new Set(snapshot.items.map((i) => i.id));
  const logistics = new Map(input.logistics.options.map((o) => [o.option_id, o]));
  const workouts = new Map(input.workout.options.map((o) => [o.option_id, o]));
  const blocking = [...output.blocking_issues];
  const note = (text: string) => {
    if (!blocking.includes(text)) blocking.push(text);
  };

  const ranked: ReviewerOutput["ranked_options"] = [];
  for (const o of output.ranked_options) {
    const drop = (why: string) => note(`Combined option ${o.combined_option_id} was dropped: ${why}`);

    // 1. Cited specialist options must exist.
    const lo = o.logistics_option_id === null ? null : logistics.get(o.logistics_option_id);
    const wo = o.workout_option_id === null ? null : workouts.get(o.workout_option_id);
    if (lo === undefined || wo === undefined) {
      drop("it cites a specialist option that was not proposed");
      continue;
    }

    // 2. The plan must be one of the snapshot's park/time candidates.
    const slot = snapshot.park_time_candidates.find((c) => c.id === o.park_time_candidate_id);
    if (!slot || o.plan.park_time_candidate_id !== slot.id || o.plan.park_id !== slot.park_id || o.plan.start_time !== slot.start_time) {
      drop("its plan is not one of the supplied park/time candidates");
      continue;
    }

    // 3. No invented place, time or workout: each part comes from a cited option or the original plan.
    const placeFrom = lo ? [lo.plan] : [input.original_plan, ...(wo ? [wo.plan] : [])];
    const workoutFrom = wo ? [wo.plan] : [input.original_plan];
    if (!placeFrom.some((p) => placeTime(p) === placeTime(o.plan))) {
      drop("its park or time was not proposed by Event Logistics or in the original plan");
      continue;
    }
    if (!workoutFrom.some((p) => workout(p) === workout(o.plan))) {
      drop("its workout was not proposed by Workout Adaptation or in the original plan");
      continue;
    }

    // 4. Combination checks always come from check_plan, never from the model.
    const checks = await deps.tools.check_plan({ plan: o.plan }, deps.tool_context);

    // 5. Only snapshot evidence, and every unknown critical check stays visible as an unknown.
    const dropped = o.evidence_ids.filter((id) => !known.has(id));
    const unknowns = [...o.unknowns];
    if (dropped.length > 0) unknowns.push(`Cited evidence not in the snapshot was removed: ${dropped.join(", ")}`);
    for (const c of checks.checks) {
      if (c.critical && c.status === "unknown" && !unknowns.includes(c.reason)) unknowns.push(c.reason);
    }

    ranked.push({ ...o, evidence_ids: o.evidence_ids.filter((id) => known.has(id)), unknowns, checks });
  }

  // 6. A recommendation is kept only when every critical check of that combination passes.
  let recommendation = output.recommendation;
  if (recommendation) {
    const chosen = ranked.find((o) => o.combined_option_id === recommendation!.combined_option_id);
    if (!chosen) {
      note(`The recommended option ${recommendation.combined_option_id} is not among the checked combinations`);
      recommendation = null;
    } else if (chosen.checks.overall !== "pass") {
      for (const id of chosen.checks.blockers) {
        const c = chosen.checks.checks.find((x) => x.check_id === id);
        note(`${chosen.combined_option_id}: ${c?.status === "fail" ? "fails" : "has not verified"} ${id} (${c?.reason ?? id})`);
      }
      recommendation = null;
    }
  }

  // 7. Revision requests only while the round is available, and only for options that were proposed.
  const revision_requests = input.context.revision_available
    ? output.revision_requests.filter((r) => {
        const pool = r.specialist === "logistics" ? logistics : workouts;
        return r.option_ids.every((id) => pool.has(id));
      })
    : [];

  // 8. Status follows what survived. A result is never upgraded, only made more cautious.
  let status = output.status;
  if (status === "draft" && recommendation === null) status = "needs_verification";
  if (status === "revision_requested" && revision_requests.length === 0) status = "needs_verification";
  if (status === "no_feasible_option" && ranked.some((o) => o.checks.overall !== "fail")) status = "needs_verification";

  return {
    ...output,
    status,
    ranked_options: ranked,
    recommendation,
    revision_requests: status === "revision_requested" ? revision_requests : [],
    blocking_issues: blocking,
  };
}
