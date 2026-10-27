import { case01, case02 } from "@fixtures/scenarios";
import type {
  ApiRequest,
  ApiResponse,
  CheckPlanResult,
  CheckResult,
  EventBrief,
  EventSummary,
  EvidenceSnapshot,
  FieldDayEvent,
  GateCheck,
  LifecycleStatus,
  PlanVersion,
  PlanningOutput,
} from "@/contracts";
import { runConflictReview, runPlanning } from "@/server/orchestrator";
import { summarizeChecks } from "@/server/rules/check-plan";
import { getStore } from "@/server/store/memory";
import type { EventStore } from "@/server/store/types";
import { ServiceError } from "./errors";

/**
 * Lifecycle service (owner: JT, tasks JT-07, JT-09). One function per API endpoint.
 *
 * STUB: fixture-backed. New events use the Case 1 fixture snapshot. Two seeded events
 * (Case 1 ready for approval, Case 2 blocked) give the UI every main state.
 * Not yet real: evidence refresh, the final save gate, durable persistence.
 */

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function current(event: FieldDayEvent): PlanVersion {
  return event.versions.find((v) => v.version === event.current_version)!;
}

function statusFrom(checks: CheckPlanResult | null, agentStatus: PlanningOutput["status"]): LifecycleStatus {
  if (agentStatus === "no_feasible_option") return "no_feasible_option";
  if (agentStatus === "draft" && checks?.overall === "pass") return "ready_for_approval";
  return "needs_verification";
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

/** Stub snapshot selection: Case 2 for the seeded Case 2 event, Case 1 for everything else. */
function fixtureSnapshot(event: FieldDayEvent): EvidenceSnapshot {
  const scenario = event.id === "evt-case-02" ? case02 : case01;
  return scenario.snapshot(event.id, event.current_version);
}

function progress(message: string) {
  return { at: now(), message };
}

async function load(store: EventStore, id: string): Promise<FieldDayEvent> {
  const event = await store.getEvent(id);
  if (!event) throw new ServiceError("not_found", `Event ${id} not found`);
  return event;
}

async function save(store: EventStore, event: FieldDayEvent): Promise<FieldDayEvent> {
  event.updated_at = now();
  await store.saveEvent(event);
  return event;
}

async function plan(store: EventStore, event: FieldDayEvent): Promise<FieldDayEvent> {
  const base = current(event);
  const next = event.current_version + 1;
  const snapshot = fixtureSnapshot({ ...event, current_version: next });
  await store.saveSnapshot(snapshot);
  const result = await runPlanning({
    event_id: event.id,
    event_version: next,
    brief: event.brief,
    snapshot,
  });
  const run_id = newId("run");
  if (!result.ok) {
    event.last_run = {
      run_id,
      status: result.error.kind === "budget_exhausted" ? "budget_exhausted" : "failed",
      revision_count: 0,
      usage: result.usage,
      progress: [progress("Drafting plan"), progress(`Could not draft a plan: ${result.error.message}`)],
    };
    return event;
  }
  const out = result.output;
  event.versions.push({
    ...emptyVersion(next, base.version, "planning"),
    status: statusFrom(out.rule_checks, out.status),
    plan: out.plan,
    evidence_snapshot_id: snapshot.id,
    checks: out.rule_checks,
    facts: out.facts,
    concerns: out.concerns,
    organizer_tasks: out.organizer_tasks,
  });
  event.current_version = next;
  event.approval = null;
  event.last_run = {
    run_id,
    status: "completed",
    revision_count: 0,
    usage: result.usage,
    progress: [progress("Reading park, weather and air-quality evidence"), progress("Drafted plan")],
  };
  return event;
}

let seeded: Promise<void> | null = null;

/** Seeds two fixture events once per server process. */
function ensureSeeded(store: EventStore): Promise<void> {
  seeded ??= (async () => {
    if (await store.getEvent("evt-case-01")) return;
    await save(store, await plan(store, newEvent("evt-case-01", case01.brief)));
    await save(store, await plan(store, newEvent("evt-case-02", case02.brief)));
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
  return { event: await save(store, newEvent(newId("evt"), req.brief)) };
}

export async function getEvent(id: string): Promise<ApiResponse<"getEvent">> {
  const store = await withStore();
  const event = await load(store, id);
  const snapId = current(event).evidence_snapshot_id;
  return { event, snapshot: snapId ? await store.getSnapshot(snapId) : null };
}

export async function updateBrief(id: string, req: ApiRequest<"updateBrief">): Promise<ApiResponse<"updateBrief">> {
  const store = await withStore();
  const event = await load(store, id);
  requireCurrent(event, req.based_on_version);
  const next = event.current_version + 1;
  event.brief = req.brief;
  event.versions.push(emptyVersion(next, event.current_version, "organizer_edit"));
  event.current_version = next;
  event.approval = null;
  return { event: await save(store, event) };
}

export async function generateDraft(id: string, req: ApiRequest<"generateDraft">): Promise<ApiResponse<"generateDraft">> {
  const store = await withStore();
  const event = await load(store, id);
  requireCurrent(event, req.version);
  return { event: await save(store, await plan(store, event)) };
}

export async function recheck(id: string, req: ApiRequest<"recheck">): Promise<ApiResponse<"recheck">> {
  const store = await withStore();
  const event = await load(store, id);
  requireCurrent(event, req.version);
  event.last_run = {
    run_id: newId("run"),
    status: "completed",
    revision_count: 0,
    usage: { agent_executions: 0, model_requests: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0, elapsed_ms: 0 },
    progress: [progress("Evidence refresh is not implemented yet (JT-03); plan unchanged")],
  };
  return { event: await save(store, event) };
}

async function review(id: string, version: number, description: string, source: "harness" | "organizer") {
  const store = await withStore();
  const event = await load(store, id);
  requireCurrent(event, version);
  const v = current(event);
  if (!v.plan || !v.evidence_snapshot_id) {
    throw new ServiceError("invalid_request", "Generate a draft before requesting review");
  }
  const snapshot = await store.getSnapshot(v.evidence_snapshot_id);
  if (!snapshot) throw new ServiceError("internal", "Evidence snapshot missing");
  const result = await runConflictReview({
    event_id: event.id,
    event_version: v.version,
    brief: event.brief,
    snapshot,
    current_plan: v.plan,
    conflict: { source, description, check_ids: v.checks?.blockers ?? [] },
  });
  const steps = [progress("Checking alternative parks and times"), progress("Checking workout adaptations")];
  if (result.ok) {
    v.alternatives = result.review;
    steps.push(progress("Independent review complete"));
  } else {
    steps.push(progress(`Review could not complete: ${result.message}`));
  }
  event.last_run = {
    run_id: newId("run"),
    status: result.ok ? "completed" : "failed",
    revision_count: 0,
    usage: { agent_executions: 0, model_requests: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0, elapsed_ms: 0 },
    progress: steps,
  };
  return { event: await save(store, event) };
}

export async function reportChange(id: string, req: ApiRequest<"reportChange">): Promise<ApiResponse<"reportChange">> {
  return review(id, req.version, `${req.change.kind}: ${req.change.description}`, "organizer");
}

export async function requestReview(id: string, req: ApiRequest<"requestReview">): Promise<ApiResponse<"requestReview">> {
  return review(id, req.version, "Organizer requested conflict review", "organizer");
}

export async function applyOption(id: string, req: ApiRequest<"applyOption">): Promise<ApiResponse<"applyOption">> {
  const store = await withStore();
  const event = await load(store, id);
  requireCurrent(event, req.version);
  const v = current(event);
  const option = v.alternatives?.ranked_options.find((o) => o.combined_option_id === req.combined_option_id);
  if (!option) throw new ServiceError("not_found", `Option ${req.combined_option_id} not found`);
  const next = event.current_version + 1;
  event.versions.push({
    ...emptyVersion(next, v.version, "review"),
    status: option.checks.overall === "pass" ? "ready_for_approval" : "needs_verification",
    plan: option.plan,
    evidence_snapshot_id: v.evidence_snapshot_id,
    checks: { ...option.checks, event_version: next },
    facts: v.facts,
    concerns: option.unknowns.map((u, i) => ({ id: `unknown-${i + 1}`, description: u, blocking: true, related_check_ids: option.checks.blockers })),
    organizer_tasks: v.alternatives?.organizer_tasks ?? [],
  });
  event.current_version = next;
  event.approval = null;
  return { event: await save(store, event) };
}

export async function addConfirmation(id: string, req: ApiRequest<"addConfirmation">): Promise<ApiResponse<"addConfirmation">> {
  const store = await withStore();
  const event = await load(store, id);
  requireCurrent(event, req.version);
  const v = current(event);
  event.confirmations.push({
    id: newId("conf"),
    check_id: req.check_id,
    park_id: req.park_id,
    start_time: req.start_time,
    statement: req.statement,
    confirmed_by: "Organizer",
    confirmed_at: now(),
    note: req.note,
  });
  // A confirmation resolves only the stated unknown check at the stated park (and time, if given).
  // It never overrides a failed check and never carries over to another park.
  const matches = (c: CheckResult) =>
    c.check_id === req.check_id &&
    c.assessed.park_id === req.park_id &&
    (req.start_time === null || c.assessed.start_time === req.start_time);
  if (v.checks && v.evidence_snapshot_id) {
    const checks = v.checks.checks.map((c) =>
      matches(c) && c.status === "unknown"
        ? { ...c, status: "pass" as const, reason: `Organizer confirmed: ${req.statement}` }
        : c,
    );
    v.checks = summarizeChecks(v.version, v.evidence_snapshot_id, checks);
    if (v.status === "needs_verification" && v.checks.overall === "pass") v.status = "ready_for_approval";
  }
  return { event: await save(store, event) };
}

export async function approve(id: string, req: ApiRequest<"approve">): Promise<ApiResponse<"approve">> {
  const store = await withStore();
  const event = await load(store, id);
  requireCurrent(event, req.version);
  const v = current(event);
  if (v.evidence_snapshot_id !== req.evidence_snapshot_id) {
    throw new ServiceError("stale_version", "Approval does not match the current evidence snapshot");
  }
  if (v.status !== "ready_for_approval") {
    throw new ServiceError("blocked", `Version ${v.version} is ${v.status}, not ready for approval`, v.checks?.blockers);
  }
  v.status = "approved";
  event.approval = { version: v.version, evidence_snapshot_id: req.evidence_snapshot_id, approved_at: now() };
  return { event: await save(store, event) };
}

/** STUB save gate (JT-09): checks version, approval and hard constraints only. */
export async function finalize(id: string, req: ApiRequest<"finalize">): Promise<ApiResponse<"finalize">> {
  const store = await withStore();
  const event = await load(store, id);
  if (event.finalized?.version === req.version) {
    return { event, gate: event.finalized.gate, finalized: true };
  }
  const v = event.versions.find((x) => x.version === req.version);
  const approved = event.approval?.version === req.version && req.version === event.current_version;
  const gate: GateCheck[] = [
    { id: "complete_inputs", status: v?.plan ? "pass" : "fail", reason: v?.plan ? "Plan present" : "No plan for this version" },
    { id: "correct_version", status: approved ? "pass" : "fail", reason: approved ? "Approval matches this version" : "This exact version is not the approved current version" },
    { id: "current_evidence", status: "pass", reason: "Stub: freshness gate not implemented yet (JT-09)" },
    { id: "hard_constraints", status: v?.checks?.overall === "pass" ? "pass" : "fail", reason: v?.checks?.overall === "pass" ? "All critical checks pass" : "Critical checks failed or unknown" },
    { id: "required_confirmations", status: "pass", reason: "Stub: confirmations gate not implemented yet (JT-09)" },
  ];
  if (!v || gate.some((g) => g.status === "fail")) return { event, gate, finalized: false };
  v.status = "finalized";
  event.finalized = {
    version: v.version,
    evidence_snapshot_id: v.evidence_snapshot_id!,
    finalized_at: now(),
    gate,
  };
  return { event: await save(store, event), gate, finalized: true };
}
