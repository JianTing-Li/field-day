import { case01, case02 } from "@fixtures/scenarios";
import {
  ZERO_USAGE,
  type ApiRequest,
  type ApiResponse,
  type EventBrief,
  type EventSummary,
  type FieldDayEvent,
  type GateCheck,
  type PlanVersion,
  type RunState,
  type Usage,
} from "@/contracts";
import { runConflictReview, runPlanning } from "@/server/orchestrator";
import { checkPlan } from "@/server/rules/check-plan";
import { getStore } from "@/server/store/memory";
import type { EventStore } from "@/server/store/types";
import { applyConfirmations } from "./confirmations";
import { ServiceError } from "./errors";
import { snapshotFor } from "./snapshots";
import { assertCanStart, deriveStatus, transition } from "./transitions";

/**
 * Lifecycle service (owner: JT, tasks JT-07, JT-09). One function per API endpoint.
 *
 * The harness owns all state. Every change to the brief, plan or evidence creates a new plan
 * version (old versions are kept) or clears approval in place; approval is tied to an exact
 * version + snapshot. Requests and agent results that name an outdated version or snapshot
 * are rejected with stale_version. Allowed status changes live in ./transitions.ts.
 *
 * Still stubbed: fixture snapshots (JT-03), the full save gate (JT-09), in-memory store (JT-08).
 */

const now = () => new Date().toISOString();
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
 * result never overwrites newer state. Pass null for a new event.
 * Every save moves updated_at past `base`, even within the same millisecond, so a change is
 * always detectable.
 */
async function commit(store: EventStore, event: FieldDayEvent, base: string | null): Promise<FieldDayEvent> {
  if (base !== null) {
    const stored = await store.getEvent(event.id);
    if (stored && stored.updated_at !== base) {
      throw new ServiceError("stale_version", "The event changed while this request was running; reload and retry");
    }
  }
  const t = Date.now();
  event.updated_at = new Date(base === null ? t : Math.max(t, Date.parse(base) + 1)).toISOString();
  await store.saveEvent(event);
  return event;
}

/** Runs the Planning Agent and adds its draft as a new version. */
async function plan(store: EventStore, event: FieldDayEvent): Promise<FieldDayEvent> {
  const base = current(event);
  const next = event.current_version + 1;
  const snapshot = await snapshotFor(event, next);
  await store.saveSnapshot(snapshot);
  const result = await runPlanning({
    event_id: event.id,
    event_version: next,
    brief: event.brief,
    snapshot,
  });
  if (!result.ok) {
    event.last_run = run(
      result.error.kind === "budget_exhausted" ? "budget_exhausted" : "failed",
      ["Drafting plan", `Could not draft a plan: ${result.error.message}`],
      result.usage,
    );
    return event;
  }
  const out = result.output;
  requireMatchingResult("Planning", out, next, snapshot.id);
  const checks = out.rule_checks ? applyConfirmations(out.rule_checks, event.confirmations).checks : null;
  pushVersion(event, {
    ...emptyVersion(next, base.version, "planning"),
    status: deriveStatus(out.plan, checks, out.status),
    plan: out.plan,
    evidence_snapshot_id: snapshot.id,
    checks,
    facts: out.facts,
    concerns: out.concerns,
    organizer_tasks: out.organizer_tasks,
  });
  event.last_run = run(
    "completed",
    ["Reading park, weather and air-quality evidence", "Drafted plan"],
    result.usage,
  );
  return event;
}

let seeded: Promise<void> | null = null;

/** Seeds two fixture events once per server process. */
function ensureSeeded(store: EventStore): Promise<void> {
  seeded ??= (async () => {
    if (await store.getEvent("evt-case-01")) return;
    await commit(store, await plan(store, newEvent("evt-case-01", case01.brief)), null);
    await commit(store, await plan(store, newEvent("evt-case-02", case02.brief)), null);
  })();
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
  const store = await withStore();
  return { event: await commit(store, newEvent(newId("evt"), req.brief), null) };
}

export async function getEvent(id: string): Promise<ApiResponse<"getEvent">> {
  const store = await withStore();
  const event = await load(store, id);
  const snapId = current(event).evidence_snapshot_id;
  return { event, snapshot: snapId ? await store.getSnapshot(snapId) : null };
}

/** A brief edit starts a new draft version and retires confirmations made under the old brief. */
export async function updateBrief(id: string, req: ApiRequest<"updateBrief">): Promise<ApiResponse<"updateBrief">> {
  const store = await withStore();
  const event = await load(store, id);
  const base = event.updated_at;
  requireCurrent(event, req.based_on_version);
  assertCanStart("update_brief", current(event));
  event.brief = req.brief;
  event.confirmations = [];
  pushVersion(event, emptyVersion(event.current_version + 1, event.current_version, "organizer_edit"));
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

/**
 * Refreshes evidence. Unchanged evidence (same snapshot ID) leaves the plan as is. A new
 * snapshot revalidates the current plan with check_plan as a new version and clears approval.
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
  const snapshot = await snapshotFor(event, next);
  if (snapshot.id === v.evidence_snapshot_id) {
    event.last_run = run("completed", [`Evidence unchanged (snapshot ${snapshot.id}); plan still valid`]);
    return { event: await commit(store, event, base) };
  }
  await store.saveSnapshot(snapshot);
  const raw = checkPlan({ plan: v.plan, brief: event.brief, snapshot, event_version: next });
  const { checks } = applyConfirmations(raw, event.confirmations);
  pushVersion(event, {
    ...emptyVersion(next, v.version, "recheck"),
    status: deriveStatus(v.plan, checks),
    plan: v.plan,
    evidence_snapshot_id: snapshot.id,
    checks,
    // Facts and alternatives cite the old snapshot, so they are not carried over.
    concerns: v.concerns,
    organizer_tasks: v.organizer_tasks,
  });
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
  // A reported change is new information about the plan, so it clears approval.
  if (action === "report_change") clearApproval(event);
  const result = await runConflictReview({
    event_id: event.id,
    event_version: v.version,
    brief: event.brief,
    snapshot,
    current_plan: v.plan,
    conflict: { source: "organizer", description, check_ids: v.checks?.blockers ?? [] },
  });
  const steps = ["Checking alternative parks and times", "Checking workout adaptations"];
  if (result.ok) {
    requireMatchingResult("Review", result.review, v.version, v.evidence_snapshot_id);
    v.alternatives = result.review;
    steps.push("Independent review complete");
  } else {
    steps.push(`Review could not complete: ${result.message}`);
  }
  event.last_run = run(result.ok ? "completed" : "failed", steps);
  return { event: await commit(store, event, base) };
}

export async function reportChange(id: string, req: ApiRequest<"reportChange">): Promise<ApiResponse<"reportChange">> {
  return review(id, req.version, `${req.change.kind}: ${req.change.description}`, "report_change");
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
  const { checks } = applyConfirmations({ ...option.checks, event_version: next }, event.confirmations);
  pushVersion(event, {
    ...emptyVersion(next, v.version, "review"),
    status: deriveStatus(option.plan, checks),
    plan: option.plan,
    evidence_snapshot_id: v.evidence_snapshot_id,
    checks,
    facts: v.facts,
    concerns: option.unknowns.map((u, i) => ({
      id: `unknown-${i + 1}`,
      description: u,
      blocking: true,
      related_check_ids: option.checks.blockers,
    })),
    organizer_tasks: review.organizer_tasks,
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
  const conf = {
    id: newId("conf"),
    check_id: req.check_id,
    park_id: req.park_id,
    start_time: req.start_time,
    statement: req.statement,
    confirmed_by: "Organizer",
    confirmed_at: now(),
    note: req.note,
  };
  event.confirmations.push(conf);
  clearApproval(event);
  if (v.checks) {
    const { checks, changed } = applyConfirmations(v.checks, [conf]);
    v.checks = checks;
    if (changed && v.status === "needs_verification" && checks.overall === "pass") {
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

/**
 * STUB save gate (JT-09): checks version, approval and hard constraints only.
 * Idempotent: a repeat for the finalized version returns the saved record, whatever its key.
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
  requireCurrent(event, req.version);
  const v = current(event);
  const approved =
    v.status === "approved" &&
    event.approval?.version === v.version &&
    event.approval.evidence_snapshot_id === v.evidence_snapshot_id;
  const gate: GateCheck[] = [
    { id: "complete_inputs", status: v.plan ? "pass" : "fail", reason: v.plan ? "Plan present" : "No plan for this version" },
    { id: "correct_version", status: approved ? "pass" : "fail", reason: approved ? "Approval matches this version and evidence snapshot" : "This exact version and snapshot are not approved" },
    { id: "current_evidence", status: "pass", reason: "Stub: freshness gate not implemented yet (JT-09)" },
    { id: "hard_constraints", status: v.checks?.overall === "pass" ? "pass" : "fail", reason: v.checks?.overall === "pass" ? "All critical checks pass" : "Critical checks failed or unknown" },
    { id: "required_confirmations", status: "pass", reason: "Stub: confirmations gate not implemented yet (JT-09)" },
  ];
  if (gate.some((g) => g.status === "fail")) return { event, gate, finalized: false };
  transition(v, "finalized", "finalize");
  event.finalized = {
    version: v.version,
    evidence_snapshot_id: v.evidence_snapshot_id!,
    finalized_at: now(),
    gate,
    idempotency_key: req.idempotency_key,
  };
  return { event: await commit(store, event, base), gate, finalized: true };
}
