import type { Usage } from "@/contracts";
import { ALL_CASES, snapshotFor, type Architecture, type EvalRun, type Outcome } from "./runner";

/**
 * Comparison (owner: JT, task JT-17): turns an eval run into the PRD §2c metrics for each
 * architecture, and a Markdown report. Targets are the PRD's proposed acceptance targets.
 */

export interface Prices {
  /** US dollars per million input / output tokens for the model the run used. */
  input_per_mtok: number;
  output_per_mtok: number;
}

export interface ArchitectureSummary {
  architecture: Architecture;
  /** Cases matching the expected outcome, and how many were graded (rules skips Case 11). */
  correct: number;
  graded: number;
  /** Known-feasible conflicts (cases 4–8) that ended in a draft whose checks all pass. */
  resolved: number;
  resolved_cases: number[];
  /** Results the organizer could approve (draft) while check_plan has a failed critical check. */
  hard_rule_violations: number;
  /** Evidence IDs cited that are not in the case's snapshot. */
  invented_evidence: number;
  /** Cases with required gaps that still came back as a passing draft (gaps hidden). */
  hidden_gaps: number;
  usage: Usage;
  latency_ms: number;
  cost_usd: number | null;
  stub_agents: string[];
}

const KNOWN_FEASIBLE = new Set(ALL_CASES.filter((c) => c.expected.known_feasible).map((c) => c.expected.case_number));
const caseFor = (n: number) => ALL_CASES.find((c) => c.expected.case_number === n)!;

function sumUsage(outcomes: Outcome[]): Usage {
  const total: Usage = { agent_executions: 0, model_requests: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0, elapsed_ms: 0 };
  for (const o of outcomes) for (const k of Object.keys(total) as (keyof Usage)[]) total[k] += o.usage[k];
  return total;
}

const resolvedCase = (o: Outcome) => o.final_status === "draft" && o.checks?.overall === "pass";

export function summarize(run: EvalRun, prices: Prices | null = null): ArchitectureSummary[] {
  return run.architectures.map((architecture) => {
    const outcomes = run.outcomes.filter((o) => o.architecture === architecture);
    const grades = run.grades.filter((g) => g.architecture === architecture);
    const resolved_cases = outcomes.filter((o) => KNOWN_FEASIBLE.has(o.case_number) && resolvedCase(o)).map((o) => o.case_number);
    const usage = sumUsage(outcomes);
    const invented = outcomes.reduce((n, o) => {
      // The snapshot the architecture planned on, plus the case's own (refreshed) snapshot for Case 3.
      const c = caseFor(o.case_number);
      const known = new Set([...snapshotFor(c).items, ...c.snapshot("x", 1).items].map((i) => i.id));
      return n + o.cited_evidence_ids.filter((id) => !known.has(id)).length;
    }, 0);
    const stubs = new Set<string>();
    for (const o of outcomes) for (const [name, kind] of Object.entries(o.agents ?? {})) if (kind === "stub") stubs.add(name);
    return {
      architecture,
      correct: grades.filter((g) => g.correct).length,
      graded: grades.length,
      resolved: resolved_cases.length,
      resolved_cases,
      hard_rule_violations: outcomes.filter((o) => o.final_status === "draft" && o.checks?.checks.some((c) => c.critical && c.status === "fail")).length,
      invented_evidence: invented,
      hidden_gaps: outcomes.filter((o) => caseFor(o.case_number).expected.required_gaps.length > 0 && resolvedCase(o)).length,
      usage,
      latency_ms: outcomes.reduce((n, o) => n + o.latency_ms, 0),
      cost_usd: prices ? (usage.input_tokens * prices.input_per_mtok + usage.output_tokens * prices.output_per_mtok) / 1_000_000 : null,
      stub_agents: [...stubs].sort(),
    };
  });
}

export interface MultiAgentValue {
  /** Known-feasible conflicts the 4-agent workflow resolved that the single agent did not. */
  additional_resolved: number;
  latency_ratio: number | null;
  /** PRD: at least 2 additional cases and at most 2x latency; otherwise reconsider extra agents. */
  meets_target: boolean;
}

export function multiAgentValue(summaries: ArchitectureSummary[]): MultiAgentValue | null {
  const single = summaries.find((s) => s.architecture === "single");
  const multi = summaries.find((s) => s.architecture === "multi");
  if (!single || !multi) return null;
  const additional_resolved = multi.resolved_cases.filter((n) => !single.resolved_cases.includes(n)).length;
  const latency_ratio = single.latency_ms > 0 ? multi.latency_ms / single.latency_ms : null;
  return { additional_resolved, latency_ratio, meets_target: additional_resolved >= 2 && latency_ratio !== null && latency_ratio <= 2 };
}

const yes = (ok: boolean) => (ok ? "met" : "**not met**");

export function toMarkdown(run: EvalRun, summaries: ArchitectureSummary[], model: string | null): string {
  const value = multiAgentValue(summaries);
  const lines: string[] = [
    `# FieldDay eval results`,
    "",
    `Run ${run.started_at} · agents: ${run.agent_mode}${model ? ` · model: ${model}` : ""}. Fixture inputs, not live data or real-world results.`,
    "",
    "| Metric (PRD §2c) | Target | " + summaries.map((s) => s.architecture).join(" | ") + " |",
    "|---|---|" + summaries.map(() => "---|").join(""),
    `| Correct outcomes | ≥ 11 of 12 | ` + summaries.map((s) => `${s.correct}/${s.graded} (${yes(s.correct >= 11)})`).join(" | ") + " |",
    `| Conflicts resolved (cases 4–8) | ≥ 4 of 5 | ` + summaries.map((s) => `${s.resolved}/5 (${yes(s.resolved >= 4)})`).join(" | ") + " |",
    `| Approvable plans breaking a hard rule | 0 | ` + summaries.map((s) => `${s.hard_rule_violations} (${yes(s.hard_rule_violations === 0)})`).join(" | ") + " |",
    `| Cited evidence not in the snapshot | 0 | ` + summaries.map((s) => `${s.invented_evidence} (${yes(s.invented_evidence === 0)})`).join(" | ") + " |",
    `| Missing-data cases shown as passing | 0 | ` + summaries.map((s) => `${s.hidden_gaps} (${yes(s.hidden_gaps === 0)})`).join(" | ") + " |",
    `| Model requests / tool calls | — | ` + summaries.map((s) => `${s.usage.model_requests} / ${s.usage.tool_calls}`).join(" | ") + " |",
    `| Tokens in / out | — | ` + summaries.map((s) => `${s.usage.input_tokens} / ${s.usage.output_tokens}`).join(" | ") + " |",
    `| Total latency | — | ` + summaries.map((s) => `${(s.latency_ms / 1000).toFixed(1)} s`).join(" | ") + " |",
    `| Cost | — | ` + summaries.map((s) => (s.cost_usd === null ? "not computed" : `$${s.cost_usd.toFixed(2)}`)).join(" | ") + " |",
    "",
  ];
  if (value) {
    lines.push(
      `**Multi-agent value:** the 4-agent workflow resolved ${value.additional_resolved} more known-feasible conflict(s) than Planning alone, ` +
        (value.latency_ratio === null ? "with no latency to compare. " : `at ${value.latency_ratio.toFixed(1)}× the latency. `) +
        `Target (≥ 2 more, ≤ 2× latency): ${yes(value.meets_target)}.`,
      "",
    );
  }
  const stubbed = summaries.filter((s) => s.stub_agents.length > 0);
  if (stubbed.length > 0) {
    lines.push(`**Stub agents in this run:** ${stubbed.map((s) => `${s.architecture}: ${s.stub_agents.join(", ")}`).join("; ")}. Stub results are fixture outputs, not agent performance.`, "");
  }
  lines.push("## Per case", "", "| Case | " + summaries.map((s) => s.architecture).join(" | ") + " |", "|---|" + summaries.map(() => "---|").join(""));
  for (const c of ALL_CASES) {
    const n = c.expected.case_number;
    const cells = summaries.map((s) => {
      const g = run.grades.find((x) => x.case_number === n && x.architecture === s.architecture);
      if (!g) return "n/a";
      return g.correct ? "✓" : `✗ ${g.failures.join("; ").replace(/\|/g, "/")}`;
    });
    lines.push(`| ${n}. ${c.expected.title} | ${cells.join(" | ")} |`);
  }
  lines.push(
    "",
    "Notes: \"Cited evidence not in the snapshot\" counts evidence IDs, which approximates invented claims; it does not read claim text. " +
      "Rules-only is not graded on Case 11 (there is no agent output to reject). Case 3 is planned on snapshot A and rechecked on the refreshed snapshot B, as at final validation.",
  );
  return lines.join("\n") + "\n";
}
