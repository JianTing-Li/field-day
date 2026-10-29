import {
  isConfirmableCheck,
  type CheckPlanResult,
  type EvidenceItem,
  type EvidenceSnapshot,
  type FieldDayEvent,
  type OrganizerTask,
  type PlanVersion,
} from "@/contracts";
import { formatUpdated } from "../format";
import { Card, Pill } from "../ui";
import {
  CHECK_STATUS,
  adaptationName,
  checkName,
  formatLocal,
  gapSummary,
  overallLabel,
  parkName,
  plainText,
  sortChecks,
  templateName,
} from "./logic";

/** Read-only sections of the event workspace (YT-09). */

/** Version, evidence snapshot and run details: useful for support and demos, not for everyday decisions. */
export function TechnicalDetails({ event, version }: { event: FieldDayEvent; version: PlanVersion }) {
  const run = event.last_run;
  return (
    <details className="group clay-sm rounded-disclosure bg-cream px-5 py-4 text-sm">
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-3 rounded-disclosure font-bold text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="clay-recessed grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ground text-lg leading-none">
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">−</span>
        </span>
        Technical details
      </summary>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-ink-2 sm:grid-cols-2">
        <Item label="Plan version">
          v{version.version} of {event.versions.length}
          {event.finalized && ` · v${event.finalized.version} is locked in`}
        </Item>
        <Item label="Evidence snapshot">
          <span className="font-mono text-xs">{version.evidence_snapshot_id ?? "none yet"}</span>
        </Item>
        {run && (
          <Item label="Last run">
            {run.status.replace("_", " ")}
            {run.progress.length > 0 && ` · ${run.progress[run.progress.length - 1].message}`}
          </Item>
        )}
        <Item label="Updated">{formatUpdated(event.updated_at)}</Item>
      </dl>
    </details>
  );
}

export function BlockersCard({
  version,
  snapshot,
  taskAction,
}: {
  version: PlanVersion;
  snapshot: EvidenceSnapshot | null;
  /** Optional control under each organizer task, e.g. the Confirm button (YT-11). */
  taskAction?: (task: OrganizerTask) => React.ReactNode;
}) {
  // A concern is settled once every check it's about passes (e.g. the organizer confirmed the space).
  const passedNow = new Set(version.checks?.checks?.filter((c) => c.status === "pass").map((c) => c.check_id) ?? []);
  const settled = (c: (typeof version.concerns)[number]) =>
    c.related_check_ids.length > 0 && c.related_check_ids.every((id) => passedNow.has(id));
  const blocking = version.concerns.filter((c) => c.blocking && !settled(c));
  const other = version.concerns.filter((c) => !c.blocking);
  if (blocking.length === 0 && other.length === 0 && version.organizer_tasks.length === 0) return null;
  // Once approved or locked in, every critical check passed: a red "blocking" card would contradict it.
  if (version.status === "approved" || version.status === "finalized") return null;
  // Every check passed (D-JT23-1): the agent's concerns are notes to review, not blockers.
  const ready = version.status === "ready_for_approval";
  // A task is about this plan if it names this plan's park (and time, when it names one).
  const forThisPlan = (t: OrganizerTask) =>
    t.park_id === null ||
    (t.park_id === version.plan?.park_id && (t.start_time === null || t.start_time === version.plan?.start_time));
  const done = version.organizer_tasks.filter(
    (t) => t.resolves_check_id !== null && passedNow.has(t.resolves_check_id) && forThisPlan(t),
  );
  // Space, surface and permit for this plan are confirmed in "Only you can check these", not here.
  const inConfirmPanel = (t: OrganizerTask) =>
    t.resolves_check_id !== null && isConfirmableCheck(t.resolves_check_id) && !passedNow.has(t.resolves_check_id) && forThisPlan(t);
  const goodToKnow = version.organizer_tasks.filter((t) => !done.includes(t) && !inConfirmPanel(t));
  return (
    <Card
      title={ready ? "Review before approving" : "What's blocking this plan"}
      description={
        ready
          ? "Every check passes, so this version can be approved. The agents raised these points; review them first."
          : "Critical problems must be fixed or confirmed before this version can be approved."
      }
      className={blocking.length > 0 && !ready ? "bg-danger/40" : ""}
    >
      {blocking.length > 0 && (
        <ul className="space-y-2">
          {blocking.map((c) => (
            <li key={c.id} className="flex gap-2 text-sm text-ink">
              <span aria-hidden="true" className="text-ink">
                ✕
              </span>
              <span>
                <span className="sr-only">{ready ? "Agent concern: " : "Blocking: "}</span>
                {plainText(c.description, snapshot)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {other.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {other.map((c) => (
            <li key={c.id} className="text-sm text-ink-2">
              <span className="sr-only">Note: </span>• {plainText(c.description, snapshot)}
            </li>
          ))}
        </ul>
      )}
      {[
        { title: "Good to know", tasks: goodToKnow, isDone: false },
        { title: "Done", tasks: done, isDone: true },
      ].map(
        (group) =>
          group.tasks.length > 0 && (
            <div key={group.title} className="mt-4">
              <h3 className="text-sm font-bold text-ink">{group.title}</h3>
              <ul className="mt-2 space-y-2">
                {group.tasks.map((t) => (
                  <li
                    key={t.id}
                    id={`task-${t.id}`}
                    className={`scroll-mt-24 rounded-disclosure px-5 py-3 text-sm text-ink ${group.isDone ? "bg-mint/60" : "clay-sm bg-cream"}`}
                  >
                    {group.isDone && <span aria-hidden="true">✓ </span>}
                    {group.isDone && <span className="sr-only">Done: </span>}
                    {plainText(t.description, snapshot)}
                    {(t.park_id || t.start_time) && (
                      <span className="mt-0.5 block text-xs text-ink-2">
                        {t.park_id && parkName(snapshot, t.park_id)}
                        {t.start_time && ` · ${formatLocal(t.start_time)}`}
                        {t.resolves_check_id && ` · for “${checkName(t.resolves_check_id)}”`}
                      </span>
                    )}
                    {!group.isDone && taskAction?.(t)}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
    </Card>
  );
}

export function PlanCard({ version, snapshot }: { version: PlanVersion; snapshot: EvidenceSnapshot | null }) {
  const p = version.plan;
  if (!p) {
    return (
      <Card title="Plan details">
        <p className="text-sm text-ink-2">No plan yet. Draft one to see a park, time and workout.</p>
      </Card>
    );
  }
  return (
    <Card title="Plan details" description={`Drafted by ${sourceLabel(version.source)}`}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Item label="Park">{parkName(snapshot, p.park_id)}</Item>
        <Item label="Start">{formatLocal(p.start_time)} (New York)</Item>
        <Item label="Length">{p.duration_minutes ? `${p.duration_minutes} minutes` : "Not set"}</Item>
        <Item label="Workout">
          {templateName(snapshot, p.workout_template_id)}
          {p.adaptation_ids.map((a) => (
            <span key={a} className="mt-0.5 block text-xs text-ink-2">
              Adapted: {adaptationName(snapshot, p.workout_template_id, a)}
            </span>
          ))}
        </Item>
      </dl>
      {p.session_outline.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-ink">Session outline</h3>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-sm text-ink-2">
            {p.session_outline.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {version.facts.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-ink">What this plan is based on</h3>
          <ul className="mt-1.5 space-y-1.5">
            {version.facts.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                <Pill tone={f.status === "verified" ? "success" : f.status === "missing" ? "danger" : "warning"}>
                  {f.status === "verified" ? "✓ Verified" : f.status === "missing" ? "✕ Missing" : "? Unverified"}
                </Pill>
                {plainText(f.claim, snapshot)}
                <SourceLinks ids={f.evidence_ids} snapshot={snapshot} />
                {f.missing_reason && <span className="text-xs text-ink-2">({f.missing_reason})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function sourceLabel(s: PlanVersion["source"]) {
  return {
    brief: "your brief",
    planning: "FieldDay's planner",
    review: "the alternatives you picked",
    organizer_edit: "your edit",
    recheck: "a weather recheck",
  }[s];
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-ink-2">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

export function ChecksList({
  checks,
  snapshot,
  title = "Safety checks",
}: {
  checks: CheckPlanResult | null;
  snapshot: EvidenceSnapshot | null;
  title?: string;
}) {
  if (!checks) return null;
  return (
    <Card
      title={title}
      description="FieldDay's rules check every plan, not the AI. Anything not checked yet never counts as safe."
      actions={<CheckStatusPill status={checks.overall} label={overallLabel(checks)} />}
    >
      <ul className="divide-y divide-ink/10">
        {sortChecks(checks.checks).map((c) => (
          <li key={c.check_id} className="flex gap-3 py-2.5">
            <CheckStatusPill status={c.status} />
            <div className="min-w-0 text-sm">
              <p className="font-bold text-ink">
                {checkName(c.check_id)}
                {!c.critical && <span className="ml-2 text-xs font-normal text-ink-2">(doesn&apos;t block approval)</span>}
              </p>
              <p className="text-ink-2">{plainText(c.reason, snapshot)}</p>
              {c.evidence_ids.length > 0 && (
                <p className="mt-0.5">
                  <SourceLinks ids={c.evidence_ids} snapshot={snapshot} />
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CheckStatusPill({ status, label }: { status: CheckPlanResult["overall"]; label?: string }) {
  const s = CHECK_STATUS[status];
  return (
    <span className={`clay-sm inline-flex h-fit shrink-0 items-center gap-1 rounded-control px-2.5 py-0.5 text-xs font-bold ${s.tone}`}>
      <span aria-hidden="true">{s.icon}</span>
      {label ?? s.label}
    </span>
  );
}

export function EvidenceList({ snapshot }: { snapshot: EvidenceSnapshot | null }) {
  if (!snapshot) return null;
  const items = snapshot.items;
  return (
    <details id="evidence-items" className="group clay-sm rounded-disclosure bg-cream px-5 py-4 text-sm">
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-3 rounded-disclosure font-bold text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="clay-recessed grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ground text-lg leading-none">
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">−</span>
        </span>
        <span className="flex-1">
          Sources ({items.length})
          <span className="block text-xs font-normal text-ink-2">
            Where every fact comes from: forecasts, air-quality readings, park records and your confirmations.
          </span>
        </span>
        {snapshot.origin === "fixture" && <Pill tone="warning">Demo data</Pill>}
      </summary>
      {snapshot.coverage_gaps.length > 0 && (
        <ul className="clay-sm mt-4 space-y-1 rounded-disclosure bg-butter px-5 py-3 text-ink">
          {gapSummary(snapshot.coverage_gaps, snapshot).map((g, i) => (
            <li key={i}>⚠ {g}</li>
          ))}
        </ul>
      )}
      <ul className="mt-4 space-y-3">
        {items.map((e) => (
          <EvidenceRow key={e.id} item={e} />
        ))}
      </ul>
    </details>
  );
}

function EvidenceRow({ item: e }: { item: EvidenceItem }) {
  const period = e.valid_from || e.valid_to ? `${e.valid_from ? formatLocal(e.valid_from) : "…"} → ${e.valid_to ? formatLocal(e.valid_to) : "…"}` : null;
  return (
    <li id={`ev-${e.id}`} className="clay-sm scroll-mt-24 rounded-disclosure bg-cream p-4 text-sm target:bg-cool">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-ink-2">{e.id}</span>
        <Pill>{e.evidence_type.replace("_", " ")}</Pill>
        {e.origin === "fixture" && <Pill tone="warning">Fixture</Pill>}
      </div>
      <p className="mt-1 text-ink">
        <span className="font-bold">{e.metric.replace(/_/g, " ")}:</span>{" "}
        {e.value === null ? <em className="text-ink-2">missing ({e.missing_reason})</em> : `${String(e.value)}${e.unit ? ` ${e.unit}` : ""}`}
        {e.category && ` (${e.category})`}
        {e.pollutant && ` · ${e.pollutant}`}
      </p>
      <p className="mt-0.5 text-xs text-ink-2">
        {e.source.name}
        {e.applies_to.area_label && ` · ${e.applies_to.area_label}`}
        {period && ` · valid ${period}`}
      </p>
      {e.limitations.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-ink-2">
          {e.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Evidence links point into the collapsed list, so open it before the browser jumps there. */
/**
 * Opens this page's sources before the browser jumps there. Next keeps pages you left mounted but
 * hidden, so the lookup stays inside this workspace instead of the first match in the document.
 */
function openEvidence(e: React.MouseEvent<HTMLAnchorElement>) {
  const list = e.currentTarget.closest("[data-workspace]")?.querySelector("#evidence-items");
  if (list instanceof HTMLDetailsElement) list.open = true;
}

const SOURCE_KIND: Record<EvidenceItem["evidence_type"], string> = {
  forecast: "forecast",
  observation: "reading",
  organizer_confirmation: "your confirmation",
  reference: "record",
};

/** "Source: NWS forecast · Organizer report", one link per distinct source, instead of raw evidence IDs. */
export function sourceNames(ids: string[], snapshot: EvidenceSnapshot | null): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const id of ids) {
    const item = snapshot?.items.find((i) => i.id === id);
    const label = !item
      ? "Source"
      : item.evidence_type === "organizer_confirmation"
        ? "Your confirmation"
        : `${item.source.name.replace(/\s*\(fixture\)/i, "")} ${SOURCE_KIND[item.evidence_type]}`;
    if (!seen.has(label)) seen.set(label, id);
  }
  return [...seen].map(([label, id]) => ({ id, label }));
}

function SourceLinks({ ids, snapshot }: { ids: string[]; snapshot: EvidenceSnapshot | null }) {
  const sources = sourceNames(ids, snapshot);
  if (sources.length === 0) return null;
  return (
    <span className="text-xs text-ink-2">
      Source:{" "}
      {sources.map((s, i) => (
        <span key={s.id}>
          {i > 0 && " · "}
          <a
            href={`#ev-${s.id}`}
            onClick={openEvidence}
            className="focus-ring rounded-control text-ink underline decoration-ink-2 underline-offset-2"
          >
            {s.label}
          </a>
        </span>
      ))}
    </span>
  );
}
