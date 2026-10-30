import type {
  AgentDeps,
  CandidatePlan,
  CheckId,
  CheckPlanResult,
  Concern,
  Fact,
  OrganizerTask,
  PlanningInput,
  PlanningOutput,
  WorkoutTemplate,
} from "@/contracts";

/**
 * Rules-only Planning (owner: Yadan). No AI: every allowed park/time candidate x workout template
 * (x one permitted adaptation) goes through check_plan, and the best combination wins, the same
 * order as the eval runner's rules baseline (passing over unknown over failing, then the
 * organizer's favorite park and workout, then no adaptation, then the earliest start).
 *
 * The practice (stub) planner uses this for events that have no fixture, so a new event can always
 * be planned in demo mode. Nothing is invented: facts, concerns and tasks all come from check_plan.
 */

const RANK = { pass: 0, unknown: 1, fail: 2 } as const;

/** What an organizer can confirm in person, phrased as a to-do. */
const CONFIRMABLE: CheckId[] = ["space_surface.space", "space_surface.surface"];

export async function rulesPlan(input: PlanningInput, deps: AgentDeps): Promise<PlanningOutput> {
  const { brief } = input;
  const { snapshot } = deps.tool_context;
  const echo = { event_version: input.context.event_version, evidence_snapshot_id: input.context.evidence_snapshot_id };

  const slots = snapshot.park_time_candidates.filter((c) => brief.allowed_park_ids.includes(c.park_id));
  const templates = snapshot.workout_templates.filter(
    (t) => brief.workout_template_id === null || t.id === brief.workout_template_id,
  );

  const plans: CandidatePlan[] = [];
  for (const slot of slots) {
    for (const t of templates) {
      for (const adaptation_ids of [[], ...t.permitted_adaptations.map((a) => [a.id])]) {
        const delta = t.permitted_adaptations.find((a) => a.id === adaptation_ids[0])?.duration_delta_minutes ?? 0;
        plans.push({
          park_time_candidate_id: slot.id,
          park_id: slot.park_id,
          start_time: slot.start_time,
          time_zone: "America/New_York",
          duration_minutes: t.duration_minutes + delta,
          workout_template_id: t.id,
          adaptation_ids,
          session_outline: outline(t, adaptation_ids),
        });
      }
    }
  }

  if (plans.length === 0) {
    return {
      ...echo,
      status: "needs_verification",
      plan: {
        park_time_candidate_id: null,
        park_id: null,
        start_time: null,
        time_zone: "America/New_York",
        duration_minutes: brief.duration_minutes,
        workout_template_id: brief.workout_template_id,
        adaptation_ids: [],
        session_outline: [],
      },
      facts: [],
      rule_checks: null,
      concerns: [
        {
          id: "concern-no-candidates",
          description:
            "There's no park and start time to check yet for these parks and this time window. Try more parks or a wider window.",
          blocking: true,
          related_check_ids: [],
        },
      ],
      organizer_tasks: [],
    };
  }

  const scored: { plan: CandidatePlan; checks: CheckPlanResult }[] = [];
  for (const plan of plans) scored.push({ plan, checks: await deps.tools.check_plan({ plan }, deps.tool_context) });
  const key = (s: (typeof scored)[number]) => [
    RANK[s.checks.overall],
    s.plan.park_id === (brief.preferred_park_id ?? s.plan.park_id) ? 0 : 1,
    s.plan.adaptation_ids.length,
    s.checks.blockers.length,
    s.plan.start_time ?? "",
  ];
  scored.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });
  const best = scored[0];
  const parkName = snapshot.park_candidates.find((p) => p.id === best.plan.park_id)?.name ?? best.plan.park_id!;
  const template = templates.find((t) => t.id === best.plan.workout_template_id)!;

  return {
    ...echo,
    status: best.checks.overall === "pass" ? "draft" : best.checks.overall === "fail" ? "no_feasible_option" : "needs_verification",
    plan: best.plan,
    facts: facts(best.checks),
    rule_checks: best.checks,
    concerns: concerns(best.checks),
    organizer_tasks: tasks(best.checks, best.plan, parkName, template, brief.group_size),
  };
}

function outline(t: WorkoutTemplate, adaptation_ids: string[]): string[] {
  const steps = t.exercises.map((e) => (e.minutes ? `${e.name} (${e.minutes} min)` : e.name));
  const a = t.permitted_adaptations.find((x) => x.id === adaptation_ids[0]);
  return a ? [...steps, `Adjusted: ${a.description}`] : steps;
}

/** Weather and air-quality results the plan rests on, each tied to its evidence. */
function facts(checks: CheckPlanResult): Fact[] {
  return checks.checks
    .filter((c) => (c.check_id === "heat.max_temperature" || c.check_id === "air_quality.max_aqi") && c.evidence_ids.length > 0)
    .map((c) => ({
      claim: c.reason,
      status: c.status === "pass" ? "verified" : "unverified",
      evidence_ids: c.evidence_ids,
      missing_reason: c.status === "pass" ? null : "Not confirmed by current evidence",
    }));
}

/** Plain words for a check nobody can confirm yet (no forecast data for that day). */
const NOT_YET: Partial<Record<CheckId, string>> = {
  "heat.max_temperature": "There's no temperature forecast for this time yet.",
  "air_quality.max_aqi": "There's no air-quality forecast for this time yet.",
  "freshness.conditions": "The weather data doesn't cover this date yet. Check again closer to the day.",
};

/** One blocking concern per critical check that fails or isn't confirmed (check_plan's words unless plainer ones exist). */
function concerns(checks: CheckPlanResult): Concern[] {
  return checks.checks
    .filter((c) => c.critical && c.status !== "pass")
    .map((c) => ({
      id: `concern-${c.check_id.replace(/\./g, "-")}`,
      description: (c.status === "unknown" && NOT_YET[c.check_id]) || c.reason,
      blocking: true,
      related_check_ids: [c.check_id],
    }));
}

/** Short to-dos only the organizer can do: confirm the space and ground at this park and time. */
function tasks(
  checks: CheckPlanResult,
  plan: CandidatePlan,
  parkName: string,
  template: WorkoutTemplate,
  groupSize: number,
): OrganizerTask[] {
  const open = new Set(checks.checks.filter((c) => c.status === "unknown").map((c) => c.check_id));
  const when = plan.start_time ? ` at ${clock(plan.start_time)}` : "";
  const out: OrganizerTask[] = [];
  for (const id of CONFIRMABLE) {
    if (!open.has(id)) continue;
    out.push({
      id: `task-${id.replace(/\./g, "-")}`,
      description:
        id === "space_surface.space"
          ? `Confirm there's open space for ${groupSize} people at ${parkName}${when}`
          : `Confirm the ground at ${parkName} is ${template.surfaces.join(" or ")}`,
      resolves_check_id: id,
      park_id: plan.park_id,
      start_time: plan.start_time,
    });
  }
  return out;
}

/** "2026-10-31T08:30" -> "8:30 AM". */
function clock(dt: string): string {
  const [h, m] = dt.slice(11, 16).split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
