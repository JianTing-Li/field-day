"use client";

import { useState } from "react";
import type { ChangeReport, CheckId, EventBrief, EvidenceSnapshot, FieldDayEvent, PlanVersion } from "@/contracts";
import { equipmentLabel } from "../brief-form";
import { Button, fieldClass } from "../ui";
import { formatLocal, parkName } from "./logic";

/**
 * "Something changed?" (JT-24, D-JT24-12): always on the page while there is a plan, locked in or not.
 * Each choice maps to something FieldDay can act on: a report that fails one check at this park or
 * time (space, ground, rain, time), or a brief edit that re-plans (equipment, group size). "Something
 * else" is context for the agents only.
 */

type Choice =
  | { id: string; label: string; report: { kind: ChangeReport["kind"]; check_id: CheckId; scope: "park" | "time" }; placeholder: string }
  | { id: "equipment" | "group"; label: string; placeholder?: undefined; report?: undefined }
  | { id: "other"; label: string; placeholder: string; report?: undefined };

const CHOICES: Choice[] = [
  { id: "space", label: "Space is closed", report: { kind: "park_issue", check_id: "space_surface.space", scope: "park" }, placeholder: "The lawn is fenced off for reseeding" },
  { id: "ground", label: "Ground is wet or unsafe", report: { kind: "park_issue", check_id: "space_surface.surface", scope: "park" }, placeholder: "The field is flooded" },
  { id: "rain", label: "Rain or storm", report: { kind: "conditions", check_id: "weather.rain", scope: "time" }, placeholder: "Thunderstorms all morning" },
  { id: "time", label: "Time doesn't work", report: { kind: "time_unavailable", check_id: "event_constraints.start_window", scope: "time" }, placeholder: "The instructor can't start until 9" },
  { id: "equipment", label: "Equipment missing" },
  { id: "group", label: "Group size changed" },
  { id: "other", label: "Something else", placeholder: "What changed?" },
];

export function SomethingChanged({
  event,
  version: v,
  snapshot,
  busy,
  onReport,
  onEditBrief,
  onRemove,
}: {
  event: FieldDayEvent;
  version: PlanVersion;
  snapshot: EvidenceSnapshot | null;
  busy: boolean;
  onReport: (change: ChangeReport) => Promise<boolean>;
  onEditBrief: (patch: Partial<EventBrief>) => Promise<boolean>;
  /** Withdraws a report ("it's not going to rain after all"). */
  onRemove: (reportId: string) => void;
}) {
  const [open, setOpen] = useState<Choice | null>(null);
  const [details, setDetails] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [group, setGroup] = useState(String(event.brief.group_size));
  const [error, setError] = useState<string | null>(null);
  const p = v.plan;
  if (!p) return null;
  const park = parkName(snapshot, p.park_id);
  const when = formatLocal(p.start_time).split(" · ").at(-1);
  const reports = (event.change_reports ?? []).filter((r) => r.id && r.check_id);

  const pick = (c: Choice) => {
    setOpen(open?.id === c.id ? null : c);
    setDetails("");
    setMissing([]);
    setGroup(String(event.brief.group_size));
    setError(null);
  };

  async function submit() {
    if (!open) return;
    let ok = false;
    if (open.report) {
      const scope = open.report.scope === "park" ? { park_id: p!.park_id, start_time: null } : { park_id: null, start_time: p!.start_time };
      const fallback = open.report.scope === "park" ? `${open.label} at ${park}` : `${open.label} at ${when}`;
      ok = await onReport({ kind: open.report.kind, description: details.trim() || fallback, check_id: open.report.check_id, ...scope });
    } else if (open.id === "equipment") {
      if (missing.length === 0) return setError("Pick what's missing");
      ok = await onEditBrief({ equipment_available: event.brief.equipment_available.filter((e) => !missing.includes(e)) });
    } else if (open.id === "group") {
      const n = Number(group);
      if (!Number.isInteger(n) || n < 1 || n > 500) return setError("Enter a whole number from 1 to 500");
      ok = await onEditBrief({ group_size: n });
    } else {
      if (!details.trim()) return setError("Say what changed");
      ok = await onReport({ kind: "other", description: details.trim() });
    }
    if (ok) setOpen(null);
  }

  return (
    <section className="clay rounded-surface bg-cream p-6 sm:p-8">
      <h2 className="text-xl font-bold tracking-tight text-ink">Something changed?</h2>
      {reports.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label="What you reported">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 text-sm text-ink">
              <span>You said &ldquo;{r.description}&rdquo;</span>
              <Button variant="ghost" className="px-0 py-1 text-xs" disabled={busy} onClick={() => onRemove(r.id!)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="What changed">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={open?.id === c.id}
            disabled={busy}
            onClick={() => pick(c)}
            className={`focus-ring rounded-control px-4 py-2 text-sm font-bold text-ink disabled:opacity-55 ${open?.id === c.id ? "clay-recessed bg-mint" : "clay-sm bg-cream"}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {open && (
        <div className="clay-recessed animate-enter mt-4 space-y-3 rounded-disclosure bg-ground p-5">
          {open.id === "equipment" ? (
            event.brief.equipment_available.length === 0 ? (
              <p className="text-sm text-ink">Your brief doesn&apos;t list any equipment, so nothing can go missing.</p>
            ) : (
              <fieldset>
                <legend className="text-sm font-bold text-ink">What&apos;s missing?</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {event.brief.equipment_available.map((e) => (
                    <label key={e} className="clay-sm flex cursor-pointer items-center gap-2 rounded-control bg-cream px-4 py-2 text-sm has-[:checked]:clay-recessed has-[:checked]:bg-mint">
                      <input
                        type="checkbox"
                        checked={missing.includes(e)}
                        onChange={() => setMissing((m) => (m.includes(e) ? m.filter((x) => x !== e) : [...m, e]))}
                        className="h-4 w-4 accent-ink"
                      />
                      {equipmentLabel(e)}
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          ) : open.id === "group" ? (
            <div>
              <label htmlFor="change-group" className="mb-2 block text-sm font-bold text-ink">
                How many people now?
              </label>
              <input
                id="change-group"
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value);
                  setError(null);
                }}
                className={`${fieldClass(error)} max-w-40`}
              />
            </div>
          ) : (
            <div>
              <label htmlFor="change-details" className="mb-2 block text-sm font-bold text-ink">
                {open.id === "other" ? "What changed?" : "Details (optional)"}
              </label>
              <input
                id="change-details"
                value={details}
                maxLength={500}
                onChange={(e) => {
                  setDetails(e.target.value);
                  setError(null);
                }}
                placeholder={open.placeholder}
                className={fieldClass(error)}
              />
            </div>
          )}
          {error && <p className="text-sm font-bold text-danger-ink">{error}</p>}
          <p className="text-xs text-ink-2">
            FieldDay checks the plan again and looks for a fix.
            {event.finalized && " Your locked-in plan stays saved until you lock in a new one."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy} onClick={submit}>
              Find a fix
            </Button>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
