"use client";

import { useState } from "react";
import { isConfirmableCheck, type CandidatePlan, type CheckId, type OrganizerTask } from "@/contracts";
import { Button, fieldClass } from "../ui";
import type { ConfirmItem } from "./logic";

/** Confirmations (task YT-11). Approving and locking in run from the next step (JT-24). */


/**
 * Only tasks that name a check and a park can be confirmed; the confirmation applies there and
 * nowhere else. And only space, surface and permit checks can be confirmed at all (D-JT24-1).
 */
export function confirmable(t: OrganizerTask): t is OrganizerTask & { resolves_check_id: CheckId; park_id: string } {
  return t.resolves_check_id !== null && t.park_id !== null && isConfirmableCheck(t.resolves_check_id);
}

/**
 * The things only the organizer can check at the park (F-15): one tap records the pre-filled
 * sentence; "Change the wording" lets them say exactly what they saw.
 */
export function ConfirmPanel({
  items,
  busy,
  onConfirm,
}: {
  items: ConfirmItem[];
  busy: boolean;
  onConfirm: (item: ConfirmItem, statement: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section id="confirm-checks" className="clay animate-enter scroll-mt-24 rounded-surface bg-butter p-6 sm:p-8">
      <h2 className="text-xl font-bold tracking-tight text-ink">Only you can check these</h2>
      <p className="mt-1 text-sm text-ink">
        FieldDay can&apos;t see the park. Once you&apos;ve checked, tap yes. It counts for this park and time only.
      </p>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          // Keyed by the sentence too: a new plan (other park or time) starts the row fresh.
          <ConfirmRow key={`${item.check_id}:${item.statement}`} item={item} busy={busy} onConfirm={onConfirm} />
        ))}
      </ul>
    </section>
  );
}

function ConfirmRow({
  item,
  busy,
  onConfirm,
}: {
  item: ConfirmItem;
  busy: boolean;
  onConfirm: (item: ConfirmItem, statement: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState(item.statement);
  const id = `confirm-${item.check_id.replace(".", "-")}`;
  return (
    <li id={id} className="clay-sm scroll-mt-24 rounded-disclosure bg-cream px-5 py-4 text-sm text-ink">
      <p className="font-bold">
        {item.question}
        {!item.required && <span className="ml-2 text-xs font-normal text-ink-2">(doesn&apos;t block approval)</span>}
      </p>
      {editing ? (
        <textarea
          id={`${id}-statement`}
          aria-label="What you checked"
          rows={2}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          className={`${fieldClass(undefined, true)} mt-2`}
        />
      ) : (
        <p className="mt-1 text-ink-2">“{statement}”</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || !statement.trim()} onClick={() => onConfirm(item, statement.trim())}>
          Yes, I checked
        </Button>
        {!editing && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Change the wording
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Whether a task is about the current plan's park and time. The harness only resolves a confirmation
 * for the plan it was given (D-JT22-1); one for another park or time is saved but changes nothing,
 * so the UI only offers Confirm for tasks about the current plan.
 */
export function aboutCurrentPlan(t: OrganizerTask, plan: CandidatePlan | null): boolean {
  if (!plan || t.park_id !== plan.park_id) return false;
  return t.start_time === null || t.start_time === plan.start_time;
}

