import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LogisticsOutput, PlanningOutput, ReviewerOutput, WorkoutOutput } from "@/contracts";
import { createBudget } from "@/server/orchestrator/budget";
import { selectAgents } from "@/server/orchestrator/agents";
import { checkPlan } from "@/server/rules/check-plan";
import { tools } from "@/server/tools";
import { runAndGradeCase } from "./cases/logistics/grade";
import { logisticsEvalCases } from "./cases/logistics";
import { planningEvalCases } from "./cases/planning";
import { runAndGrade, type CaseResult } from "./cases/planning/rubric";
import { reviewerEvalCases } from "./cases/reviewer";
import { workoutEvalCases } from "./cases/workout";
import { summarize, toMarkdown } from "./compare";
import { ALL_CASES, runEvals, type Architecture } from "./runner";

/** Each agent alone on its own eval cases (YT-13, JT-18), with a fresh budget per case. */
async function agentCases(mode: "stub" | "real"): Promise<Record<string, Array<CaseResult & { agent_error: string | null }>>> {
  const agents = selectAgents(mode);
  const deps = () => ({ tools, budget: createBudget() });
  const results: Record<string, Array<CaseResult & { agent_error: string | null }>> = { planning: [], workout: [], logistics: [], reviewer: [] };
  for (const c of planningEvalCases) {
    const { snapshot, brief } = c.build(1);
    results.planning.push(
      await runAndGrade(c, agents.planning, deps(), { schema: PlanningOutput, checkPlan: (plan) => checkPlan({ plan, brief, snapshot, event_version: 1 }) }),
    );
  }
  for (const c of workoutEvalCases) {
    const { snapshot, brief } = c.build(1);
    results.workout.push(
      await runAndGrade(c, agents.workout, deps(), { schema: WorkoutOutput, checkPlan: (plan) => checkPlan({ plan, brief, snapshot, event_version: 1 }) }),
    );
  }
  for (const c of logisticsEvalCases) results.logistics.push(await runAndGradeCase(c, agents.logistics, deps(), LogisticsOutput));
  for (const c of reviewerEvalCases) results.reviewer.push(await runAndGradeCase(c, agents.reviewer, deps(), ReviewerOutput));
  return results;
}

function agentCasesMarkdown(results: Awaited<ReturnType<typeof agentCases>>): string {
  const lines = ["", "## Each agent on its own eval cases", "", "| Agent | Passed | Failures |", "|---|---|---|"];
  for (const [agent, rs] of Object.entries(results)) {
    const fails = rs
      .filter((r) => !r.passed)
      .map((r) => `${r.case_id}: ${r.agent_error ?? r.results.filter((x) => !x.passed && x.critical).map((x) => `${x.id} (${x.detail})`).join(", ")}`);
    lines.push(`| ${agent} | ${rs.filter((r) => r.passed).length}/${rs.length} | ${fails.join("; ").replace(/\|/g, "/") || "none"} |`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Runs the eval set and writes a report to evals/results/ (owner: JT, task JT-17).
 * Skipped unless RUN_EVALS=1, so `npm test` never runs it and never calls the Anthropic API.
 *
 *   RUN_EVALS=1 FIELDDAY_AGENTS=real npx vitest run evals/run-evals.test.ts
 *
 * Optional: EVAL_ARCH=rules,single,multi · EVAL_CASES=1,2,4 · EVAL_AGENT_CASES=0 (skip each agent's own
 * eval cases) · EVAL_PRICE_IN / EVAL_PRICE_OUT
 * (US dollars per million tokens, for the cost line). Keys come from .env.local.
 */

const LIVE = process.env.RUN_EVALS === "1";

describe.skipIf(!LIVE)("eval run", () => {
  it(
    "runs every case through every architecture and writes the report",
    async () => {
      try {
        process.loadEnvFile(".env.local");
      } catch {
        // No .env.local: stub mode still works.
      }
      const mode = process.env.FIELDDAY_AGENTS === "real" ? "real" : "stub";
      if (mode === "real") expect(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY is not set").toBeTruthy();

      const architectures = (process.env.EVAL_ARCH?.split(",") as Architecture[] | undefined) ?? ["rules", "single", "multi"];
      const only = process.env.EVAL_CASES?.split(",").map(Number);
      const cases = only ? ALL_CASES.filter((c) => only.includes(c.expected.case_number)) : ALL_CASES;
      const prices =
        process.env.EVAL_PRICE_IN && process.env.EVAL_PRICE_OUT
          ? { input_per_mtok: Number(process.env.EVAL_PRICE_IN), output_per_mtok: Number(process.env.EVAL_PRICE_OUT) }
          : null;

      const run = await runEvals({
        mode,
        architectures,
        cases,
        onOutcome: (o, g) =>
          console.log(`case ${o.case_number} ${o.architecture}: ${g.correct ? "correct" : g.failures.join("; ")} (${(o.latency_ms / 1000).toFixed(1)} s)`),
      });
      const summaries = summarize(run, prices);
      const model = mode === "real" ? (process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5") : null;
      const perAgent = process.env.EVAL_AGENT_CASES === "0" ? null : await agentCases(mode);
      const markdown = toMarkdown(run, summaries, model) + (perAgent ? agentCasesMarkdown(perAgent) : "");

      const dir = path.join(process.cwd(), "evals", "results");
      mkdirSync(dir, { recursive: true });
      const stamp = run.started_at.replace(/[:.]/g, "-");
      writeFileSync(path.join(dir, `${stamp}-${mode}.json`), JSON.stringify({ ...run, summaries, model, agent_cases: perAgent }, null, 2));
      writeFileSync(path.join(dir, `${stamp}-${mode}.md`), markdown);
      console.log(markdown);
    },
    60 * 60 * 1000,
  );
});
