"use client";

import { useState } from "react";
import type { CandidatePlan, CheckId, EvidenceSnapshot, FieldDayEvent, GateCheck, OrganizerTask, PlanVersion } from "@/contracts";
import { formatUpdated } from "../format";
import { Alert, Button, Card, fieldClass } from "../ui";
import { approveBlockedReason, checkName, formatLocal, parkName } from "./logic";

/** Confirmations, approve and finalize (task YT-11). */

const GATE_NAMES: Record<GateCheck["id"], string> = {
  complete_inputs: "The plan is complete",
  correct_version: "This exact version and evidence were approved",
  current_evidence: "Evidence is still current",
  hard_constraints: "Every critical check passes",
  required_confirmations: "Required confirmations are recorded",
};

export interface ConfirmationInput {
  check_id: CheckId;
  park_id: string;
  start_time: string | null;
  statement: string;
  note: string | null;
}

/** Only tasks that name a check and a park can be confirmed; the confirmation applies there and nowhere else. */
export function confirmable(t: OrganizerTask): t is OrganizerTask & { resolves_check_id: CheckId; park_id: string } {
  return t.resolves_check_id !== null && t.park_id !== null;
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

export function ConfirmTaskForm({
  task,
  snapshot,
  busy,
  onSubmit,
  onCancel,
}: {
  task: OrganizerTask & { resolves_check_id: CheckId; park_id: string };
  snapshot: EvidenceSnapshot | null;
  busy: boolean;
  onSubmit: (c: ConfirmationInput) => void;
  onCancel: () => void;
}) {
  const [statement, setStatement] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = `confirm-${task.id}`;
  return (
    <form
      className="clay-recessed mt-3 space-y-4 rounded-disclosure bg-cream p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!statement.trim()) return setError("Say what you confirmed");
        onSubmit({
          check_id: task.resolves_check_id,
          park_id: task.park_id,
          start_time: task.start_time,
          statement: statement.trim(),
          note: note.trim() || null,
        });
      }}
    >
      <dl className="grid gap-2 text-xs text-ink-2 sm:grid-cols-3">
        <div>
          <dt className="font-bold uppercase tracking-wide text-ink-2">Check</dt>
          <dd className="text-sm text-ink">{checkName(task.resolves_check_id)}</dd>
        </div>
        <div>
          <dt className="font-bold uppercase tracking-wide text-ink-2">Park</dt>
          <dd className="text-sm text-ink">{parkName(snapshot, task.park_id)}</dd>
        </div>
        <div>
          <dt className="font-bold uppercase tracking-wide text-ink-2">Time</dt>
          <dd className="text-sm text-ink">{task.start_time ? formatLocal(task.start_time) : "Any time"}</dd>
        </div>
      </dl>
      <p className="text-xs text-ink-2">
        This confirmation counts only for this check, at this park{task.start_time ? " and time" : ""}. It never carries
        over to another park.
      </p>
      <div>
        <label htmlFor={`${id}-statement`} className="mb-2 block text-sm font-bold text-ink">
          What did you confirm?
        </label>
        <textarea
          id={`${id}-statement`}
          rows={2}
          value={statement}
          onChange={(e) => {
            setStatement(e.target.value);
            setError(null);
          }}
          placeholder="e.g. I walked the east lawn: open, flat grass for 18 people"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={fieldClass(error, true)}
        />
        {error && (
          <p id={`${id}-error`} className="mt-1.5 text-sm font-bold text-danger-ink">
            {error}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${id}-note`} className="mb-2 block text-sm font-bold text-ink">
          Note (optional)
        </label>
        <input
          id={`${id}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={fieldClass()}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Record confirmation
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
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
      title="Approve and finalize"
      description="Approval is for this exact version and its evidence. Any change afterwards clears it."
    >
      <ol className="space-y-4">
        <li className="flex gap-3">
          <Step n={1} done={approved || finalizedHere} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">
              Approve <span className="font-mono">v{v.version}</span>
              {v.evidence_snapshot_id && (
                <span className="font-normal text-ink-2">
                  {" "}
                  with evidence <span className="font-mono text-xs">{v.evidence_snapshot_id}</span>
                </span>
              )}
            </p>
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
                  Approve v{v.version}
                </Button>
              </>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} done={finalizedHere} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">
              Finalize <span className="font-mono">v{v.version}</span>
            </p>
            {finalizedHere ? (
              <p className="text-sm text-ink">
                🔒 Saved as the final event record {formatUpdated(event.finalized!.finalized_at)}. Finalizing again
                returns this same record; it is never saved twice.
              </p>
            ) : (
              <>
                <p className="text-sm text-ink-2">
                  {approved
                    ? "Runs the final save checks below. Nothing is booked, published or sent."
                    : "Available after approval."}
                </p>
                <Button variant="primary" className="mt-2" disabled={busy || !approved} onClick={onFinalize}>
                  Finalize v{v.version}
                </Button>
              </>
            )}
            {event.finalized && !finalizedHere && (
              <p className="mt-2 text-sm text-ink-2">
                v{event.finalized.version} is still the finalized record until this version is finalized.
              </p>
            )}
          </div>
        </li>
      </ol>

      {shownGate && (
        <div className="mt-5">
          {!finalizedHere && (
            <Alert tone="danger" role="alert" title="Not finalized: these save checks didn't pass." />
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
