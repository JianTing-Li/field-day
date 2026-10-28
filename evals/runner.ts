import {
  ZERO_USAGE,
  type AgentErrorKind,
  type CandidatePlan,
  type CheckPlanResult,
  type EvidenceSnapshot,
  type Usage,
} from "@/contracts";
import { case03, evalCases, type ExpectedOutcome } from "@fixtures/scenarios";
import { agentKinds, selectAgents, type AgentMode } from "@/server/orchestrator/agents";
import { runPlanning, runWorkflow } from "@/server/orchestrator";
import { deriveStatus } from "@/server/lifecycle/transitions";
import { tools } from "@/server/tools";

/**
 * Eval runner (owner: JT, task JT-17). Runs the 12 PRD eval cases through each architecture and
 * grades every result against the case's `expected` outcome, written before any run (PRD §3d).
 *
 * - rules: no agents. Every park/time candidate x template x permitted adaptation goes through
 *   check_plan; the best combination wins. The PRD's deterministic baseline.
 * - single: the Planning agent alone; its plan is the result.
 * - multi: the full workflow (Planning, conflict check, Logistics + Workout Adaptation, Reviewer).
 *
 * All three see the same brief, snapshot and check_plan. check_plan's own result for the final plan
 * is what gets graded, never an agent's claim about it.
 */

export type Architecture = "rules" | "single" | "multi";
export type EvalCase = (typeof evalCases)[number];
export type FinalStatus = ExpectedOutcome["final_status"];

/** What one architecture produced for one case. */
export interface Outcome {
  architecture: Architecture;
  case_number: number;
  final_status: FinalStatus;
  /** The plan the result recommends, or the top-ranked one; null when nothing was accepted. */
  plan: CandidatePlan | null;
  /** check_plan's result for that plan (the harness's truth, not the agent's claim). */
  checks: CheckPlanResult | null;
  /** Whether Logistics, Workout Adaptation and the Reviewer ran. Null where the architecture has none. */
  specialists_run: boolean | null;
  revision_rounds: number;
  agent_error: AgentErrorKind | null;
  /** Every evidence ID the result cites, to count references to evidence that doesn't exist. */
  cited_evidence_ids: string[];
  usage: Usage;
  latency_ms: number;
  /** Which agents were stubs, so a stub run is never reported as a real one. */
  agents: Record<string, "stub" | "real"> | null;
  note: string | null;
}

export interface Grade {
  case_number: number;
  architecture: Architecture;
  /** True when every graded field matches the expected outcome. */
  correct: boolean;
  failures: string[];
}

/**
 * Case 3 is a final-validation case (PRD §3d): the organizer approves a plan built on snapshot A,
 * and the evidence refreshes to snapshot B while saving. Every architecture plans on snapshot A;
 * `finalValidation` then rechecks the result on snapshot B. No agent runs during final validation.
 */
const FINAL_VALIDATION_CASES = new Map([[3, { draft: case03.snapshot, refreshed: case03.refreshedSnapshot }]]);

/** The snapshot an architecture plans on. */
export function snapshotFor(c: EvalCase, event_version = 1): EvidenceSnapshot {
  const id = `evt-eval-${c.expected.case_number}`;
  const fv = FINAL_VALIDATION_CASES.get(c.expected.case_number);
  return fv ? fv.draft(id, event_version) : c.snapshot(id, event_version);
}

/**
 * For a final-validation case: the planned result is rechecked on the refreshed snapshot, as the
 * save gate does. A draft whose recheck doesn't pass goes back to needs_verification; nothing else
 * changes. Other cases are returned unchanged.
 */
export async function finalValidation(c: EvalCase, o: Outcome): Promise<Outcome> {
  const fv = FINAL_VALIDATION_CASES.get(c.expected.case_number);
  if (!fv || o.plan === null) return o;
  const refreshed = fv.refreshed(`evt-eval-${c.expected.case_number}`, 1);
  const checks = await harnessChecks(c, refreshed, o.plan);
  const final_status: FinalStatus = o.final_status === "draft" && checks.overall !== "pass" ? "needs_verification" : o.final_status;
  return { ...o, checks, final_status, note: [o.note, `Rechecked on refreshed snapshot ${refreshed.id}`].filter(Boolean).join("; ") };
}

export async function harnessChecks(c: EvalCase, snapshot: EvidenceSnapshot, plan: CandidatePlan): Promise<CheckPlanResult> {
  return tools.check_plan({ plan }, { snapshot, brief: c.brief, event_version: 1 });
}

// ---- Rules-only baseline ------------------------------------------------------------------------

const RANK = { pass: 0, unknown: 1, fail: 2 } as const;

/** Every complete combination the snapshot allows, from the brief's own choices outward. */
export function allPlans(c: EvalCase, snapshot: EvidenceSnapshot): CandidatePlan[] {
  const plans: CandidatePlan[] = [];
  for (const slot of snapshot.park_time_candidates) {
    for (const t of snapshot.workout_templates) {
      const variants = [[], ...t.permitted_adaptations.map((a) => [a.id])];
      for (const adaptation_ids of variants) {
        const delta = t.permitted_adaptations.find((a) => a.id === adaptation_ids[0])?.duration_delta_minutes ?? 0;
        plans.push({
          park_time_candidate_id: slot.id,
          park_id: slot.park_id,
          start_time: slot.start_time,
          time_zone: "America/New_York",
          duration_minutes: t.duration_minutes + delta,
          workout_template_id: t.id,
          adaptation_ids,
          session_outline: [],
        });
      }
    }
  }
  return plans;
}

/**
 * Picks the best combination: passing over unknown over failing, then the organizer's preferred
 * park and template, then no adaptation, then the earliest start. No priorities are invented.
 */
export async function runRules(c: EvalCase): Promise<Outcome> {
  const started = Date.now();
  const snapshot = snapshotFor(c);
  const scored = await Promise.all(
    allPlans(c, snapshot).map(async (plan) => ({ plan, checks: await harnessChecks(c, snapshot, plan) })),
  );
  const pref = (p: CandidatePlan) => [
    RANK[scored.find((s) => s.plan === p)!.checks.overall],
    p.park_id === (c.brief.preferred_park_id ?? p.park_id) ? 0 : 1,
    p.workout_template_id === (c.brief.workout_template_id ?? p.workout_template_id) ? 0 : 1,
    p.adaptation_ids.length,
    p.start_time ?? "",
  ];
  scored.sort((a, b) => {
    const x = pref(a.plan);
    const y = pref(b.plan);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });
  const best = scored[0];
  const final_status: FinalStatus = !best
    ? "needs_verification"
    : best.checks.overall === "pass"
      ? "draft"
      : best.checks.overall === "unknown"
        ? "needs_verification"
        : "no_feasible_option";
  return {
    architecture: "rules",
    case_number: c.expected.case_number,
    final_status,
    plan: best?.plan ?? null,
    checks: best?.checks ?? null,
    specialists_run: null,
    revision_rounds: 0,
    agent_error: null,
    cited_evidence_ids: best ? best.checks.checks.flatMap((x) => x.evidence_ids) : [],
    usage: ZERO_USAGE,
    latency_ms: Date.now() - started,
    agents: null,
    note: `${scored.length} combinations checked`,
  };
}

// ---- Agent architectures -----------------------------------------------------------------------

/**
 * The status the app would give this result: the lifecycle's own `deriveStatus`, so passing checks
 * win over the agent's status (D-JT23-1). Ready for approval is graded as "draft".
 */
export function harnessStatus(plan: CandidatePlan | null, checks: CheckPlanResult | null, agentStatus: string): FinalStatus {
  const s = deriveStatus(plan, checks, agentStatus);
  return s === "ready_for_approval" ? "draft" : s === "no_feasible_option" ? "no_feasible_option" : "needs_verification";
}

function runArgs(c: EvalCase) {
  const snapshot = snapshotFor(c);
  return { event_id: `evt-eval-${c.expected.case_number}`, event_version: 1, brief: c.brief, snapshot };
}

/** The Planning agent alone. Its plan is the result; check_plan grades it. */
export async function runSingle(c: EvalCase, mode: AgentMode): Promise<Outcome> {
  const started = Date.now();
  const agents = selectAgents(mode);
  const args = runArgs(c);
  const r = await runPlanning(args, { agents });
  const base = {
    architecture: "single" as const,
    case_number: c.expected.case_number,
    specialists_run: null,
    revision_rounds: 0,
    usage: r.usage,
    latency_ms: Date.now() - started,
    agents: { planning: agents.planning.kind },
  };
  if (!r.ok) {
    return { ...base, final_status: null, plan: null, checks: null, agent_error: r.error.kind, cited_evidence_ids: [], note: r.error.message };
  }
  const checks = await harnessChecks(c, args.snapshot, r.output.plan);
  return {
    ...base,
    final_status: harnessStatus(r.output.plan, checks, r.output.status),
    plan: r.output.plan,
    checks,
    agent_error: null,
    cited_evidence_ids: r.output.facts.flatMap((f) => f.evidence_ids),
    note: null,
  };
}

/** The full workflow: Planning, the conflict check, then specialists and the Reviewer on a conflict. */
export async function runMulti(c: EvalCase, mode: AgentMode): Promise<Outcome> {
  const started = Date.now();
  const agents = selectAgents(mode);
  const args = runArgs(c);
  const r = await runWorkflow(args, { agents });
  const base = {
    architecture: "multi" as const,
    case_number: c.expected.case_number,
    usage: r.usage,
    latency_ms: Date.now() - started,
    agents: agentKinds(agents),
  };
  if (!r.ok) {
    return { ...base, final_status: null, plan: null, checks: null, specialists_run: false, revision_rounds: 0, agent_error: r.kind, cited_evidence_ids: [], note: r.message };
  }
  const planningIds = r.planning.facts.flatMap((f) => f.evidence_ids);
  if (!r.review) {
    return {
      ...base,
      final_status: harnessStatus(r.planning.plan, r.checks, r.planning.status),
      plan: r.planning.plan,
      checks: r.checks,
      specialists_run: false,
      revision_rounds: 0,
      agent_error: null,
      cited_evidence_ids: planningIds,
      note: null,
    };
  }
  if (!r.review.ok) {
    return { ...base, final_status: null, plan: null, checks: null, specialists_run: true, revision_rounds: 0, agent_error: r.review.kind, cited_evidence_ids: planningIds, note: r.review.message };
  }
  const review = r.review.review;
  const chosen = review.recommendation
    ? review.ranked_options.find((o) => o.combined_option_id === review.recommendation!.combined_option_id)
    : review.ranked_options[0];
  const checks = chosen ? await harnessChecks(c, args.snapshot, chosen.plan) : null;
  return {
    ...base,
    final_status: harnessStatus(chosen?.plan ?? null, checks, review.status),
    plan: chosen?.plan ?? null,
    checks,
    specialists_run: true,
    revision_rounds: r.review.revision_rounds,
    agent_error: null,
    cited_evidence_ids: [...planningIds, ...review.ranked_options.flatMap((o) => o.evidence_ids)],
    note: chosen ? null : "The Reviewer ranked no combination",
  };
}

// ---- Grading ------------------------------------------------------------------------------------

/**
 * Grades one outcome against the case's expected outcome. Fields an architecture can't produce
 * (specialists for rules or single) are not graded for it. "finalize" is derived from the result
 * the organizer would approve: allowed only for a draft whose checks all pass.
 */
export function gradeOutcome(c: EvalCase, o: Outcome): Grade {
  const e = c.expected;
  const failures: string[] = [];
  const expectRejected = e.final_status === null;

  if (expectRejected) {
    if (o.agent_error !== e.agent_error) failures.push(`expected the harness to reject the output (${e.agent_error}), got ${o.agent_error ?? `status ${o.final_status}`}`);
  } else {
    if (o.agent_error !== null) failures.push(`agent error: ${o.agent_error}`);
    if (o.final_status !== e.final_status) failures.push(`status ${o.final_status}, expected ${e.final_status}`);
    const overall = o.checks?.overall ?? null;
    if (overall !== e.overall) failures.push(`check_plan overall ${overall}, expected ${e.overall}`);
    for (const [id, status] of Object.entries(e.checks)) {
      const got = o.checks?.checks.find((x) => x.check_id === id)?.status ?? null;
      if (got !== status) failures.push(`${id} ${got}, expected ${status}`);
    }
    const finalize = o.final_status === "draft" && overall === "pass" ? "allowed" : "blocked";
    if (finalize !== e.finalize) failures.push(`finalize ${finalize}, expected ${e.finalize}`);
  }

  if (o.architecture === "multi" && o.specialists_run !== null && o.specialists_run !== e.specialists_run) {
    failures.push(`specialists ${o.specialists_run ? "ran" : "did not run"}, expected ${e.specialists_run ? "to run" : "not to run"}`);
  }
  if (o.revision_rounds > e.max_revision_rounds) failures.push(`${o.revision_rounds} revision rounds, at most ${e.max_revision_rounds} expected`);

  return { case_number: e.case_number, architecture: o.architecture, correct: failures.length === 0, failures };
}

export const ALL_CASES: readonly EvalCase[] = evalCases;

/** Cases an architecture cannot be graded on. Rules-only has no agent output for Case 11 to reject. */
export function applicable(arch: Architecture, c: EvalCase): boolean {
  return !(arch === "rules" && c.expected.agent_error !== null);
}

export interface EvalRun {
  started_at: string;
  agent_mode: AgentMode;
  architectures: Architecture[];
  outcomes: Outcome[];
  grades: Grade[];
}

/** Runs every case through every requested architecture, one case at a time. */
export async function runEvals(opts: {
  mode: AgentMode;
  architectures?: Architecture[];
  cases?: readonly EvalCase[];
  onOutcome?: (o: Outcome, g: Grade) => void;
}): Promise<EvalRun> {
  const architectures = opts.architectures ?? ["rules", "single", "multi"];
  const cases = opts.cases ?? ALL_CASES;
  const started_at = new Date().toISOString();
  const outcomes: Outcome[] = [];
  const grades: Grade[] = [];
  for (const c of cases) {
    for (const arch of architectures) {
      if (!applicable(arch, c)) continue;
      const planned = arch === "rules" ? await runRules(c) : arch === "single" ? await runSingle(c, opts.mode) : await runMulti(c, opts.mode);
      const o = await finalValidation(c, planned);
      const g = gradeOutcome(c, o);
      outcomes.push(o);
      grades.push(g);
      opts.onOutcome?.(o, g);
    }
  }
  return { started_at, agent_mode: opts.mode, architectures, outcomes, grades };
}
