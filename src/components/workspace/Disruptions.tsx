"use client";

import { useState } from "react";
import type { ChangeItem, EvidenceSnapshot, FieldDayEvent, PlanVersion } from "@/contracts";
import { equipmentLabel } from "../brief-form";
import { Button, fieldClass } from "../ui";
import { applyLabel, changeLine } from "./changes";

/**
 * "Something changed?" (JT-24, reworked in JT-28, D-JT28-1): say what changed in your own words,
 * as many things at once as you like, or tap a shortcut. FieldDay reads it into a list, shows what
 * it will do about each one (or why it can't), and changes nothing until you confirm.
 */

type Shortcut =
  | { id: string; label: string; item: ChangeItem }
  | { id: "time" | "group" | "equipment"; label: string; item?: undefined };

const SHORTCUTS: Shortcut[] = [
  { id: "space", label: "Space is closed", item: { type: "report", what: "space", said: "Space is closed" } },
  { id: "ground", label: "Ground is wet", item: { type: "report", what: "ground", said: "Ground is wet or unsafe" } },
  { id: "rain", label: "Rain or storm", item: { type: "report", what: "rain", said: "Rain or storm" } },
  { id: "time", label: "New time" },
  { id: "group", label: "Group size changed" },
  { id: "equipment", label: "Equipment missing" },
];

export function SomethingChanged({
  event,
  version: v,
  snapshot,
  busy,
  onRead,
  onApply,
  onRemove,
}: {
  event: FieldDayEvent;
  version: PlanVersion;
  snapshot: EvidenceSnapshot | null;
  busy: boolean;
  /** Reads typed text into changes; changes nothing. */
  onRead: (text: string) => Promise<{ ok: true; items: ChangeItem[] } | { ok: false; message: string }>;
  /** Applies the confirmed list. */
  onApply: (items: ChangeItem[]) => Promise<boolean>;
  /** Withdraws a report ("it's not going to rain after all"). */
  onRemove: (reportId: string) => void;
}) {
  const b = event.brief;
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ChangeItem[]>([]);
  const [open, setOpen] = useState<"time" | "group" | "equipment" | null>(null);
  const [earliest, setEarliest] = useState(b.start_window.earliest);
  const [latest, setLatest] = useState(b.start_window.latest);
  const [group, setGroup] = useState(String(b.group_size));
  const [missing, setMissing] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<ChangeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = v.plan;
  if (!p) return null;
  const reports = (event.change_reports ?? []).filter((r) => r.id && (r.check_id || r.reply));
  const line = (i: ChangeItem) => changeLine(i, b, p, snapshot);

  const add = (item: ChangeItem) => {
    setPicked((list) => [...list.filter((x) => x.type !== item.type || (x.type === "report" && item.type === "report" && x.what !== item.what)), item]);
    setOpen(null);
    setError(null);
  };

  const tap = (s: Shortcut) => {
    setError(null);
    if (s.item) return add(s.item);
    setOpen(open === s.id ? null : s.id);
  };

  const addOpen = () => {
    if (open === "time") {
      if (earliest > latest) return setError("The earliest start must be before the latest");
      add({ type: "start_window", earliest, latest, said: "New time" });
    } else if (open === "group") {
      const n = Number(group);
      if (!Number.isInteger(n) || n < 1 || n > 500) return setError("Enter a whole number from 1 to 500");
      add({ type: "group_size", group_size: n, said: `${n} people` });
    } else if (open === "equipment") {
      if (missing.length === 0) return setError("Pick what's missing");
      add({ type: "equipment_missing", equipment: missing, said: "Equipment missing" });
    }
  };

  async function check() {
    setError(null);
    let items = picked;
    if (text.trim()) {
      setReading(true);
      const r = await onRead(text.trim());
      setReading(false);
      if (!r.ok) return setError(r.message);
      items = [...picked, ...r.items];
    }
    if (items.length === 0) return setError("Say what changed, or tap one of the options");
    setPreview(items);
  }

  async function apply() {
    if (!preview) return;
    if (await onApply(preview)) {
      setPreview(null);
      setPicked([]);
      setText("");
    }
  }

  return (
    <section className="clay rounded-surface bg-cream p-6 sm:p-8">
      <h2 className="text-xl font-bold tracking-tight text-ink">Something changed?</h2>

      {reports.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="What you told FieldDay">
          {reports.map((r) => (
            <li key={r.id} className="text-sm text-ink">
              <span>You said &ldquo;{r.description}&rdquo;</span>
              {r.reply && <span className="block text-ink-2">{r.reply}</span>}
              <Button variant="ghost" className="px-0 py-1 text-xs" disabled={busy} onClick={() => onRemove(r.id!)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {preview ? (
        <div className="clay-recessed animate-enter mt-4 rounded-disclosure bg-ground p-5">
          <p className="text-sm font-bold text-ink">Here&apos;s what FieldDay understood</p>
          <ul className="mt-3 space-y-2">
            {preview.map((i, n) => {
              const l = line(i);
              return (
                <li key={n} className={`clay-sm flex items-start gap-3 rounded-disclosure px-4 py-3 text-sm text-ink ${l.note ? "bg-butter" : "bg-cream"}`}>
                  <span aria-hidden="true" className="text-lg leading-none">
                    {l.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{l.what}</span>
                    <span className="block text-ink-2">{l.then}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove: ${l.what}`}
                    disabled={busy}
                    onClick={() => setPreview((list) => list!.filter((_, k) => k !== n))}
                    className="focus-ring rounded-control px-2 text-ink-2 hover:text-ink"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          {preview.length === 0 && <p className="mt-2 text-sm text-ink-2">Nothing left to change.</p>}
          {event.finalized && preview.some((i) => i.type !== "note") && (
            <p className="mt-3 text-xs text-ink-2">Your locked-in plan stays saved until you lock in a new one.</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || preview.length === 0} onClick={apply}>
              {busy ? "Working…" : applyLabel(preview)}
            </Button>
            {!busy && (
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Back
              </Button>
            )}
          </div>
          {busy && (
            <p role="status" className="mt-3 text-sm font-bold text-ink">
              FieldDay is working on it. This can take about a minute.
            </p>
          )}
        </div>
      ) : (
        <>
          <label htmlFor="change-text" className="mt-4 mb-2 block text-sm text-ink-2">
            Say what changed, as many things as you like.
          </label>
          <textarea
            id="change-text"
            rows={3}
            value={text}
            maxLength={1000}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder="300 people are coming, and the instructor can't start until 9"
            className={fieldClass(error, true)}
          />

          <p className="mt-4 text-xs font-bold tracking-wide text-ink-2 uppercase">Or tap</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Common changes">
            {SHORTCUTS.map((s) => {
              const on = s.id === open || picked.some((i) => isFrom(s, i));
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => tap(s)}
                  className={`focus-ring rounded-control px-4 py-2 text-sm font-bold text-ink disabled:opacity-55 ${on ? "clay-recessed bg-mint" : "clay-sm bg-cream"}`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {open && (
            <div className="clay-recessed animate-enter mt-3 flex flex-wrap items-end gap-3 rounded-disclosure bg-ground p-4">
              {open === "time" && (
                <>
                  <TimeField id="change-earliest" label="Earliest start" value={earliest} onChange={setEarliest} />
                  <TimeField id="change-latest" label="Latest start" value={latest} onChange={setLatest} />
                </>
              )}
              {open === "group" && (
                <div>
                  <label htmlFor="change-group" className="mb-1 block text-sm font-bold text-ink">
                    How many people now?
                  </label>
                  <input
                    id="change-group"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={500}
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    className={`${fieldClass(error)} max-w-32`}
                  />
                </div>
              )}
              {open === "equipment" &&
                (b.equipment_available.length === 0 ? (
                  <p className="text-sm text-ink">Your brief lists no equipment, so nothing can go missing.</p>
                ) : (
                  <fieldset>
                    <legend className="mb-1 text-sm font-bold text-ink">What&apos;s missing?</legend>
                    <div className="flex flex-wrap gap-2">
                      {b.equipment_available.map((e) => (
                        <label key={e} className="clay-sm flex cursor-pointer items-center gap-2 rounded-control bg-cream px-3 py-1.5 text-sm has-[:checked]:clay-recessed has-[:checked]:bg-mint">
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
                ))}
              {!(open === "equipment" && b.equipment_available.length === 0) && (
                <Button variant="secondary" onClick={addOpen}>
                  Add
                </Button>
              )}
            </div>
          )}

          {picked.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Changes you picked">
              {picked.map((i, n) => (
                <li key={n} className="clay-sm flex items-center gap-2 rounded-control bg-mint px-3 py-1.5 text-sm text-ink">
                  <span aria-hidden="true">{line(i).icon}</span>
                  {line(i).what}
                  <button
                    type="button"
                    aria-label={`Remove: ${line(i).what}`}
                    onClick={() => setPicked((list) => list.filter((_, k) => k !== n))}
                    className="focus-ring rounded-control px-1 text-ink-2 hover:text-ink"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="mt-3 text-sm font-bold text-danger-ink">{error}</p>}
          <Button variant="primary" className="mt-4" disabled={busy || reading} onClick={check}>
            {reading ? "Reading…" : "Check these changes"}
          </Button>
          <p className="mt-2 text-xs text-ink-2">Nothing changes until you confirm.</p>
        </>
      )}
    </section>
  );
}

const SHORTCUT_TYPE = { time: "start_window", group: "group_size", equipment: "equipment_missing" } as const;

/** Whether a picked change came from this shortcut, so the shortcut shows as on. */
function isFrom(s: Shortcut, i: ChangeItem): boolean {
  if (s.item) return s.item.type === "report" && i.type === "report" && i.what === s.item.what;
  return SHORTCUT_TYPE[s.id as keyof typeof SHORTCUT_TYPE] === i.type;
}

function TimeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-bold text-ink">
        {label}
      </label>
      <input id={id} type="time" step={900} value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldClass()} max-w-40`} />
    </div>
  );
}
