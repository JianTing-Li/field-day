import type { CheckPlanResult, EvidenceItem, EvidenceSnapshot, FieldDayEvent, OrganizerTask, PlanVersion } from "@/contracts";
import { StatusBadge } from "../StatusBadge";
import { formatUpdated } from "../format";
import { Card, Pill } from "../ui";
import {
  CHECK_STATUS,
  adaptationName,
  checkName,
  formatLocal,
  parkName,
  sortChecks,
  templateName,
} from "./logic";

/** Read-only sections of the event workspace (YT-09). */

export function StatusBar({ event, version }: { event: FieldDayEvent; version: PlanVersion }) {
  const run = event.last_run;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-stone-200 bg-white px-5 py-3 text-sm">
      <StatusBadge status={version.status} />
      <span>
        Version <strong className="font-mono">v{version.version}</strong>
        {event.versions.length > 1 && <span className="text-stone-500"> of {event.versions.length}</span>}
      </span>
      {version.evidence_snapshot_id && (
        <span className="text-stone-600">
          Evidence <span className="font-mono text-xs">{version.evidence_snapshot_id}</span>
        </span>
      )}
      {event.finalized && (
        <span className="text-emerald-800">
          🔒 Finalized <strong className="font-mono">v{event.finalized.version}</strong>
          {event.finalized.version !== version.version && " (an older version)"}
        </span>
      )}
      {run && (
        <span className="text-stone-500 sm:ml-auto">
          Last run: {run.status === "completed" ? "completed" : run.status.replace("_", " ")}
          {run.progress.length > 0 && ` · ${run.progress[run.progress.length - 1].message}`}
        </span>
      )}
      <span className="text-stone-500">Updated {formatUpdated(event.updated_at)}</span>
    </div>
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
  const blocking = version.concerns.filter((c) => c.blocking);
  const other = version.concerns.filter((c) => !c.blocking);
  if (blocking.length === 0 && other.length === 0 && version.organizer_tasks.length === 0) return null;
  return (
    <Card
      title="What's blocking this plan"
      description="Critical problems must be fixed or confirmed before this version can be approved."
      className={blocking.length > 0 ? "border-rose-200" : ""}
    >
      {blocking.length > 0 && (
        <ul className="space-y-2">
          {blocking.map((c) => (
            <li key={c.id} className="flex gap-2 text-sm text-stone-800">
              <span aria-hidden="true" className="text-rose-700">
                ✕
              </span>
              <span>
                <span className="sr-only">Blocking: </span>
                {c.description}
              </span>
            </li>
          ))}
        </ul>
      )}
      {other.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-stone-100 pt-3">
          {other.map((c) => (
            <li key={c.id} className="text-sm text-stone-600">
              <span className="sr-only">Note: </span>• {c.description}
            </li>
          ))}
        </ul>
      )}
      {version.organizer_tasks.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-stone-900">Your to-do</h3>
          <ul className="mt-2 space-y-2">
            {version.organizer_tasks.map((t) => (
              <li key={t.id} className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-800">
                {t.description}
                {(t.park_id || t.start_time) && (
                  <span className="mt-0.5 block text-xs text-stone-500">
                    {t.park_id && parkName(snapshot, t.park_id)}
                    {t.start_time && ` · ${formatLocal(t.start_time)}`}
                    {t.resolves_check_id && ` · resolves “${checkName(t.resolves_check_id)}”`}
                  </span>
                )}
                {taskAction?.(t)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function PlanCard({ version, snapshot }: { version: PlanVersion; snapshot: EvidenceSnapshot | null }) {
  const p = version.plan;
  if (!p) {
    return (
      <Card title="Plan">
        <p className="text-sm text-stone-600">No plan yet. Generate one to see a park, time and workout.</p>
      </Card>
    );
  }
  return (
    <Card title="Plan" description={`v${version.version} · drafted by ${sourceLabel(version.source)}`}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Item label="Park">{parkName(snapshot, p.park_id)}</Item>
        <Item label="Start">{formatLocal(p.start_time)} (New York)</Item>
        <Item label="Length">{p.duration_minutes ? `${p.duration_minutes} minutes` : "Not set"}</Item>
        <Item label="Workout">
          {templateName(snapshot, p.workout_template_id)}
          {p.adaptation_ids.map((a) => (
            <span key={a} className="mt-0.5 block text-xs text-stone-600">
              Adapted: {adaptationName(snapshot, p.workout_template_id, a)}
            </span>
          ))}
        </Item>
      </dl>
      {p.session_outline.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-stone-900">Session outline</h3>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-sm text-stone-700">
            {p.session_outline.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {version.facts.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-stone-900">Facts used</h3>
          <ul className="mt-1.5 space-y-1.5">
            {version.facts.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm text-stone-700">
                <Pill tone={f.status === "verified" ? "success" : f.status === "missing" ? "danger" : "warning"}>
                  {f.status === "verified" ? "✓ Verified" : f.status === "missing" ? "✕ Missing" : "? Unverified"}
                </Pill>
                {f.claim}
                {f.evidence_ids.map((id) => (
                  <a key={id} href={`#ev-${id}`} className="font-mono text-xs text-sky-800 underline">
                    {id}
                  </a>
                ))}
                {f.missing_reason && <span className="text-xs text-stone-500">({f.missing_reason})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function sourceLabel(s: PlanVersion["source"]) {
  return { brief: "the brief", planning: "the Planning agent", review: "conflict review", organizer_edit: "an organizer edit", recheck: "a recheck" }[s];
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="mt-0.5 text-stone-900">{children}</dd>
    </div>
  );
}

export function ChecksList({ checks, title = "Checks" }: { checks: CheckPlanResult | null; title?: string }) {
  if (!checks) return null;
  const overall = CHECK_STATUS[checks.overall];
  return (
    <Card
      title={title}
      description="Checked by FieldDay's rules, not by the AI. Unknown never counts as pass."
      actions={<CheckStatusPill status={checks.overall} label={`Overall: ${overall.label}`} />}
    >
      <ul className="divide-y divide-stone-100">
        {sortChecks(checks.checks).map((c) => (
          <li key={c.check_id} className="flex gap-3 py-2.5">
            <CheckStatusPill status={c.status} />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-stone-900">
                {checkName(c.check_id)}
                {!c.critical && <span className="ml-2 text-xs font-normal text-stone-500">(advisory, doesn&apos;t block)</span>}
              </p>
              <p className="text-stone-600">{c.reason}</p>
              {c.evidence_ids.length > 0 && (
                <p className="mt-0.5 flex flex-wrap gap-2">
                  {c.evidence_ids.map((id) => (
                    <a key={id} href={`#ev-${id}`} className="font-mono text-xs text-sky-800 underline">
                      {id}
                    </a>
                  ))}
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
    <span className={`inline-flex h-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.tone}`}>
      <span aria-hidden="true">{s.icon}</span>
      {label ?? s.label}
    </span>
  );
}

export function EvidenceList({ snapshot }: { snapshot: EvidenceSnapshot | null }) {
  if (!snapshot) return null;
  const items = snapshot.items;
  return (
    <Card
      title="Evidence"
      description={`Snapshot ${snapshot.id} · ${items.length} items. Every fact above links here.`}
      actions={snapshot.origin === "fixture" ? <Pill tone="warning">Fixture data</Pill> : <Pill tone="success">Live data</Pill>}
    >
      {snapshot.coverage_gaps.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
          {snapshot.coverage_gaps.map((g, i) => (
            <li key={i}>⚠ {g}</li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium text-emerald-900">Show all {items.length} evidence items</summary>
        <ul className="mt-3 space-y-2">
          {items.map((e) => (
            <EvidenceRow key={e.id} item={e} />
          ))}
        </ul>
      </details>
    </Card>
  );
}

function EvidenceRow({ item: e }: { item: EvidenceItem }) {
  const period = e.valid_from || e.valid_to ? `${e.valid_from ? formatLocal(e.valid_from) : "…"} → ${e.valid_to ? formatLocal(e.valid_to) : "…"}` : null;
  return (
    <li id={`ev-${e.id}`} className="scroll-mt-20 rounded-lg border border-stone-200 p-3 text-sm target:border-sky-400 target:bg-sky-50">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-stone-500">{e.id}</span>
        <Pill>{e.evidence_type.replace("_", " ")}</Pill>
        {e.origin === "fixture" && <Pill tone="warning">Fixture</Pill>}
      </div>
      <p className="mt-1 text-stone-900">
        <span className="font-medium">{e.metric.replace(/_/g, " ")}:</span>{" "}
        {e.value === null ? <em className="text-stone-500">missing ({e.missing_reason})</em> : `${String(e.value)}${e.unit ? ` ${e.unit}` : ""}`}
        {e.category && ` (${e.category})`}
        {e.pollutant && ` · ${e.pollutant}`}
      </p>
      <p className="mt-0.5 text-xs text-stone-500">
        {e.source.name}
        {e.applies_to.area_label && ` · ${e.applies_to.area_label}`}
        {period && ` · valid ${period}`}
      </p>
      {e.limitations.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-stone-600">
          {e.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
