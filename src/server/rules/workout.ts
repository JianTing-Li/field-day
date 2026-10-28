import type { CheckId, CheckResult, CheckStatus, EvidenceItem, PolicyArea, RuleFn, RuleInput, WorkoutTemplate } from "@/contracts";

/**
 * Workout rules (owner: Yadan, task YT-04): equipment, duration, space/surface needs
 * of the chosen template and adaptations. Unconfirmed space or surface is unknown.
 * Heat and air quality are never read here (they are environment rules), so changing
 * the workout can never make a blocked condition pass.
 */

const POLICY_VERSION = "workout-rules-v1";

type Layout = WorkoutTemplate["space"]["layout"];
type Adaptation = WorkoutTemplate["permitted_adaptations"][number];

export const workoutRules: RuleFn = (input) => {
  const make = checkMaker(input);
  const all = (reason: string) => [
    make("equipment.available", "equipment", "unknown", reason),
    make("duration.fits", "duration", "unknown", reason),
    make("space_surface.space", "space_surface", "unknown", reason),
    make("space_surface.surface", "space_surface", "unknown", reason),
  ];

  const { plan, snapshot } = input;
  if (!plan.workout_template_id) return all("No workout template chosen yet");
  const template = snapshot.workout_templates.find((t) => t.id === plan.workout_template_id);
  if (!template) return all(`Workout template ${plan.workout_template_id} is not in the evidence snapshot`);

  const adaptations: Adaptation[] = [];
  for (const id of plan.adaptation_ids) {
    const a = template.permitted_adaptations.find((p) => p.id === id);
    if (!a) return all(`Adaptation ${id} is not permitted for ${template.name}`);
    adaptations.push(a);
  }

  // Reference record for the template, when the snapshot has one.
  const templateEvidence = snapshot.items.some((i) => i.id === template.evidence_id) ? [template.evidence_id] : [];
  return [
    equipmentCheck(input, template, templateEvidence, make),
    durationCheck(input, template, adaptations, templateEvidence, make),
    spaceCheck(input, template, adaptations, make),
    surfaceCheck(input, template, make),
  ];
};

type Make = ReturnType<typeof checkMaker>;

function checkMaker(input: RuleInput) {
  return (
    check_id: CheckId,
    area: PolicyArea,
    status: CheckStatus,
    reason: string,
    evidence_ids: string[] = [],
  ): CheckResult => ({
    check_id,
    area,
    status,
    critical: true,
    reason,
    evidence_ids,
    policy_version: POLICY_VERSION,
    assessed: {
      park_id: input.plan.park_id,
      start_time: input.plan.start_time,
      workout_template_id: input.plan.workout_template_id,
    },
  });
}

/** Template equipment must all be on the organizer's list. Adaptations add no equipment. */
function equipmentCheck(input: RuleInput, t: WorkoutTemplate, evidence: string[], make: Make): CheckResult {
  if (t.equipment.length === 0) return make("equipment.available", "equipment", "pass", "No equipment required", evidence);
  const have = new Set(input.brief.equipment_available.map(norm));
  const missing = t.equipment.filter((e) => !have.has(norm(e)));
  if (missing.length > 0) {
    return make("equipment.available", "equipment", "fail", `Missing equipment: ${missing.join(", ")}`, evidence);
  }
  return make("equipment.available", "equipment", "pass", `All equipment available: ${t.equipment.join(", ")}`, evidence);
}

/** Template length plus adaptation changes must equal the event length (and the plan's own length, if given). */
function durationCheck(
  input: RuleInput,
  t: WorkoutTemplate,
  adaptations: Adaptation[],
  evidence: string[],
  make: Make,
): CheckResult {
  const total = t.duration_minutes + adaptations.reduce((sum, a) => sum + a.duration_delta_minutes, 0);
  const wanted = input.brief.duration_minutes;
  const planned = input.plan.duration_minutes;
  if (total !== wanted) {
    return make("duration.fits", "duration", "fail", `Workout is ${total} minutes; the event is ${wanted} minutes`, evidence);
  }
  if (planned !== null && planned !== total) {
    return make("duration.fits", "duration", "fail", `Plan says ${planned} minutes but the workout is ${total} minutes`, evidence);
  }
  return make("duration.fits", "duration", "pass", `Workout is ${total} minutes, matching the event`, evidence);
}

/**
 * The layout the session needs (the last adaptation that changes it, else the template's) must be
 * confirmed by the organizer for this park and time. A confirmation names its layout in `category`;
 * one with no category confirms the template's own layout (see decision D-016).
 */
function spaceCheck(input: RuleInput, t: WorkoutTemplate, adaptations: Adaptation[], make: Make): CheckResult {
  const layout = adaptations.reduce<Layout>((l, a) => a.resulting_layout ?? l, t.space.layout);
  const label = layout.replace(/_/g, " ");
  const park = input.plan.park_id;
  if (!park) return make("space_surface.space", "space_surface", "unknown", `No park chosen, so ${label} space is not confirmed`);

  const found = confirmations(input, "space_surface.space").filter((c) => (c.category ?? t.space.layout) === layout);
  const no = found.filter((c) => c.value === false);
  if (no.length > 0) {
    return make("space_surface.space", "space_surface", "fail", `Organizer reported no usable ${label} space at ${park}`, ids(no));
  }
  const yes = found.filter((c) => c.value === true);
  if (yes.length > 0) {
    return make("space_surface.space", "space_surface", "pass", `Organizer confirmed ${label} space at ${park}`, ids(yes));
  }
  return make("space_surface.space", "space_surface", "unknown", `${cap(label)} space at ${park} is not confirmed`);
}

/**
 * The surface must be confirmed for this park and time: either the surface type (checked against
 * the template's surfaces) or a yes/no that it is suitable.
 */
function surfaceCheck(input: RuleInput, t: WorkoutTemplate, make: Make): CheckResult {
  const park = input.plan.park_id;
  if (!park) return make("space_surface.surface", "space_surface", "unknown", "No park chosen, so the surface is not confirmed");

  const allowed = new Set(t.surfaces.map(norm));
  const suitable = (c: EvidenceItem) => (typeof c.value === "string" ? allowed.has(norm(c.value)) : c.value === true);
  const found = confirmations(input, "space_surface.surface").filter(
    (c) => typeof c.value === "string" || typeof c.value === "boolean",
  );
  const bad = found.filter((c) => !suitable(c));
  if (bad.length > 0) {
    const named = bad.map((c) => c.value).filter((v): v is string => typeof v === "string");
    const reason =
      named.length > 0
        ? `Surface at ${park} (${named.join(", ")}) is not suitable; this workout needs ${t.surfaces.join(" or ")}`
        : `Organizer reported the surface at ${park} is not suitable`;
    return make("space_surface.surface", "space_surface", "fail", reason, ids(bad));
  }
  if (found.length > 0) {
    return make("space_surface.surface", "space_surface", "pass", `Organizer confirmed a suitable surface at ${park}`, ids(found));
  }
  return make("space_surface.surface", "space_surface", "unknown", `Surface at ${park} is not confirmed`);
}

/** Organizer confirmations for one check at the plan's park and, when the confirmation is timed, its start time. */
function confirmations(input: RuleInput, check: CheckId): EvidenceItem[] {
  const { park_id, start_time } = input.plan;
  return input.snapshot.items.filter(
    (i) =>
      i.evidence_type === "organizer_confirmation" &&
      i.confirms_check_id === check &&
      i.applies_to.park_id === park_id &&
      coversStart(i, start_time),
  );
}

/** An untimed confirmation applies at any time; a timed one only if it covers the start time. */
function coversStart(i: EvidenceItem, start: string | null): boolean {
  if (i.valid_from === null && i.valid_to === null) return true;
  if (start === null) return false;
  return (i.valid_from === null || i.valid_from <= start) && (i.valid_to === null || start < i.valid_to);
}

const ids = (items: EvidenceItem[]) => items.map((i) => i.id);
const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
