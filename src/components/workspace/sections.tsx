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
    <div className="clay flex flex-wrap items-center gap-x-5 gap-y-2 rounded-surface bg-cream px-6 py-4 text-sm md:rounded-control">
      <StatusBadge status={version.status} />
      <span>
        Version <strong className="font-mono">v{version.version}</strong>
        {event.versions.length > 1 && <span className="text-ink-2"> of {event.versions.length}</span>}
      </span>
      {version.evidence_snapshot_id && (
        <span className="text-ink-2">
          Evidence <span className="font-mono text-xs">{version.evidence_snapshot_id}</span>
        </span>
      )}
      {event.finalized && (
        <span className="text-ink">
          🔒 Finalized <strong className="font-mono">v{event.finalized.version}</strong>
          {event.finalized.version !== version.version && " (an older version)"}
        </span>
      )}
      {run && (
        <span className="text-ink-2 sm:ml-auto">
          Last run: {run.status === "completed" ? "completed" : run.status.replace("_", " ")}
          {run.progress.length > 0 && ` · ${run.progress[run.progress.length - 1].message}`}
        </span>
      )}
      <span className="text-ink-2">Updated {formatUpdated(event.updated_at)}</span>
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
      className={blocking.length > 0 ? "bg-accent/35" : ""}
    >
      {blocking.length > 0 && (
        <ul className="space-y-2">
          {blocking.map((c) => (
            <li key={c.id} className="flex gap-2 text-sm text-ink">
              <span aria-hidden="true" className="text-ink">
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
        <ul className="mt-4 space-y-1.5">
          {other.map((c) => (
            <li key={c.id} className="text-sm text-ink-2">
              <span className="sr-only">Note: </span>• {c.description}
            </li>
          ))}
        </ul>
      )}
      {version.organizer_tasks.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-ink">Your to-do</h3>
          <ul className="mt-2 space-y-2">
            {version.organizer_tasks.map((t) => (
              <li key={t.id} className="clay-sm rounded-disclosure bg-cream px-5 py-3 text-sm text-ink">
                {t.description}
                {(t.park_id || t.start_time) && (
                  <span className="mt-0.5 block text-xs text-ink-2">
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
        <p className="text-sm text-ink-2">No plan yet. Generate one to see a park, time and workout.</p>
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
          <h3 className="text-sm font-bold text-ink">Facts used</h3>
          <ul className="mt-1.5 space-y-1.5">
            {version.facts.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                <Pill tone={f.status === "verified" ? "success" : f.status === "missing" ? "danger" : "warning"}>
                  {f.status === "verified" ? "✓ Verified" : f.status === "missing" ? "✕ Missing" : "? Unverified"}
                </Pill>
                {f.claim}
                {f.evidence_ids.map((id) => (
                  <a key={id} href={`#ev-${id}`} onClick={openEvidence} className="focus-ring rounded-control font-mono text-xs text-ink underline decoration-ink-2 underline-offset-2">
                    {id}
                  </a>
                ))}
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
  return { brief: "the brief", planning: "the Planning agent", review: "conflict review", organizer_edit: "an organizer edit", recheck: "a recheck" }[s];
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-ink-2">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
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
      <ul className="divide-y divide-ink/10">
        {sortChecks(checks.checks).map((c) => (
          <li key={c.check_id} className="flex gap-3 py-2.5">
            <CheckStatusPill status={c.status} />
            <div className="min-w-0 text-sm">
              <p className="font-bold text-ink">
                {checkName(c.check_id)}
                {!c.critical && <span className="ml-2 text-xs font-normal text-ink-2">(advisory, doesn&apos;t block)</span>}
              </p>
              <p className="text-ink-2">{c.reason}</p>
              {c.evidence_ids.length > 0 && (
                <p className="mt-0.5 flex flex-wrap gap-2">
                  {c.evidence_ids.map((id) => (
                    <a key={id} href={`#ev-${id}`} onClick={openEvidence} className="focus-ring rounded-control font-mono text-xs text-ink underline decoration-ink-2 underline-offset-2">
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
    <Card
      title="Evidence"
      description={`Snapshot ${snapshot.id} · ${items.length} items. Every fact above links here.`}
      actions={snapshot.origin === "fixture" ? <Pill tone="warning">Fixture data</Pill> : <Pill tone="success">Live data</Pill>}
    >
      {snapshot.coverage_gaps.length > 0 && (
        <ul className="clay-sm mb-4 space-y-1 rounded-disclosure bg-butter px-5 py-3 text-sm text-ink">
          {snapshot.coverage_gaps.map((g, i) => (
            <li key={i}>⚠ {g}</li>
          ))}
        </ul>
      )}
      <details id="evidence-items" className="group clay-sm rounded-disclosure bg-ground px-5 py-4">
        <summary className="focus-ring flex cursor-pointer list-none items-center gap-3 rounded-disclosure text-sm font-bold text-ink [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="clay-recessed grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cream text-lg leading-none">
            <span className="group-open:hidden">+</span>
            <span className="hidden group-open:inline">−</span>
          </span>
          Show all {items.length} evidence items
        </summary>
        <ul className="mt-4 space-y-3">
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
function openEvidence() {
  const list = document.getElementById("evidence-items");
  if (list instanceof HTMLDetailsElement) list.open = true;
}
