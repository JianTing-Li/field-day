import {
  EventBrief,
  isConfirmableCheck,
  REPORTABLE_CHECK_IDS,
  ZERO_USAGE,
  type ApiRequest,
  type ApiResponse,
  type CheckPlanResult,
  type EvidenceSnapshot,
  type EventSummary,
  type FieldDayEvent,
  type FinalizedRecord,
  type GateCheck,
  type PlanVersion,
  type ReviewerOutput,
  type RunState,
  type Usage,
} from "@/contracts";
import { runConflictReview, runWorkflow, type RunOptions } from "@/server/orchestrator";
import { STUB_AGENTS } from "@/server/orchestrator/agents";
import { checkPlan } from "@/server/rules/check-plan";
import { POLICY_CONFIG } from "@/server/rules/policy-config";
import { toLocalDateTime } from "@/server/time";
import { getStore, type EventStore } from "@/server/store";
import { applyConfirmations, applyReports, confirmationLayout, confirmationMatches, planLayout } from "./confirmations";
import { ServiceError } from "./errors";
import { refreshedSnapshot, SCENARIO_EVENTS, snapshotFor } from "./snapshots";
import { assertCanStart, deriveStatus, transition } from "./transitions";

/**
 * Lifecycle service (owner: JT, tasks JT-07, JT-09, JT-14). One function per API endpoint.
 *
 * The harness owns all state. Every change to the brief, plan or evidence creates a new plan
 * version (old versions are kept) or clears approval in place; approval is tied to an exact
 * version + snapshot. Requests and agent results that name an outdated version or snapshot
 * are rejected with stale_version. Allowed status changes live in ./transitions.ts.
 *
 * Evidence comes from ./snapshots (scenario fixtures for the seeded demo events, the JT-03 builder
 * otherwise); the store is Neon when DATABASE_URL is set (JT-08); finalize runs the full save gate (JT-09).
 */

const now = () => new Date().toISOString();

/**
 * Upper bounds on what an organizer can send (F-09). The form keeps people well inside them; these
 * stop a script from storing a 200,000-character title or a 999,999-minute event.
 */
export const INPUT_LIMITS = {
  title: 120,
  text: 500,
  list_items: 20,
  list_item: 200,
  duration_minutes: 240,
  group_size: 500,
  /** Parks one event may consider (D-JT24-13): each adds forecasts and candidate plans for the agents. */
  parks_per_event: 5,
} as const;

function tooLong(label: string, value: string | null, max: number = INPUT_LIMITS.text): string[] {
  return value !== null && value.length > max ? [`${label} is longer than ${max} characters`] : [];
}

/**
 * Throws invalid_request when a brief is outside the limits, or in the past or over the park cap
 * when the date or park list is new or changed (so an older event's other fields can still be edited).
 */
function assertBriefInRange(brief: EventBrief, checkDate: boolean, checkParks = checkDate) {
  const L = INPUT_LIMITS;
  const problems = [
    ...tooLong("The name", brief.title, L.title),
    ...(brief.duration_minutes > L.duration_minutes ? [`the length is over ${L.duration_minutes} minutes`] : []),
    ...(brief.group_size > L.group_size ? [`the group is over ${L.group_size} people`] : []),
    ...tooLong("The instructor notes", brief.instructor_limits.notes),
    ...[brief.allowed_park_ids, brief.equipment_available, brief.exercise_exclusions, brief.priorities].flatMap((list) =>
      list.length > L.list_items || list.some((x) => x.length > L.list_item)
        ? [`a list has more than ${L.list_items} items or an item over ${L.list_item} characters`]
        : [],
    ),
  ];
  if (checkParks && brief.allowed_park_ids.length > L.parks_per_event) {
    problems.push(`pick at most ${L.parks_per_event} parks`);
  }
  if (problems.length > 0) {
    throw new ServiceError("invalid_request", `The brief is out of range: ${[...new Set(problems)].join("; ")}`);
  }
  // New York's today, the same calendar the brief's date is in.
  if (checkDate && brief.date < toLocalDateTime(new Date()).slice(0, 10)) {
    throw new ServiceError("invalid_request", "The event date is in the past; pick today or a later date");
  }
}
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function current(event: FieldDayEvent): PlanVersion {
  return event.versions.find((v) => v.version === event.current_version)!;
}

function requireCurrent(event: FieldDayEvent, version: number) {
  if (version !== event.current_version) {
    throw new ServiceError(
      "stale_version",
      `Version ${version} is not the current version (${event.current_version})`,
    );
  }
}

function emptyVersion(
  version: number,
  based_on_version: number | null,
  source: PlanVersion["source"],
): PlanVersion {
  return {
    version,
    based_on_version,
    created_at: now(),
    source,
    status: "draft",
    plan: null,
    evidence_snapshot_id: null,
    checks: null,
    facts: [],
    concerns: [],
    organizer_tasks: [],
    alternatives: null,
  };
}

function newEvent(id: string, brief: EventBrief): FieldDayEvent {
  const t = now();
  return {
    id,
    created_at: t,
    updated_at: t,
    brief,
    versions: [emptyVersion(1, null, "brief")],
    current_version: 1,
    approval: null,
    confirmations: [],
    finalized: null,
    last_run: null,
  };
}

function progress(message: string) {
  return { at: now(), message };
}

function run(status: RunState["status"], steps: string[], usage: Usage = ZERO_USAGE): RunState {
  return { run_id: newId("run"), status, revision_count: 0, usage, progress: steps.map(progress) };
}

/** Clears approval. The approved version goes back to ready_for_approval. */
function clearApproval(event: FieldDayEvent) {
  if (!event.approval) return;
  const approved = event.versions.find((v) => v.version === event.approval!.version);
  if (approved?.status === "approved") transition(approved, "ready_for_approval", "invalidate_approval");
  event.approval = null;
}

/** Adds a new current version. The previous version is frozen from here on. */
function pushVersion(event: FieldDayEvent, v: PlanVersion) {
  clearApproval(event);
  event.last_gate = null;
  event.versions.push(v);
  event.current_version = v.version;
}

/** Rejects an agent result that names a different version or snapshot than the run used. */
function requireMatchingResult(
  what: string,
  out: { event_version: number; evidence_snapshot_id: string },
  version: number,
  snapshotId: string,
) {
  if (out.event_version !== version || out.evidence_snapshot_id !== snapshotId) {
    throw new ServiceError(
      "stale_version",
      `${what} result for version ${out.event_version} / snapshot ${out.evidence_snapshot_id} ` +
        `does not match version ${version} / snapshot ${snapshotId}`,
    );
  }
}

async function load(store: EventStore, id: string): Promise<FieldDayEvent> {
  const event = await store.getEvent(id);
  if (!event) throw new ServiceError("not_found", `Event ${id} not found`);
  return event;
}

/**
 * Saves the event. `base` is the updated_at the request loaded; if the stored event has
 * changed since (another request or a slower agent run), the write is rejected so a stale
 * result never overwrites newer state. Pass null for a new event. The check and the write are
 * one atomic compare-and-swap in the store (JT-08).
 * Every save moves updated_at past `base`, even within the same millisecond, so a change is
 * always detectable.
 */
async function commit(store: EventStore, event: FieldDayEvent, base: string | null): Promise<FieldDayEvent> {
  const t = Date.now();
  event.updated_at = new Date(base === null ? t : Math.max(t, Date.parse(base) + 1)).toISOString();
  if (!(await store.saveEvent(event, base))) {
    throw new ServiceError("stale_version", "The event changed while this request was running; reload and retry");
  }
  return event;
}

/**
 * Runs the whole workflow (D-JT24-4): Planning drafts, the harness checks the draft, and a failed
 * critical check starts the specialists and the Reviewer in the same run, so a conflict arrives
 * with its alternatives. The version's checks always come from the harness, never from an agent.
 */
async function plan(store: EventStore, event: FieldDayEvent, opts: RunOptions = {}): Promise<FieldDayEvent> {
  const base = current(event);
  const next = event.current_version + 1;
  const snapshot = await snapshotFor(event, next);
  await store.saveSnapshot(snapshot);
  const result = await runWorkflow({ event_id: event.id, event_version: next, brief: event.brief, snapshot }, opts);
  if (!result.ok) {
    event.last_run = run(
      result.kind === "budget_exhausted" ? "budget_exhausted" : "failed",
      ["Drafting plan", `Could not draft a plan: ${result.message}`],
      result.usage,
    );
    return event;
  }
  const out = result.planning;
  requireMatchingResult("Planning", out, next, snapshot.id);
  const checks = harnessChecks(event, out.plan, snapshot, next);
  const steps = ["Reading park, weather and air-quality evidence", "Drafted plan"];
  let alternatives: PlanVersion["alternatives"] = null;
  let revisions = 0;
  if (result.review?.ok) {
    requireMatchingResult("Review", result.review.review, next, snapshot.id);
    alternatives = recheckOptions(event, result.review.review, snapshot, next);
    revisions = result.review.revision_rounds;
    steps.push("Found a conflict and compared alternatives");
  } else if (result.review) {
    steps.push(`Found a conflict, but the alternatives could not be compared: ${result.review.message}`);
  }
  pushVersion(event, {
    ...emptyVersion(next, base.version, "planning"),
    status: deriveStatus(out.plan, checks, out.status),
    plan: out.plan,
    evidence_snapshot_id: snapshot.id,
    checks,
    facts: out.facts,
    concerns: out.concerns,
    organizer_tasks: out.organizer_tasks,
    alternatives,
  });
  event.last_run = { ...run("completed", steps, result.usage), revision_count: revisions };
  return event;
}

let seeded: Promise<void> | null = null;

/**
 * Seeds the demo events (Cases 1, 2 and 3) that are missing, once per server process. With Neon
 * they are seeded once and then persist; if two servers seed at once, the second insert is
 * dropped. A failed seed is retried on the next request. Seeding always uses the fixture-backed
 * stub agents, so the demo is the same every time and a page view never spends model credits.
 */
function ensureSeeded(store: EventStore): Promise<void> {
  seeded ??= (async () => {
    for (const [id, scenario] of Object.entries(SCENARIO_EVENTS)) {
      if (await store.getEvent(id)) continue;
      try {
        await commit(store, await plan(store, newEvent(id, scenario.brief), { agents: STUB_AGENTS }), null);
      } catch (e) {
        if (!(e instanceof ServiceError && e.code === "stale_version")) throw e;
      }
    }
  })().catch((e) => {
    seeded = null;
    throw e;
  });
  return seeded;
}

async function withStore() {
  const store = getStore();
  await ensureSeeded(store);
  return store;
}

function summary(e: FieldDayEvent): EventSummary {
  return {
    id: e.id,
    title: e.brief.title,
    date: e.brief.date,
    status: current(e).status,
    current_version: e.current_version,
    finalized_version: e.finalized?.version ?? null,
    updated_at: e.updated_at,
  };
}

// ---- Endpoint implementations ----------------------------------------------

export async function listEvents(): Promise<ApiResponse<"listEvents">> {
  const store = await withStore();
  const events = await store.listEvents();
  return { events: events.map(summary).sort((a, b) => b.updated_at.localeCompare(a.updated_at)) };
}

export async function createEvent(req: ApiRequest<"createEvent">): Promise<ApiResponse<"createEvent">> {
  assertBriefInRange(req.brief, true);
  const store = await withStore();
  return { event: await commit(store, newEvent(newId("evt"), req.brief), null) };
}

export async function getEvent(id: string): Promise<ApiResponse<"getEvent">> {
  const store = await withStore();
  const event = await load(store, id);
  const snapId = current(event).evidence_snapshot_id;
  return { event, snapshot: snapId ? await store.getSnapshot(snapId) : null };
}

/**
 * Whether an edit changes anything the checks or the plan depend on. The name, the instructor's
 * free-text notes and the ranking priorities don't (D-JT24-5); everything else does.
 */
export function isMaterialEdit(before: EventBrief, after: EventBrief): boolean {
  const strip = (b: EventBrief) => ({
    ...b,
    title: "",
    priorities: [],
    instructor_limits: { ...b.instructor_limits, notes: null },
  });
  return JSON.stringify(strip(before)) !== JSON.stringify(strip(after));
}

/**
 * A material brief edit starts a new draft version with no plan and retires confirmations made
 * under the old brief. A non-material edit keeps the plan in the new version.
 */
export async function updateBrief(id: string, req: ApiRequest<"updateBrief">): Promise<ApiResponse<"updateBrief">> {
  const store = await withStore();
  const event = await load(store, id);
  const base = event.updated_at;
  requireCurrent(event, req.based_on_version);
  assertCanStart("update_brief", current(event));
  // Only a changed date must be today or later, so an older event's other fields can still be edited.
  assertBriefInRange(
    req.brief,
    req.brief.date !== event.brief.date,
    JSON.stringify(req.brief.allowed_park_ids) !== JSON.stringify(event.brief.allowed_park_ids),
  );
  const v = current(event);
  const next = event.current_version + 1;
  const material = isMaterialEdit(event.brief, req.brief);
  event.brief = req.brief;
  if (material || !v.plan || !v.evidence_snapshot_id || v.status === "no_feasible_option") {
    event.confirmations = [];
    pushVersion(event, emptyVersion(next, event.current_version, "organizer_edit"));
    return { event: await commit(store, event, base) };
  }
  // Only the name, instructor notes or priorities changed (D-JT24-5): the plan, its checks and the
  // confirmations still hold. It is still a new version, so approval has to be given again.
  const snapshot = await store.getSnapshot(v.evidence_snapshot_id);
  if (!snapshot) throw new ServiceError("internal", "Evidence snapshot missing");
  const checks = harnessChecks(event, v.plan, snapshot, next);
  pushVersion(event, {
    ...v,
    version: next,
    based_on_version: v.version,
    created_at: now(),
    source: "organizer_edit",
    status: deriveStatus(v.plan, checks),
    checks,
    // The review answered for the old version; applying one of its options would be rejected as stale.
    alternatives: null,
  });
  return { event: await commit(store, event, base) };
}

export async function generateDraft(id: string, req: ApiRequest<"generateDraft">): Promise<ApiResponse<"generateDraft">> {
  const store = await withStore();
  const event = await load(store, id);
  const base = event.updated_at;
  requireCurrent(event, req.version);
  assertCanStart("generate", current(event));
  return { event: await commit(store, await plan(store, event), base) };
}

/** check_plan for a plan on a snapshot, with the event's organizer confirmations applied. */
function harnessChecks(event: FieldDayEvent, plan: NonNullable<PlanVersion["plan"]>, snapshot: EvidenceSnapshot, version: number) {
  const layout = planLayout(plan, snapshot.workout_templates);
  const raw = checkPlan({ plan, brief: event.brief, snapshot, event_version: version });
  // Reports first (they fail a check), then confirmations (they only settle what is still unknown).
  const reported = applyReports(raw, event.change_reports ?? [], event.confirmations, layout);
  return applyConfirmations(reported, event.confirmations, layout).checks;
}

/**
 * The review's options, re-checked with what only the harness knows: organizer reports and
 * confirmations (D-JT24-12). The agents' check_plan tool sees the evidence snapshot only, so an
 * option at a time the organizer just reported as rainy would otherwise still look fine. A
 * recommendation that no longer passes is withdrawn.
 */
function recheckOptions(event: FieldDayEvent, review: ReviewerOutput, snapshot: EvidenceSnapshot, version: number): ReviewerOutput {
  const ranked_options = review.ranked_options.map((o) => ({ ...o, checks: harnessChecks(event, o.plan, snapshot, version) }));
  const chosen = ranked_options.find((o) => o.combined_option_id === review.recommendation?.combined_option_id);
  const recommendation = chosen && chosen.checks.overall === "pass" ? review.recommendation : null;
  return { ...review, ranked_options, recommendation };
}

/** One blocking concern per critical check that isn't a pass, so concerns clear when the check passes. */
function concernsFrom(checks: CheckPlanResult): PlanVersion["concerns"] {
  return checks.checks
    .filter((c) => c.critical && c.status !== "pass")
    .map((c) => ({
      id: `concern-${c.check_id.replace(/\./g, "-")}`,
      description: `${c.status === "fail" ? "Failed" : "Not verified"}: ${c.reason}`,
      blocking: true,
      related_check_ids: [c.check_id],
    }));
}

/**
 * Gathers the evidence again for the version `v`'s snapshot was built for. Same ID: unchanged.
 * Returns the refreshed snapshot when it changed, or null when it did not.
 */
async function changedEvidence(store: EventStore, event: FieldDayEvent, v: PlanVersion): Promise<EvidenceSnapshot | null> {
  const old = v.evidence_snapshot_id ? await store.getSnapshot(v.evidence_snapshot_id) : null;
  const fresh = await refreshedSnapshot(event, old?.event_version ?? v.version);
  return fresh.id === v.evidence_snapshot_id ? null : fresh;
}

const evidenceUnchanged = async (store: EventStore, event: FieldDayEvent, v: PlanVersion) =>
  (await changedEvidence(store, event, v)) === null;

/** Adds a version that revalidates `v`'s plan on new evidence. It clears approval. */
function pushRecheckVersion(event: FieldDayEvent, v: PlanVersion, snapshot: EvidenceSnapshot, checks: CheckPlanResult) {
  pushVersion(event, {
    ...emptyVersion(v.version + 1, v.version, "recheck"),
    status: deriveStatus(v.plan, checks),
    plan: v.plan,
    evidence_snapshot_id: snapshot.id,
    checks,
    // Facts and alternatives cite the old snapshot, so they are not carried over.
    concerns: v.concerns,
    organizer_tasks: v.organizer_tasks,
  });
}

/**
 * Refreshes evidence. Unchanged evidence leaves the plan as is. New evidence revalidates the
 * current plan with check_plan as a new version and clears approval.
 */
export async function recheck(id: string, req: ApiRequest<"recheck">): Promise<ApiResponse<"recheck">> {
  const store = await withStore();
  const event = await load(store, id);
  const base = event.updated_at;
  requireCurrent(event, req.version);
  const v = current(event);
  assertCanStart("recheck", v);
  if (!v.plan) throw new ServiceError("invalid_request", "No plan to recheck; generate a draft first");
  const next = v.version + 1;
  if (await evidenceUnchanged(store, event, v)) {
    event.last_run = run("completed", [`Evidence unchanged (snapshot ${v.evidence_snapshot_id}); plan still valid`]);
    return { event: await commit(store, event, base) };
  }
  const snapshot = await refreshedSnapshot(event, next);
  await store.saveSnapshot(snapshot);
  pushRecheckVersion(event, v, snapshot, harnessChecks(event, v.plan, snapshot, next));
  event.last_run = run("completed", [
    "Refreshed park, weather and air-quality evidence",
    `Revalidated the plan against snapshot ${snapshot.id}`,
  ]);
  return { event: await commit(store, event, base) };
}

async function review(
  id: string,
  version: number,
  description: string,
  action: "report_change" | "request_review",
  change?: ApiRequest<"reportChange">["change"],
) {
  const store = await withStore();
  const event = await load(store, id);
  const base = event.updated_at;
  requireCurrent(event, version);
  const v = current(event);
  assertCanStart(action, v);
  if (!v.plan || !v.evidence_snapshot_id) {
    throw new ServiceError("invalid_request", "Generate a draft before requesting review");
  }
  const snapshot = await store.getSnapshot(v.evidence_snapshot_id);
  if (!snapshot) throw new ServiceError("internal", "Evidence snapshot missing");
  let target = v;
  if (action === "report_change" && change) {
    // A report is new information (D-JT24-12): it's kept on the event, the check it names fails at
    // that park and time from now on, and the plan is re-checked as a new version, so a locked-in
    // or approved version is never changed in place.
    const layout = ["space_surface.space", "space_surface.surface"].includes(change.check_id ?? "")
      ? planLayout(v.plan, snapshot.workout_templates)
      : null;
    event.change_reports = [
      ...(event.change_reports ?? []),
      {
        at: now(),
        version: v.version,
        kind: change.kind,
        description: change.description,
        check_id: change.check_id ?? null,
        park_id: change.park_id ?? null,
        start_time: change.start_time ?? null,
        layout,
      },
    ];
    const next = v.version + 1;
    const checks = harnessChecks(event, v.plan, snapshot, next);
    pushVersion(event, {
      ...emptyVersion(next, v.version, "organizer_edit"),
      status: deriveStatus(v.plan, checks),
      plan: v.plan,
      evidence_snapshot_id: v.evidence_snapshot_id,
      checks,
      facts: v.facts,
      concerns: concernsFrom(checks),
      organizer_tasks: v.organizer_tasks,
    });
    target = current(event);
  }
  const plan = target.plan!;
  const result = await runConflictReview({
    event_id: event.id,
    event_version: target.version,
    brief: event.brief,
    snapshot,
    current_plan: plan,
    conflict: { source: "organizer", description, check_ids: target.checks?.blockers ?? [] },
  });
  const steps = ["Checking alternative parks and times", "Checking workout adaptations"];
  if (result.ok) {
    requireMatchingResult("Review", result.review, target.version, v.evidence_snapshot_id);
    target.alternatives = recheckOptions(event, result.review, snapshot, target.version);
    if (result.revision_rounds > 0) steps.push("Specialists revised their options");
    steps.push("Independent review complete");
  } else {
    steps.push(`Review could not complete: ${result.message}`);
  }
  const status = result.ok ? "completed" : result.kind === "budget_exhausted" ? "budget_exhausted" : "failed";
  event.last_run = { ...run(status, steps, result.usage), revision_count: result.ok ? result.revision_rounds : 0 };
  return { event: await commit(store, event, base) };
}

export async function reportChange(id: string, req: ApiRequest<"reportChange">): Promise<ApiResponse<"reportChange">> {
  const long = tooLong("The description", req.change.description, 1000);
  if (long.length > 0) throw new ServiceError("invalid_request", long[0]);
  const check = req.change.check_id;
  if (check && !(REPORTABLE_CHECK_IDS as readonly string[]).includes(check)) {
    throw new ServiceError("invalid_request", `${check} can't be reported; only space, surface, rain and start time can (D-JT24-12)`);
  }
  return review(id, req.version, `${req.change.kind}: ${req.change.description}`, "report_change", req.change);
}

export async function requestReview(id: string, req: ApiRequest<"requestReview">): Promise<ApiResponse<"requestReview">> {
  return review(id, req.version, "Organizer requested conflict review", "request_review");
}

export async function applyOption(id: string, req: ApiRequest<"applyOption">): Promise<ApiResponse<"applyOption">> {
  const store = await withStore();
  const event = await load(store, id);
  const base = event.updated_at;
  requireCurrent(event, req.version);
  const v = current(event);
  assertCanStart("apply_option", v);
  const review = v.alternatives;
  const option = review?.ranked_options.find((o) => o.combined_option_id === req.combined_option_id);
  if (!review || !option) throw new ServiceError("not_found", `Option ${req.combined_option_id} not found`);
  requireMatchingResult("Review", review, v.version, v.evidence_snapshot_id ?? "");
  requireMatchingResult("Option checks", option.checks, v.version, v.evidence_snapshot_id ?? "");
  const next = v.version + 1;
  const snapshot = v.evidence_snapshot_id ? await store.getSnapshot(v.evidence_snapshot_id) : null;
  if (!snapshot) throw new ServiceError("internal", "Evidence snapshot missing");
  // The harness checks the chosen plan itself; the option's checks were for display only (D-JT24-3).
  const checks = harnessChecks(event, option.plan, snapshot, next);
  const p = option.plan;
  const optionEvidence = new Set(option.evidence_ids);
  pushVersion(event, {
    ...emptyVersion(next, v.version, "review"),
    status: deriveStatus(p, checks),
    plan: p,
    evidence_snapshot_id: v.evidence_snapshot_id,
    checks,
    // Only facts the chosen option itself cites; the rest described the old park or time.
    facts: v.facts.filter((f) => f.evidence_ids.length > 0 && f.evidence_ids.every((id) => optionEvidence.has(id))),
    // Concerns come from the harness's own result, so they clear when the check passes. The option's
    // unknowns restate the same checks in the agent's words and would linger after a confirmation.
    concerns: concernsFrom(checks),
    // Only to-dos about the chosen park and time (or about the event as a whole).
    organizer_tasks: review.organizer_tasks.filter(
      (t) => t.park_id === null || (t.park_id === p.park_id && (t.start_time === null || t.start_time === p.start_time)),
    ),
  });
  return { event: await commit(store, event, base) };
}

/**
 * Records a confirmation for one check at one park (and time). It resolves matching unknown
 * checks on the current version and on later versions; it is new evidence, so it clears approval.
 */
export async function addConfirmation(id: string, req: ApiRequest<"addConfirmation">): Promise<ApiResponse<"addConfirmation">> {
  const store = await withStore();
  const event = await load(store, id);
  const base = event.updated_at;
  requireCurrent(event, req.version);
  const v = current(event);
  assertCanStart("add_confirmation", v);
  const long = [...tooLong("The statement", req.statement), ...tooLong("The note", req.note)];
  if (long.length > 0) throw new ServiceError("invalid_request", long.join("; "));
  if (!isConfirmableCheck(req.check_id)) {
    throw new ServiceError(
      "invalid_request",
      `${req.check_id} can't be confirmed by the organizer; only space, surface and permit checks can (D-JT24-1)`,
    );
  }
  const snapshot = v.evidence_snapshot_id ? await store.getSnapshot(v.evidence_snapshot_id) : null;
  const templates = snapshot?.workout_templates ?? [];
  const layout = confirmationLayout(req, v.plan, templates);
  // A newer report about this check and park ("the lawn is closed") makes a fresh confirmation count again.
  const lastReport = (event.change_reports ?? [])
    .filter((r) => r.check_id === req.check_id && (r.park_id === null || r.park_id === undefined || r.park_id === req.park_id))
    .at(-1)?.at;
  const repeat = event.confirmations.some(
    (c) =>
      c.check_id === req.check_id &&
      c.park_id === req.park_id &&
      c.start_time === req.start_time &&
      (c.layout ?? null) === layout &&
      (lastReport === undefined || c.confirmed_at > lastReport),
  );
  if (repeat) return { event };
  const conf = {
    id: newId("conf"),
    check_id: req.check_id,
    park_id: req.park_id,
    start_time: req.start_time,
    statement: req.statement,
    confirmed_by: "Organizer",
    confirmed_at: now(),
    note: req.note,
    // Space and surface confirmations only resolve plans with this layout (D-JT22-1).
    layout,
  };
  event.confirmations.push(conf);
  clearApproval(event);
  if (v.plan && snapshot) {
    // Re-check from scratch, so a confirmation that supersedes a report takes effect too.
    v.checks = harnessChecks(event, v.plan, snapshot, v.version);
    v.concerns = concernsFrom(v.checks);
    if (v.status === "needs_verification" && v.checks.overall === "pass") {
      transition(v, "ready_for_approval", "add_confirmation");
    }
  }
  return { event: await commit(store, event, base) };
}

/** Approves the exact current version + evidence snapshot. Repeating the same approval is a no-op. */
export async function approve(id: string, req: ApiRequest<"approve">): Promise<ApiResponse<"approve">> {
  const store = await withStore();
  const event = await load(store, id);
  const base = event.updated_at;
  requireCurrent(event, req.version);
  const v = current(event);
  if (
    v.status === "approved" &&
    event.approval?.version === v.version &&
    event.approval.evidence_snapshot_id === req.evidence_snapshot_id
  ) {
    return { event };
  }
  assertCanStart("approve", v);
  if (v.evidence_snapshot_id !== req.evidence_snapshot_id) {
    throw new ServiceError("stale_version", "Approval does not match the current evidence snapshot");
  }
  transition(v, "approved", "approve");
  event.approval = { version: v.version, evidence_snapshot_id: req.evidence_snapshot_id, approved_at: now() };
  return { event: await commit(store, event, base) };
}

/** Check areas whose critical checks need recorded evidence or an organizer confirmation (PRD §3 save gate). */
const CONFIRMED_AREAS = new Set(["space_surface", "permissions"]);

const pass = (id: GateCheck["id"], reason: string): GateCheck => ({ id, status: "pass", reason });
const fail = (id: GateCheck["id"], reason: string): GateCheck => ({ id, status: "fail", reason });

/** Marks the event finalized with `record`, the stored record for this version. */
function applyFinalized(event: FieldDayEvent, record: FinalizedRecord) {
  const v = event.versions.find((x) => x.version === record.version);
  if (v && v.status === "approved") transition(v, "finalized", "finalize");
  event.finalized = record;
}

/**
 * Final save gate (JT-09, D-JT09-1): approval is required but not sufficient. The five checks
 * (PRD §3) run on the approved version; any failure blocks the save and says what to fix.
 *
 * - complete_inputs: the brief is valid and the plan is on the brief's date.
 * - correct_version: approval names this exact version and evidence snapshot.
 * - current_evidence: evidence is gathered again. Unchanged evidence must still pass freshness.
 *   New evidence is revalidated: if the plan still passes, it is saved with the new snapshot;
 *   if not, a recheck version replaces the approved one, approval is cleared, and the save is blocked.
 * - hard_constraints: check_plan, run again here, passes every critical check.
 * - required_confirmations: every critical space, surface and permission check passes with evidence.
 *
 * Duplicate-save protection (JT-08): a repeat for the finalized version returns the saved record,
 * whatever its key (D-017). The store keeps one finalized record per event and version; if an earlier
 * save stored the record but not the event (an uncertain outcome), the next request reconciles.
 */
export async function finalize(id: string, req: ApiRequest<"finalize">): Promise<ApiResponse<"finalize">> {
  const store = await withStore();
  const event = await load(store, id);
  const base = event.updated_at;
  const done = event.finalized;
  if (done?.version === req.version) {
    return { event, gate: done.gate, finalized: true };
  }
  if (done?.idempotency_key === req.idempotency_key) {
    throw new ServiceError(
      "invalid_request",
      `Idempotency key already used to finalize version ${done.version}`,
    );
  }
  const recorded = await store.getFinalized(event.id, req.version);
  if (recorded) {
    applyFinalized(event, recorded);
    return { event: await commit(store, event, base), gate: recorded.gate, finalized: true };
  }
  requireCurrent(event, req.version);
  const v = current(event);
  const approved =
    v.status === "approved" &&
    event.approval?.version === v.version &&
    event.approval.evidence_snapshot_id === v.evidence_snapshot_id;

  const briefOk = EventBrief.safeParse(event.brief).success;
  const onDate = v.plan?.start_time?.startsWith(event.brief.date) ?? false;
  const gate: GateCheck[] = [
    !v.plan
      ? fail("complete_inputs", "This version has no plan")
      : !briefOk
        ? fail("complete_inputs", "The event brief is missing required fields or has invalid values")
        : !onDate
          ? fail("complete_inputs", `The plan's start time is not on the event date (${event.brief.date})`)
          : pass("complete_inputs", "Brief is complete and the plan matches its date"),
    approved
      ? pass("correct_version", `Approval matches v${v.version} and evidence snapshot ${v.evidence_snapshot_id}`)
      : fail("correct_version", `v${v.version} with snapshot ${v.evidence_snapshot_id} is not the approved version; approve it first`),
  ];
  if (!approved || !v.plan || !v.evidence_snapshot_id) {
    const notChecked = "Not checked: approve a complete plan first";
    gate.push(fail("current_evidence", notChecked), fail("hard_constraints", notChecked), fail("required_confirmations", notChecked));
    return { event, gate, finalized: false };
  }

  // Current evidence: gather it again and revalidate when it changed.
  const approvedSnapshot = await store.getSnapshot(v.evidence_snapshot_id);
  if (!approvedSnapshot) throw new ServiceError("internal", `Evidence snapshot ${v.evidence_snapshot_id} missing`);
  const fresh = await changedEvidence(store, event, v);
  let snapshot = approvedSnapshot;
  let evidenceNote = `Evidence unchanged since approval (snapshot ${approvedSnapshot.id})`;
  if (fresh) {
    const freshChecks = harnessChecks(event, v.plan, fresh, v.version);
    if (freshChecks.overall !== "pass") {
      const next = await refreshedSnapshot(event, v.version + 1);
      await store.saveSnapshot(next);
      pushRecheckVersion(event, v, next, harnessChecks(event, v.plan, next, v.version + 1));
      event.last_run = run("completed", [
        "Refreshed park, weather and air-quality evidence before saving",
        `New evidence (snapshot ${next.id}) no longer supports the approved plan; approval cleared`,
      ]);
      const blockers = freshChecks.blockers.join(", ") || "critical checks";
      const why = `Evidence changed since approval (snapshot ${fresh.id}) and the plan no longer passes (${blockers}). Review v${v.version + 1} and approve it again.`;
      gate.push(fail("current_evidence", why), fail("hard_constraints", `Not met on the new evidence: ${blockers}`), fail("required_confirmations", "Not checked: the evidence changed"));
      return { event: await commit(store, event, base), gate, finalized: false };
    }
    await store.saveSnapshot(fresh);
    snapshot = fresh;
    evidenceNote = `Evidence refreshed to snapshot ${fresh.id} and revalidated; the plan still passes`;
  }

  const checks = harnessChecks(event, v.plan, snapshot, v.version);
  const freshness = checks.checks.find((c) => c.check_id === "freshness.conditions");
  gate.push(
    freshness?.status === "pass"
      ? pass("current_evidence", evidenceNote)
      : fail("current_evidence", `Weather and air-quality data are not current for the whole event: ${freshness?.reason ?? "no freshness check"}. Recheck conditions.`),
  );
  gate.push(
    checks.overall === "pass"
      ? pass("hard_constraints", "check_plan passes every critical check for this park, time and workout")
      : fail("hard_constraints", `Critical checks failed or unknown: ${checks.blockers.join(", ")}`),
  );
  const layout = planLayout(v.plan, snapshot.workout_templates);
  const confirmed = (c: (typeof checks.checks)[number]) =>
    c.evidence_ids.length > 0 || event.confirmations.some((conf) => confirmationMatches(conf, c, layout));
  const unresolved = checks.checks.filter((c) => c.critical && CONFIRMED_AREAS.has(c.area) && (c.status !== "pass" || !confirmed(c)));
  gate.push(
    unresolved.length === 0
      ? pass("required_confirmations", "Every critical space, surface and permission check is resolved by recorded evidence or an organizer confirmation")
      : fail("required_confirmations", `Not yet confirmed: ${unresolved.map((c) => c.check_id).join(", ")}`),
  );
  if (gate.some((g) => g.status === "fail")) {
    // Kept on the event so the organizer still sees why after a reload (F-18).
    event.last_gate = { version: v.version, at: now(), gate };
    return { event: await commit(store, event, base), gate, finalized: false };
  }

  const template = snapshot.workout_templates.find((t) => t.id === v.plan!.workout_template_id);
  const record: FinalizedRecord = {
    version: v.version,
    evidence_snapshot_id: snapshot.id,
    finalized_at: now(),
    gate,
    idempotency_key: req.idempotency_key,
    // Saved, but not for real-world use while anything it rests on is unreviewed (D-JT24-2).
    demo_only:
      POLICY_CONFIG.review_status === "unreviewed_demo_policy" || template?.review.status !== "reviewed" || snapshot.origin === "fixture",
  };
  const saved = (await store.recordFinalized(event.id, record)) ? record : await store.getFinalized(event.id, v.version);
  applyFinalized(event, saved ?? record);
  try {
    return { event: await commit(store, event, base), gate: (saved ?? record).gate, finalized: true };
  } catch (e) {
    // Another request changed the event meanwhile. If it finalized this version, that is the same save.
    const latest = await store.getEvent(event.id);
    if (e instanceof ServiceError && latest?.finalized?.version === v.version) {
      return { event: latest, gate: latest.finalized.gate, finalized: true };
    }
    throw e;
  }
}
