import { LogisticsOutput, type CandidatePlan, type CheckPlanResult, type EventBrief, type EvidenceSnapshot, type SpecialistInput } from "@/contracts";
import { case02, case04, case05, case06, case08, case09 } from "@fixtures/scenarios";
import { candidateProblem, covered, fail, overclaimed, statusOf, unknownEvidence, type Criterion, type EvalContext } from "../planning/rubric";

/**
 * Event Logistics eval cases (owner: JT, task JT-18). Each case reuses a PRD scenario: the agent gets
 * the Planning result as the current plan, the scenario's conflict and every park/time candidate.
 * Criteria judge the output against the harness's own check_plan (EvalContext.checkPlan), never
 * against hard-coded rule results. Written before the cases' first live run (PRD §3d).
 * Uses the Planning/Workout rubric helpers (YT-13); the case type is local because that rubric's
 * `AgentEvalCase` covers only Planning and Workout.
 */

export { LogisticsOutput as logisticsSchema };
type Out = LogisticsOutput;
type Scenario = typeof case02 | typeof case04 | typeof case05 | typeof case06 | typeof case08 | typeof case09;

export interface SpecialistEvalCase<I, O> {
  id: string;
  title: string;
  /** PRD eval case number the scenario comes from (fixtures/scenarios). */
  scenario: number;
  build: (event_version: number) => Promise<{ input: I; snapshot: EvidenceSnapshot; brief: EventBrief }>;
  criteria: Criterion<O>[];
}
type Case = SpecialistEvalCase<SpecialistInput, Out>;

function build(scenario: Scenario, conflict: string): Case["build"] {
  return async (event_version) => {
    const snapshot = scenario.snapshot(`evt-eval-${scenario.SNAPSHOT_ID}`, event_version);
    const planning = scenario.planningOutput(event_version);
    const input: SpecialistInput = {
      context: {
        event_id: `evt-eval-${scenario.SNAPSHOT_ID}`,
        event_version,
        evidence_snapshot_id: snapshot.id,
        revision_round: 0,
        revision_available: true,
      },
      brief: scenario.brief,
      current_plan: planning.plan,
      conflict: { source: "harness", description: conflict, check_ids: planning.rule_checks?.blockers ?? [] },
      park_time_candidate_ids: snapshot.park_time_candidates.map((c) => c.id),
      revision_requests: [],
    };
    return { input, snapshot, brief: scenario.brief };
  };
}

const sameWorkout = (a: CandidatePlan, b: CandidatePlan) =>
  a.workout_template_id === b.workout_template_id &&
  [...a.adaptation_ids].sort().join() === [...b.adaptation_ids].sort().join() &&
  a.duration_minutes === b.duration_minutes;

/** check_plan's result for every option, keyed by option ID. */
const truths = (o: Out, ctx: EvalContext): Map<string, CheckPlanResult> =>
  new Map(o.options.map((x) => [x.option_id, ctx.checkPlan(x.plan)]));

/** Rules every Logistics output must follow, whatever the scenario. `current` is the plan it was given. */
export function logisticsBaseline(current: (ctx: EvalContext) => CandidatePlan): Criterion<Out>[] {
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
        const bad = unknownEvidence(o.options.flatMap((x) => x.evidence_ids), ctx.snapshot);
        return bad.length > 0 ? fail(`cites ${bad.join(", ")}`) : null;
      },
    },
    {
      id: "own-park-confirmations",
      description: "Never uses an organizer confirmation from one park as evidence for another",
      critical: true,
      check: (o, ctx) => {
        for (const x of o.options) {
          for (const id of x.evidence_ids) {
            const e = ctx.snapshot.items.find((i) => i.id === id);
            if (e?.evidence_type === "organizer_confirmation" && e.applies_to.park_id !== x.plan.park_id) {
              return fail(`${x.option_id} at ${x.plan.park_id} cites ${id} from ${e.applies_to.park_id}`);
            }
          }
        }
        return null;
      },
    },
    {
      id: "real-candidate",
      description: "Every option is one of the supplied park/time candidates, in an allowed park",
      critical: true,
      check: (o, ctx) => {
        const supplied = ctx.snapshot.park_time_candidates.map((c) => c.id);
        for (const x of o.options) {
          const problem = candidateProblem(x.plan, ctx.snapshot, supplied);
          if (problem) return fail(`${x.option_id}: ${problem}`);
          if (x.plan.park_id && !ctx.brief.allowed_park_ids.includes(x.plan.park_id)) {
            return fail(`${x.option_id} uses ${x.plan.park_id}, which the organizer didn't allow`);
          }
        }
        return null;
      },
    },
    {
      id: "keeps-workout",
      description: "Keeps the current workout (template, adaptations, length): workout changes are Workout Adaptation's job",
      critical: true,
      check: (o, ctx) => {
        const bad = o.options.filter((x) => !sameWorkout(x.plan, current(ctx)));
        return bad.length > 0 ? fail(`${bad.map((x) => x.option_id).join(", ")} change the workout`) : null;
      },
    },
    {
      id: "moves-place-or-time",
      description: "Every option changes the park or the start time",
      critical: true,
      check: (o, ctx) => {
        const cur = current(ctx);
        const bad = o.options.filter((x) => x.plan.park_id === cur.park_id && x.plan.start_time === cur.start_time);
        return bad.length > 0 ? fail(`${bad.map((x) => x.option_id).join(", ")} keep the current park and time`) : null;
      },
    },
    {
      id: "honest-checks",
      description: "No option calls a critical check pass that check_plan says is fail or unknown",
      critical: true,
      check: (o, ctx) => {
        const t = truths(o, ctx);
        for (const x of o.options) {
          const lies = overclaimed(x.checks, t.get(x.option_id)!);
          if (lies.length > 0) return fail(`${x.option_id} claims ${lies.join(", ")} pass`);
        }
        return null;
      },
    },
    {
      id: "unknowns-visible",
      description: "Every option with an unknown critical check says what is unknown",
      critical: true,
      check: (o, ctx) => {
        const t = truths(o, ctx);
        for (const x of o.options) {
          const unknown = t.get(x.option_id)!.checks.filter((c) => c.critical && c.status === "unknown");
          // Any concern (blocking or not) or task in the same area counts: the organizer sees it.
          const asBlocking = o.concerns.map((k) => ({ ...k, blocking: true }));
          const silent = unknown.filter((c) => x.unknowns.length === 0 && !covered(c.check_id, asBlocking, o.organizer_tasks));
          if (silent.length > 0) return fail(`${x.option_id} doesn't mention ${silent.map((c) => c.check_id).join(", ")}`);
        }
        return null;
      },
    },
    {
      id: "honest-status",
      description: "options_proposed only with options; no_feasible_option only when no option passes",
      critical: true,
      check: (o, ctx) => {
        if (o.status === "options_proposed" && o.options.length === 0) return fail("options_proposed with no options");
        if (o.status === "no_feasible_option") {
          const t = truths(o, ctx);
          const passing = o.options.filter((x) => t.get(x.option_id)!.overall === "pass");
          if (passing.length > 0) return fail(`no_feasible_option, but ${passing[0].option_id} passes`);
        }
        return null;
      },
    },
  ];
}

const plannedPlan = (s: Scenario) => () => s.planningOutput(1).plan;
const anyOption = (o: Out, ctx: EvalContext, test: (x: Out["options"][number], t: CheckPlanResult) => boolean) =>
  o.options.some((x) => test(x, ctx.checkPlan(x.plan)));

function makeCase(s: Scenario, id: string, title: string, conflict: string, extra: Criterion<Out>[]): Case {
  return { id, title, scenario: s.expected.case_number, build: build(s, conflict), criteria: [...logisticsBaseline(plannedPlan(s)), ...extra] };
}

export const logisticsEvalCases: Case[] = [
  makeCase(case02, "logistics-02-conflict", "Heat at 10 a.m. and an unusable running lane at Park A", "10 a.m. fails the heat policy; Park A's running lane is unusable", [
    {
      id: "cooler-time",
      description: "Proposes a start time that clears the heat check",
      critical: true,
      check: (o, ctx) => (anyOption(o, ctx, (_x, t) => statusOf(t, "heat.max_temperature") === "pass") ? null : fail("no option clears heat")),
    },
    {
      id: "no-borrowed-space",
      description: "Doesn't treat Park B's space as verified because Park A's was assessed",
      critical: true,
      check: (o) => {
        const b = o.options.filter((x) => x.plan.park_id === "park-b");
        const claims = b.filter((x) => statusOf(x.checks, "space_surface.space") === "pass");
        return claims.length > 0 ? fail(`${claims[0].option_id} claims Park B space passes`) : null;
      },
    },
  ]),
  makeCase(case04, "logistics-04-time-change", "11 a.m. too hot; an earlier time at the same park works", "11 a.m. fails the heat policy", [
    {
      id: "finds-passing-time",
      description: "Proposes a time whose complete plan passes every critical check",
      critical: true,
      check: (o, ctx) => (anyOption(o, ctx, (_x, t) => t.overall === "pass") ? null : fail("no option passes")),
    },
  ]),
  makeCase(case05, "logistics-05-venue-change", "Park A's lane is unusable; Park B has a confirmed lane", "Park A's running lane is unusable", [
    {
      id: "finds-passing-park",
      description: "Proposes another allowed park whose complete plan passes every critical check",
      critical: true,
      check: (o, ctx) => {
        const cur = case05.planningOutput(1).plan;
        return anyOption(o, ctx, (x, t) => x.plan.park_id !== cur.park_id && t.overall === "pass") ? null : fail("no passing option at another park");
      },
    },
  ]),
  makeCase(case06, "logistics-06-equipment", "Kettlebells unavailable: not a place/time problem", "The organizer no longer has kettlebells", [
    {
      id: "no-invented-fix",
      description: "Doesn't present a place/time change as fixing an equipment conflict",
      critical: true,
      check: (o) => {
        const claims = o.options.filter((x) => x.checks.overall === "pass");
        return claims.length > 0 ? fail(`${claims[0].option_id} claims to pass`) : null;
      },
    },
  ]),
  makeCase(case08, "logistics-08-combined", "Heat at 10 a.m. plus an unusable lane: needs a time change and a workout change", "10 a.m. fails the heat policy; Park A's running lane is unusable", [
    {
      id: "cooler-time",
      description: "Proposes a start time that clears the heat check",
      critical: true,
      check: (o, ctx) => (anyOption(o, ctx, (_x, t) => statusOf(t, "heat.max_temperature") === "pass") ? null : fail("no option clears heat")),
    },
    {
      id: "names-workout-dependency",
      description: "Says the time change still depends on a workout change (the lane is unusable)",
      critical: false,
      check: (o) =>
        o.options.some((x) => x.dependencies.length > 0) || o.concerns.length > 0 ? null : fail("no dependency or concern mentioned"),
    },
  ]),
  makeCase(case09, "logistics-09-no-feasible", "Every allowed park and time is too hot", "Every start time fails the heat policy", [
    {
      id: "no-false-fix",
      description: "Doesn't return a passing option or options_proposed when every place and time fails heat",
      critical: true,
      check: (o, ctx) => {
        if (anyOption(o, ctx, (_x, t) => t.overall === "pass")) return fail("an option passes check_plan");
        return o.status === "options_proposed" ? fail("status options_proposed") : null;
      },
    },
  ]),
];
