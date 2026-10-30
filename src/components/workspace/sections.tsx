import type { CheckPlanResult, EvidenceItem, EvidenceSnapshot, PlanVersion } from "@/contracts";
import type { ReactNode } from "react";
import { CHECK_STATUS, adaptationName, checkName, overallLabel, plainText, sortChecks, templateName } from "./logic";

/**
 * Folded detail rows at the bottom of the event page (YT-09, trimmed in JT-24): how the plan was
 * checked, with each check's source on the same line, and the session outline. Everything else
 * that used to live here (sources list, technical details, blockers card) was either moved up to
 * the plan summary or dropped.
 */

/** One folded row: a short summary line, details on tap. */
export function Folded({ summary, aside, children }: { summary: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <details className="group clay-sm rounded-disclosure bg-cream px-5 py-4 text-sm">
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-3 rounded-disclosure font-bold text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="clay-recessed grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ground text-lg leading-none">
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">−</span>
        </span>
        <span className="flex-1">{summary}</span>
        {aside}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

/**
 * Every check, folded behind one line (the PRD's "every fact shows its source"). FieldDay's rules
 * decide these, not the AI, and anything not checked yet never counts as safe.
 */
export function HowWeChecked({ checks, snapshot }: { checks: CheckPlanResult | null; snapshot: EvidenceSnapshot | null }) {
  if (!checks) return null;
  return (
    <Folded summary="How we checked" aside={<CheckStatusPill status={checks.overall} label={overallLabel(checks)} />}>
      <p className="mb-2 text-xs text-ink-2">
        FieldDay&apos;s rules check every plan, not the AI. Nothing counts as safe until it&apos;s checked.
        {snapshot?.origin === "fixture" && " Weather, air quality and parks here are recorded demo data, not live."}
      </p>
      <ul className="divide-y divide-ink/10">
        {sortChecks(checks.checks).map((c) => (
          <li key={c.check_id} className="flex gap-3 py-2.5">
            <CheckStatusPill status={c.status} />
            <div className="min-w-0">
              <p className="font-bold text-ink">
                {checkName(c.check_id)}
                {!c.critical && <span className="ml-2 text-xs font-normal text-ink-2">(doesn&apos;t block approval)</span>}
              </p>
              <p className="text-ink-2">
                {plainText(c.reason, snapshot)}
                <SourceNote ids={c.evidence_ids} snapshot={snapshot} />
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Folded>
  );
}

/** The workout itself: what the group will do, folded until someone wants it. */
export function SessionOutline({ version, snapshot }: { version: PlanVersion; snapshot: EvidenceSnapshot | null }) {
  const p = version.plan;
  if (!p || (p.session_outline.length === 0 && p.adaptation_ids.length === 0)) return null;
  return (
    <Folded summary="Session outline">
      <p className="font-bold text-ink">
        {templateName(snapshot, p.workout_template_id)}
        {p.duration_minutes && ` · ${p.duration_minutes} min`}
      </p>
      {p.adaptation_ids.map((a) => (
        <p key={a} className="mt-0.5 text-ink-2">
          Adapted: {adaptationName(snapshot, p.workout_template_id, a)}
        </p>
      ))}
      {p.session_outline.length > 0 && (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-ink-2">
          {p.session_outline.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </Folded>
  );
}

export function CheckStatusPill({ status, label }: { status: CheckPlanResult["overall"]; label?: string }) {
  const s = CHECK_STATUS[status];
  return (
    <span className={`clay-sm inline-flex h-fit shrink-0 items-center gap-1 rounded-control px-2.5 py-0.5 text-xs font-bold ${s.tone}`}>
      {label ?? s.label}
    </span>
  );
}

const SOURCE_KIND: Record<EvidenceItem["evidence_type"], string> = {
  forecast: "forecast",
  observation: "reading",
  organizer_confirmation: "your confirmation",
  reference: "record",
};

/** "NWS forecast · Your confirmation": one name per distinct source, instead of raw evidence IDs. */
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

function SourceNote({ ids, snapshot }: { ids: string[]; snapshot: EvidenceSnapshot | null }) {
  const sources = sourceNames(ids, snapshot);
  if (sources.length === 0) return null;
  return <span className="text-xs"> · {sources.map((s) => s.label).join(" · ")}</span>;
}
