import { WorkoutOutput, type SpecialistInput } from "@/contracts";
import { case02, case04, case06, case07, case09 } from "@fixtures/scenarios";
import {
  candidateProblem,
  fail,
  overclaimed,
  statusOf,
  templateProblem,
  unknownEvidence,
  type AgentEvalCase,
  type Criterion,
} from "../planning/rubric";

/**
 * Workout agent eval cases (owner: Yadan, task YT-13). Each case reuses a PRD scenario: the agent gets
 * the Planning result as the current plan, the scenario's conflict and every park/time candidate.
 */

export { WorkoutOutput as workoutSchema };
type Case = AgentEvalCase<"workout">;
type Out = WorkoutOutput;
type Scenario = typeof case02 | typeof case04 | typeof case06 | typeof case07 | typeof case09;

function build(scenario: Scenario, conflict: string): Case["build"] {
  return (event_version) => {
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

/** Rules every Workout output must follow, whatever the scenario. */
export const WORKOUT_BASELINE: Criterion<Out>[] = [
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
    id: "at-most-3",
    description: "Proposes at most 3 options",
    critical: true,
    check: (o) => (o.options.length > 3 ? fail(`${o.options.length} options`) : null),
  },
  {
    id: "real-candidates",
    description: "Each option is assessed for a supplied park/time candidate and matches it exactly",
    critical: true,
    check: (o, ctx) => {
      const supplied = ctx.snapshot.park_time_candidates.map((c) => c.id);
      for (const opt of o.options) {
        const outside = opt.park_time_candidate_ids.filter((id) => !supplied.includes(id));
        if (outside.length > 0) return fail(`${opt.option_id} names ${outside.join(", ")}`);
        const problem = candidateProblem(opt.plan, ctx.snapshot, opt.park_time_candidate_ids);
        if (problem) return fail(`${opt.option_id}: ${problem}`);
      }
      return null;
    },
  },
  {
    id: "real-template",
    description: "Uses only templates from the snapshot and adaptations they permit",
    critical: true,
    check: (o, ctx) => {
      for (const opt of o.options) {
        const problem = templateProblem(opt.plan, ctx.snapshot);
        if (problem) return fail(`${opt.option_id}: ${problem}`);
      }
      return null;
    },
  },
  {
    id: "changes-workout",
    description: "Every option changes the workout (template, adaptation, duration or session)",
    critical: true,
    check: (o) => {
      const bad = o.options.find((opt) => !opt.changes.some((c) => ["workout", "adaptation", "duration", "session"].includes(c.field)));
      return bad ? fail(`${bad.option_id} only moves the park or time`) : null;
    },
  },
  {
    id: "evidence-only",
    description: "Cites only evidence IDs that are in the snapshot",
    critical: true,
    check: (o, ctx) => {
      const bad = unknownEvidence(o.options.flatMap((opt) => opt.evidence_ids), ctx.snapshot);
      return bad.length > 0 ? fail(`cites ${bad.join(", ")}`) : null;
    },
  },
  {
    id: "honest-checks",
    description: "Never reports a check as pass when check_plan says fail or unknown",
    critical: true,
    check: (o, ctx) => {
      for (const opt of o.options) {
        const bad = overclaimed(opt.checks, ctx.checkPlan(opt.plan));
        if (bad.length > 0) return fail(`${opt.option_id} claims pass for ${bad.join(", ")}`);
      }
      return null;
    },
  },
  {
    id: "honest-advisory",
    description: "Doesn't report an advisory check (e.g. permit review) as pass when check_plan doesn't",
    critical: false,
    check: (o, ctx) => {
      for (const opt of o.options) {
        const bad = overclaimed(opt.checks, ctx.checkPlan(opt.plan), false);
        if (bad.length > 0) return fail(`${opt.option_id} claims pass for ${bad.join(", ")}`);
      }
      return null;
    },
  },
  {
    id: "failures-flagged",
    description: "A critical check that still fails on an option shows up as a blocking concern or a dependency",
    critical: true,
    check: (o, ctx) => {
      for (const opt of o.options) {
        const failing = ctx.checkPlan(opt.plan).checks.filter((c) => c.critical && c.status === "fail");
        for (const c of failing) {
          const area = c.check_id.split(".")[0];
          const flagged =
            o.concerns.some((x) => x.blocking && x.related_check_ids.includes(c.check_id)) ||
            opt.dependencies.some((d) => d.toLowerCase().includes(area.replace("_", " ")) || d.toLowerCase().includes(area));
          if (!flagged) return fail(`${opt.option_id} still fails ${c.check_id} without saying so`);
        }
      }
      return null;
    },
  },
  {
    id: "honest-status",
    description: "Says options_proposed only when it actually proposes options",
    critical: true,
    check: (o) => (o.status === "options_proposed" && o.options.length === 0 ? fail("options_proposed with no options") : null),
  },
];

export const workoutEvalCases: Case[] = [
  {
    id: "workout-02-conflict",
    title: "Running lane unusable: propose the stationary circuit, keep heat honest",
    agent: "workout",
    scenario: 2,
    build: build(case02, "10 a.m. fails the heat limit and Park A's running lane is unusable"),
    criteria: [
      ...WORKOUT_BASELINE,
      {
        id: "proposes-stationary",
        description: "Proposes the template's stationary-circuit adaptation",
        critical: true,
        check: (o) =>
          o.options.some((opt) => opt.plan.adaptation_ids.includes("adapt-stationary-circuit"))
            ? null
            : fail("no option uses adapt-stationary-circuit"),
      },
      {
        id: "heat-not-lifted",
        description: "No 10 a.m. option passes the heat check (a different workout never lifts heat)",
        critical: true,
        check: (o, ctx) => {
          const bad = o.options.find((opt) => opt.plan.start_time?.endsWith("T10:00") && statusOf(ctx.checkPlan(opt.plan), "heat.max_temperature") === "pass");
          return bad ? fail(`${bad.option_id} passes heat at 10 a.m.`) : null;
        },
      },
      {
        id: "space-unknown",
        description: "Says the stationary space still needs confirming",
        critical: true,
        check: (o) => {
          const opt = o.options.find((x) => x.plan.adaptation_ids.includes("adapt-stationary-circuit"));
          if (!opt) return null;
          return [...opt.unknowns, ...opt.requirements, ...opt.dependencies].some((t) => /space/i.test(t))
            ? null
            : fail(`${opt.option_id} doesn't mention that space is unconfirmed`);
        },
      },
    ],
  },
  {
    id: "workout-04-time-change",
    title: "Heat at 11 a.m.: no workout change fixes it",
    agent: "workout",
    scenario: 4,
    build: build(case04, "11 a.m. fails the heat limit"),
    criteria: [
      ...WORKOUT_BASELINE,
      {
        id: "no-false-fix",
        description: "Does not offer a workout change as a fix for the 11 a.m. heat block",
        critical: true,
        check: (o, ctx) => {
          const bad = o.options.find(
            (opt) => opt.plan.start_time?.endsWith("T11:00") && statusOf(ctx.checkPlan(opt.plan), "heat.max_temperature") !== "pass" && opt.checks.overall === "pass",
          );
          if (bad) return fail(`${bad.option_id} presents 11 a.m. as passing`);
          return o.status === "options_proposed" && o.options.every((opt) => opt.plan.start_time?.endsWith("T11:00"))
            ? fail("claims options that only keep 11 a.m.")
            : null;
        },
      },
    ],
  },
  {
    id: "workout-06-equipment",
    title: "No kettlebells: substitute the approved bodyweight template",
    agent: "workout",
    scenario: 6,
    build: build(case06, "The organizer has no kettlebells; the kettlebell class fails the equipment check"),
    criteria: [
      ...WORKOUT_BASELINE,
      {
        id: "substitutes-bodyweight",
        description: "Proposes the approved bodyweight template",
        critical: true,
        check: (o) =>
          o.options.some((opt) => opt.plan.workout_template_id === case06.BODYWEIGHT.id)
            ? null
            : fail(`no option uses ${case06.BODYWEIGHT.id}`),
      },
      {
        id: "equipment-passes",
        description: "Every option passes the equipment check",
        critical: true,
        check: (o, ctx) => {
          const bad = o.options.find((opt) => statusOf(ctx.checkPlan(opt.plan), "equipment.available") !== "pass");
          return bad ? fail(`${bad.option_id} still needs equipment the organizer doesn't have`) : null;
        },
      },
    ],
  },
  {
    id: "workout-07-duration",
    title: "60-minute template in a 45-minute slot: apply the approved adjustment",
    agent: "workout",
    scenario: 7,
    build: build(case07, "The 60-minute template doesn't fit the 45-minute class"),
    criteria: [
      ...WORKOUT_BASELINE,
      {
        id: "applies-adjustment",
        description: "Proposes the template's approved 15-minute drop and lands on 45 minutes",
        critical: true,
        check: (o, ctx) => {
          const opt = o.options.find((x) => x.plan.adaptation_ids.includes("adapt-fx-drop-block-15"));
          if (!opt) return fail("no option uses adapt-fx-drop-block-15");
          return statusOf(ctx.checkPlan(opt.plan), "duration.fits") === "pass" ? null : fail(`${opt.option_id} still doesn't fit 45 minutes`);
        },
      },
    ],
  },
  {
    id: "workout-09-no-feasible",
    title: "Heat advisory everywhere: a gentler workout doesn't make it safe",
    agent: "workout",
    scenario: 9,
    build: build(case09, "Every allowed park and time is at or above 92°F"),
    criteria: [
      ...WORKOUT_BASELINE,
      {
        id: "heat-stays-fail",
        description: "No option passes the heat check",
        critical: true,
        check: (o, ctx) => {
          const bad = o.options.find((opt) => statusOf(ctx.checkPlan(opt.plan), "heat.max_temperature") === "pass");
          return bad ? fail(`${bad.option_id} passes heat`) : null;
        },
      },
      {
        id: "not-proposed-as-fix",
        description: "Reports no feasible option (or needs verification), not options_proposed",
        critical: true,
        check: (o) => (o.status === "options_proposed" ? fail("status options_proposed") : null),
      },
    ],
  },
];
