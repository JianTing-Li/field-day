import { useEffect, useState, type ReactNode } from "react";
import type { EvidenceSnapshot, FieldDayEvent, PlanVersion } from "@/contracts";
import { StatusBadge } from "../StatusBadge";
import { formatUpdated } from "../format";
import { Button, TONE_BG } from "../ui";
import { conditionsLine, formatLocal, parkName, templateName } from "./logic";
import type { NextStep } from "./next-step";

/**
 * The top of the event page (owner: Yadan): what the plan is, where it stands, and the one thing to
 * do next. On phones the same action also sits in a bar fixed to the bottom of the screen.
 */
export function PlanSummary({
  event,
  version: v,
  snapshot,
  step,
  busy,
  onAction,
  problems = [],
  fix,
  footer,
}: {
  event: FieldDayEvent;
  version: PlanVersion;
  snapshot: EvidenceSnapshot | null;
  step: NextStep;
  busy: string | null;
  onAction: () => void;
  /** What's wrong with this plan, in plain lines (JT-24): shown here, not behind another click. */
  problems?: string[];
  /** The suggested fix; shown instead of the next-step box when there is one. */
  fix?: ReactNode;
  /** Small secondary actions under the card. */
  footer?: ReactNode;
}) {
  const p = v.plan;
  const lockedOlder = event.finalized && event.finalized.version !== v.version;
  return (
    <>
      <section aria-labelledby="plan-summary" className="clay rounded-surface bg-cream p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={v.status} />
          <span className="text-xs text-ink-2">Updated {formatUpdated(event.updated_at)}</span>
        </div>
        <h2 id="plan-summary" className="mt-4 text-2xl leading-tight font-bold tracking-tight text-ink sm:text-3xl">
          {p ? (
            <>
              {parkName(snapshot, p.park_id)} · {formatLocal(p.start_time)}
            </>
          ) : (
            "No plan yet"
          )}
        </h2>
        {p && (
          <p className="mt-1 text-base text-ink-2">
            {templateName(snapshot, p.workout_template_id)}
            {p.adaptation_ids.length > 0 && " (adapted)"} · {event.brief.group_size} people
            {p.duration_minutes && ` · ${p.duration_minutes} min`}
          </p>
        )}
        {p && (
          <p className="mt-2 text-sm font-bold text-ink">
            <span aria-hidden="true">☀ </span>
            {conditionsLine(snapshot, p) ?? "No forecast for this time yet"}
            {snapshot?.origin === "fixture" && <span className="font-normal text-ink-2"> · recorded demo data</span>}
          </p>
        )}
        {problems.length > 0 && (
          <div className="clay-sm animate-enter mt-5 rounded-disclosure bg-danger px-5 py-4 text-sm text-ink">
            <p className="font-bold">This plan won&apos;t work as it is</p>
            <ul className="mt-1 space-y-0.5">
              {problems.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {lockedOlder && (
          <p className="mt-2 text-sm font-bold text-ink">
            🔒 Your earlier locked-in plan is still saved. This new plan isn&apos;t locked in yet.
          </p>
        )}

        {/* The step box is keyed by the step, so a new next step eases in and the change is noticed. */}
        {fix && !busy ? (
          fix
        ) : (
          <div
            key={step.title}
            className={`clay-sm animate-enter mt-6 rounded-disclosure p-5 transition-colors ${TONE_BG[step.tone === "danger" ? "danger" : step.tone]}`}
          >
            <p className="text-xs font-bold tracking-wide text-ink uppercase">Next step</p>
            <p className="mt-1 text-lg leading-snug font-bold text-ink">{step.title}</p>
            <p className="mt-1 text-sm text-ink">{step.body}</p>
            {busy ? (
              <Working label={busy} />
            ) : (
              step.action &&
              step.label && (
                <Button variant="surface" className="mt-4 px-6 py-3 text-base" onClick={onAction}>
                  {step.label}
                </Button>
              )
            )}
          </div>
        )}
        {footer && <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">{footer}</div>}
      </section>

      {step.action && step.label && !fix && (
        <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-3 md:hidden">
          <div className="clay flex items-center gap-3 rounded-surface bg-cream px-4 py-3">
            <p className="min-w-0 flex-1 text-sm leading-snug font-bold text-ink">{step.title}</p>
            <Button variant="primary" className="shrink-0" disabled={!!busy} onClick={onAction}>
              {busy ? "Working…" : step.label}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** What each slow action is doing and how long it usually takes. */
const WORK: Record<string, string> = {
  "Drafting a plan":
    "Reading the weather and air quality, picking a park, time and workout, and running the safety checks. Usually 20 to 90 seconds.",
  "Finding alternatives":
    "Looking for other times, parks and workouts, then comparing them. Usually 1 to 4 minutes.",
  "Reporting a problem":
    "Looking for other times, parks and workouts that fix it, then comparing them. Usually 1 to 4 minutes.",
  "Checking the latest weather": "Fetching the latest forecast and air quality and checking the plan again.",
  "Locking it in": "Running the final safety checks and saving your plan.",
  "Finding a fix":
    "Checking the plan again with what changed, then looking for other times, parks and workouts. Usually 1 to 4 minutes.",
  "Switching to this plan": "Checking the new park, time and workout.",
};

/** Shows that FieldDay is working, for how long, and what it's doing, so nobody clicks twice. */
function Working({ label }: { label: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [label]);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div role="status" aria-live="polite" className="clay-recessed animate-enter mt-4 rounded-disclosure bg-cream px-4 py-3 text-sm text-ink">
      <p className="font-bold">
        <span aria-hidden="true" className="mr-2 inline-block animate-spin motion-reduce:animate-none">
          ◐
        </span>
        {label}… <span className="font-mono font-normal text-ink-2">{clock}</span>
      </p>
      {WORK[label] && <p className="mt-1 text-ink-2">{WORK[label]} You can keep this page open.</p>}
    </div>
  );
}
