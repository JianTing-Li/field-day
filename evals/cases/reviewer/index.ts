import { ReviewerOutput, type CandidatePlan, type ReviewerInput } from "@/contracts";
import { case02, case04, case05, case06, case08, case09 } from "@fixtures/scenarios";
import { combinationChecks } from "@/server/orchestrator";
import { tools } from "@/server/tools";
import { createBudget } from "@/server/orchestrator/budget";
import { candidateProblem, fail, overclaimed, unknownEvidence, type Criterion, type EvalContext } from "../planning/rubric";
import type { SpecialistEvalCase } from "../logistics";

/**
 * Independent Reviewer eval cases (owner: JT, task JT-18). Each case gives the Reviewer the
 * scenario's Planning result, both specialists' fixture proposals and the harness's combination
 * checks, as the orchestrator does. Criteria judge the output against the harness's own check_plan.
 * Written before the cases' first live run (PRD §3d).
 */

export { ReviewerOutput as reviewerSchema };
type Out = ReviewerOutput;
type Scenario = typeof case02 | typeof case04 | typeof case05 | typeof case06 | typeof case08 | typeof case09;
type Case = SpecialistEvalCase<ReviewerInput, Out>;

function build(scenario: Scenario, conflict: string): Case["build"] {
  return async (event_version) => {
    const snapshot = scenario.snapshot(`evt-eval-${scenario.SNAPSHOT_ID}`, event_version);
    const planning = scenario.planningOutput(event_version);
    const logistics = scenario.logisticsOutput(event_version);
    const workout = scenario.workoutOutput(event_version);
    const deps = { tools, tool_context: { snapshot, brief: scenario.brief, event_version }, budget: createBudget() };
    const input: ReviewerInput = {
      context: {
        event_id: `evt-eval-${scenario.SNAPSHOT_ID}`,
        event_version,
        evidence_snapshot_id: snapshot.id,
        revision_round: 0,
        revision_available: true,
      },
      brief: scenario.brief,
      original_plan: planning.plan,
      conflict: { source: "harness", description: conflict, check_ids: planning.rule_checks?.blockers ?? [] },
      logistics,
      workout,
      combination_checks: await combinationChecks(planning.plan, logistics, workout, deps),
    };
    return { input, snapshot, brief: scenario.brief };
  };
}

const placeTime = (p: CandidatePlan) => `${p.park_id}|${p.start_time}`;
const workoutOf = (p: CandidatePlan) => `${p.workout_template_id}|${[...p.adaptation_ids].sort().join(",")}|${p.duration_minutes}`;

/** Rules every Reviewer output must follow. `input` is what the Reviewer was given. */
export function reviewerBaseline(input: (ctx: EvalContext) => ReviewerInput): Criterion<Out>[] {
  return [
    {
      id: "echo",
      description: "Echoes the event version and evidence snapshot it was given",
      critical: true,
      check: (o, ctx) =>
        o.event_version !== ctx.event_version || o.evidence_snapshot_id !== ctx.snapshot.id
          ? fail(`answered for v${o.event_version} / ${o.evidence_snapshot_id}`)
          : null,
    },
    {
      id: "evidence-only",
      description: "Cites only evidence IDs that are in the snapshot",
      critical: true,
      check: (o, ctx) => {
        const bad = unknownEvidence(o.ranked_options.flatMap((x) => x.evidence_ids), ctx.snapshot);
        return bad.length > 0 ? fail(`cites ${bad.join(", ")}`) : null;
      },
    },
    {
      id: "no-invented-combination",
      description: "Every combination's park/time and workout come from a cited specialist option or the original plan",
      critical: true,
      check: (o, ctx) => {
        const i = input(ctx);
        for (const x of o.ranked_options) {
          const problem = candidateProblem(x.plan, ctx.snapshot);
          if (problem) return fail(`${x.combined_option_id}: ${problem}`);
          const lo = i.logistics.options.find((y) => y.option_id === x.logistics_option_id);
          const wo = i.workout.options.find((y) => y.option_id === x.workout_option_id);
          if ((x.logistics_option_id && !lo) || (x.workout_option_id && !wo)) return fail(`${x.combined_option_id} cites an option nobody proposed`);
          const places = lo ? [lo.plan] : [i.original_plan, ...(wo ? [wo.plan] : [])];
          const workouts = wo ? [wo.plan] : [i.original_plan];
          if (!places.some((p) => placeTime(p) === placeTime(x.plan))) return fail(`${x.combined_option_id} invents a park or time`);
          if (!workouts.some((p) => workoutOf(p) === workoutOf(x.plan))) return fail(`${x.combined_option_id} invents a workout`);
        }
        return null;
      },
    },
    {
      id: "honest-checks",
      description: "No combination calls a critical check pass that check_plan says is fail or unknown",
      critical: true,
      check: (o, ctx) => {
        for (const x of o.ranked_options) {
          const lies = overclaimed(x.checks, ctx.checkPlan(x.plan));
          if (lies.length > 0) return fail(`${x.combined_option_id} claims ${lies.join(", ")} pass`);
        }
        return null;
      },
    },
    {
      id: "recommends-only-passing",
      description: "Recommends only a combination whose every critical check passes in check_plan",
      critical: true,
      check: (o, ctx) => {
        if (!o.recommendation) return null;
        const x = o.ranked_options.find((y) => y.combined_option_id === o.recommendation!.combined_option_id);
        if (!x) return fail(`recommends ${o.recommendation.combined_option_id}, which isn't ranked`);
        const t = ctx.checkPlan(x.plan);
        return t.overall === "pass" ? null : fail(`recommended ${x.combined_option_id} is ${t.overall}: ${t.blockers.join(", ")}`);
      },
    },
    {
      id: "draft-needs-recommendation",
      description: "Returns draft only with a recommendation",
      critical: true,
      check: (o) => (o.status === "draft" && !o.recommendation ? fail("draft without a recommendation") : null),
    },
    {
      id: "revision-only-when-available",
      description: "Asks for a revision only while the round is available, and only for options that were proposed",
      critical: true,
      check: (o, ctx) => {
        const i = input(ctx);
        if (o.revision_requests.length > 0 && !i.context.revision_available) return fail("asks for a revision after the round was used");
        for (const r of o.revision_requests) {
          const pool = (r.specialist === "logistics" ? i.logistics : i.workout).options.map((y) => y.option_id);
          const bad = r.option_ids.filter((id) => !pool.includes(id));
          if (bad.length > 0) return fail(`revision request names ${bad.join(", ")}, which ${r.specialist} didn't propose`);
        }
        return null;
      },
    },
    {
      id: "blockers-visible",
      description: "An unresolved result says what blocks it (blocking issues or organizer tasks)",
      critical: true,
      check: (o) =>
        (o.status === "needs_verification" || o.status === "no_feasible_option") && o.blocking_issues.length === 0 && o.organizer_tasks.length === 0
          ? fail(`${o.status} with no blocking issues or tasks`)
          : null,
    },
    {
      id: "infeasible-only-when-shown",
      description: "no_feasible_option only when every ranked combination fails check_plan (missing evidence is not infeasibility)",
      critical: true,
      check: (o, ctx) => {
        if (o.status !== "no_feasible_option") return null;
        const notFail = o.ranked_options.filter((x) => ctx.checkPlan(x.plan).overall !== "fail");
        return notFail.length > 0 ? fail(`${notFail[0].combined_option_id} is not a demonstrated fail`) : null;
      },
    },
  ];
}

const recommends: Criterion<Out> = {
  id: "recommends",
  description: "Recommends a combination (a passing one exists)",
  critical: true,
  check: (o) => (o.recommendation ? null : fail(`no recommendation (status ${o.status})`)),
};

function makeCase(s: Scenario, id: string, title: string, conflict: string, extra: Criterion<Out>[]): Case {
  const b = build(s, conflict);
  let cached: ReviewerInput | null = null;
  const builder: Case["build"] = async (v) => {
    const r = await b(v);
    cached = r.input;
    return r;
  };
  const input = () => {
    if (!cached) throw new Error(`${id}: build() must run before grading`);
    return cached;
  };
  return { id, title, scenario: s.expected.case_number, build: builder, criteria: [...reviewerBaseline(input), ...extra] };
}

export const reviewerEvalCases: Case[] = [
  makeCase(case02, "reviewer-02-conflict", "Space unverified at both parks", "10 a.m. fails the heat policy; Park A's running lane is unusable", [
    {
      id: "no-recommendation-while-unverified",
      description: "Makes no recommendation while every combination has unverified space, and asks the organizer to confirm it",
      critical: true,
      check: (o) => {
        if (o.recommendation) return fail(`recommends ${o.recommendation.combined_option_id}`);
        return o.organizer_tasks.some((t) => t.resolves_check_id?.startsWith("space_surface")) ? null : fail("no space task for the organizer");
      },
    },
  ]),
  makeCase(case04, "reviewer-04-time-change", "Moving to 8 a.m. resolves the heat block", "11 a.m. fails the heat policy", [recommends]),
  makeCase(case05, "reviewer-05-venue-change", "Moving to Park B resolves the lane problem", "Park A's running lane is unusable", [recommends]),
  makeCase(case06, "reviewer-06-equipment", "An approved bodyweight template replaces kettlebells", "The organizer no longer has kettlebells", [recommends]),
  makeCase(case08, "reviewer-08-combined", "Only the time change plus the stationary adaptation works", "10 a.m. fails the heat policy; Park A's running lane is unusable", [
    recommends,
    {
      id: "combines-both",
      description: "The recommendation combines the Logistics time change with the Workout adaptation",
      critical: true,
      check: (o) => {
        const x = o.ranked_options.find((y) => y.combined_option_id === o.recommendation?.combined_option_id);
        return x && x.logistics_option_id && x.workout_option_id ? null : fail("recommendation doesn't combine both specialists' options");
      },
    },
  ]),
  makeCase(case09, "reviewer-09-no-feasible", "Every combination fails heat", "Every start time fails the heat policy", [
    {
      id: "no-feasible",
      description: "Returns no_feasible_option with no recommendation and no revision request",
      critical: true,
      check: (o) => {
        if (o.recommendation) return fail(`recommends ${o.recommendation.combined_option_id}`);
        if (o.revision_requests.length > 0) return fail("asks for a revision that can't fix heat");
        return o.status === "no_feasible_option" ? null : fail(`status ${o.status}`);
      },
    },
  ]),
];
