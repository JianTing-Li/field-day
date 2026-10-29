"use client";

import { useState } from "react";
import {
  isConfirmableCheck,
  type CandidatePlan,
  type CheckId,
  type EvidenceSnapshot,
  type FieldDayEvent,
  type GateCheck,
  type OrganizerTask,
  type PlanVersion,
} from "@/contracts";
import { formatUpdated } from "../format";
import { Alert, Button, Card, fieldClass } from "../ui";
import { approveBlockedReason, checkName, formatLocal, parkName, type ConfirmItem } from "./logic";

/** Confirmations, approve and finalize (task YT-11). */

const GATE_NAMES: Record<GateCheck["id"], string> = {
  complete_inputs: "The plan is complete",
  correct_version: "This exact version and evidence were approved",
  current_evidence: "Evidence is still current",
  hard_constraints: "Every critical check passes",
  required_confirmations: "Required confirmations are recorded",
};

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

export function ConfirmationsList({ event, snapshot }: { event: FieldDayEvent; snapshot: EvidenceSnapshot | null }) {
  if (event.confirmations.length === 0) return null;
  return (
    <Card title="Your confirmations" description="Each one resolves a single check at one park (and time).">
      <ul className="space-y-2">
        {event.confirmations.map((c) => (
          <li key={c.id} className="clay-sm rounded-disclosure bg-mint px-5 py-3 text-sm">
            <p className="text-ink">
              <span aria-hidden="true">✓ </span>
              {c.statement}
            </p>
            <p className="mt-0.5 text-xs text-ink-2">
              {checkName(c.check_id)} · {parkName(snapshot, c.park_id)} · {c.start_time ? formatLocal(c.start_time) : "any time"} ·{" "}
              {c.confirmed_by}, {formatUpdated(c.confirmed_at)}
              {c.note && ` · ${c.note}`}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ApprovalPanel({
  event,
  version: v,
  busy,
  gate,
  blockedDetails,
  onApprove,
  onFinalize,
}: {
  event: FieldDayEvent;
  version: PlanVersion;
  busy: boolean;
  /** Gate results from the last finalize attempt in this session, if any. */
  gate: GateCheck[] | null;
  /** Check IDs the API said are blocking, from the last failed approve. */
  blockedDetails: CheckId[];
  onApprove: () => void;
  onFinalize: () => void;
}) {
  const approved = v.status === "approved" && event.approval?.version === v.version;
  const finalizedHere = event.finalized?.version === v.version;
  const blocked = approveBlockedReason(v);
  const shownGate = finalizedHere ? event.finalized!.gate : gate;

  return (
    <Card
      title="Approve and lock in"
      description="Two steps: approve when you're happy with the plan, then lock it in to run the final safety checks and save it. Any change after approving clears the approval. Nothing is booked or sent."
    >
      <ol className="space-y-4">
        <li className="flex gap-3">
          <Step n={1} done={approved || finalizedHere} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">Approve this plan</p>
            {approved || finalizedHere ? (
              <p className="text-sm text-ink">
                Approved {event.approval ? formatUpdated(event.approval.approved_at) : ""}.
              </p>
            ) : (
              <>
                {blocked && <p className="text-sm text-ink-2">{blocked}</p>}
                {blockedDetails.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                    {blockedDetails.map((id) => (
                      <li key={id}>{checkName(id)}</li>
                    ))}
                  </ul>
                )}
                <Button
                  variant="primary"
                  className="mt-2"
                  disabled={busy || blocked !== null || !v.evidence_snapshot_id}
                  onClick={onApprove}
                >
                  Approve plan
                </Button>
              </>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} done={finalizedHere} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">Lock it in</p>
            {finalizedHere ? (
              <p className="text-sm text-ink">
                🔒 Locked in {formatUpdated(event.finalized!.finalized_at)}. This is your final plan, saved once:
                trying again never creates a duplicate.
              </p>
            ) : (
              <>
                <p className="text-sm text-ink-2">
                  {approved
                    ? "Runs the final safety checks and saves this as your final plan. Nothing is booked or sent."
                    : "Available after you approve."}
                </p>
                <Button variant="primary" className="mt-2" disabled={busy || !approved} onClick={onFinalize}>
                  Lock it in
                </Button>
              </>
            )}
            {event.finalized && !finalizedHere && (
              <p className="mt-2 text-sm text-ink-2">
                An earlier version is still your locked-in plan until you lock in this one.
              </p>
            )}
          </div>
        </li>
      </ol>

      {shownGate && (
        <div className="mt-5">
          {!finalizedHere && (
            <Alert tone="danger" role="alert" title="Not locked in: these final checks didn't pass." />
          )}
          <ul className="mt-3 space-y-1.5">
            {shownGate.map((g) => (
              <li key={g.id} className="flex gap-2 text-sm">
                <span aria-hidden="true" className={g.status === "pass" ? "text-ink" : "text-ink"}>
                  {g.status === "pass" ? "✓" : "✕"}
                </span>
                <span>
                  <span className="sr-only">{g.status === "pass" ? "Passed: " : "Failed: "}</span>
                  <span className="font-bold text-ink">{GATE_NAMES[g.id]}</span>
                  <span className="text-ink-2"> · {g.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Step({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-ink ${
        done ? "clay-sm bg-mint" : "clay-recessed bg-lavender"
      }`}
    >
      {done ? "✓" : n}
    </span>
  );
}
