"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import { Api, ChangeReport, CheckId, type EvidenceSnapshot, type FieldDayEvent, type GateCheck } from "@/contracts";
import { apiGet, apiSend, type ApiResult } from "../api-client";
import { describeError, type ApiFailure } from "../errors";
import { startWindowText } from "../format";
import { Alert, Button, buttonClass, Card, fieldClass } from "../ui";
import { Alternatives } from "./Alternatives";
import { aboutCurrentPlan, ApprovalPanel, ConfirmationsList, ConfirmTaskForm, confirmable } from "./ApprovalFlow";
import { availableActions, currentVersion, finalizeKey } from "./logic";
import { PlanSummary } from "./NextStep";
import { nextStep, type NextStep } from "./next-step";
import { BlockersCard, ChecksList, EvidenceList, PlanCard, TechnicalDetails } from "./sections";

/** Event workspace (GET /api/events/:id). Owner: Yadan, tasks YT-09 to YT-12. */

type Loaded = { event: FieldDayEvent; snapshot: EvidenceSnapshot | null };

export function Workspace({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [reloading, setReloading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    label: string;
    error: ApiFailure;
  } | null>(null);
  const [showChange, setShowChange] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [gate, setGate] = useState<GateCheck[] | null>(null);
  const [blockedDetails, setBlockedDetails] = useState<CheckId[]>([]);
  const router = useRouter();
  const base = `/api/events/${encodeURIComponent(eventId)}`;

  const load = useCallback(async () => {
    setReloading(true);
    const r = await apiGet(base, Api.getEvent.response);
    setReloading(false);
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else {
      setLoadError(r);
    }
    return r.ok;
  }, [base]);

  useEffect(() => {
    let live = true;
    apiGet(base, Api.getEvent.response).then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data);
      else setLoadError(r);
    });
    return () => {
      live = false;
    };
  }, [base]);

  /** Runs one action against the current version, then reloads so the snapshot stays in sync. */
  async function act<S extends z.ZodType>(
    label: string,
    path: string,
    body: object,
    schema: S,
  ): Promise<ApiResult<z.infer<S>>> {
    setBusy(label);
    setActionError(null);
    setBlockedDetails([]);
    const r = await apiSend("POST", `${base}/${path}`, body, schema);
    if (r.ok) {
      setGate(null);
      await load();
    } else {
      setActionError({ label, error: r });
      const ids = CheckId.array().safeParse(r.details);
      if (r.code === "blocked" && ids.success) setBlockedDetails(ids.data);
    }
    setBusy(null);
    return r;
  }

  if (loadError && !data) {
    const view = describeError(loadError, "Loading this event");
    return (
      <Alert tone={view.tone} role="alert" title={view.title}>
        <p>{loadError.code === "not_found" ? view.body : "The event could not be loaded."}</p>
        <div className="mt-3 flex gap-2">
          {loadError.code !== "not_found" && (
            <Button variant="danger" onClick={load} disabled={reloading}>
              {reloading ? "Trying…" : "Try again"}
            </Button>
          )}
          <Link href="/" className={buttonClass("ghost")}>
            Back to events
          </Link>
        </div>
      </Alert>
    );
  }
  if (!data) return <WorkspaceSkeleton />;

  const { event, snapshot } = data;
  const v = currentVersion(event);
  const actions = availableActions(v);
  const version = { version: v.version };
  const step = nextStep(v, gate, event.last_run);

  const draftPlan = () => act("Drafting a plan", "generate", version, Api.generateDraft.response);
  const recheck = () => act("Checking the latest weather", "recheck", version, Api.recheck.response);
  const findAlternatives = () => act("Finding alternatives", "review", version, Api.requestReview.response);
  const approve = () =>
    act("Approving", "approve", { ...version, evidence_snapshot_id: v.evidence_snapshot_id }, Api.approve.response);
  const lockIn = async () => {
    const r = await act(
      "Locking it in",
      "finalize",
      { ...version, idempotency_key: finalizeKey(event.id, v.version) },
      Api.finalize.response,
    );
    if (r.ok && !r.data.finalized) setGate(r.data.gate);
  };

  /** Runs the next step's action, or takes the organizer to the part of the page that needs them. */
  const runStep = (s: NextStep) => {
    switch (s.action) {
      case "generate":
        return draftPlan();
      case "recheck":
        return recheck();
      case "review":
        return findAlternatives();
      case "approve":
        return approve();
      case "finalize":
        return lockIn();
      case "edit":
        return router.push(`/events/${encodeURIComponent(event.id)}/brief`);
      case "alternatives":
        return scrollTo("alternatives");
      case "confirm":
        if (s.taskId) {
          setConfirming(s.taskId);
          requestAnimationFrame(() => scrollTo(`task-${s.taskId}`));
        }
        return;
    }
  };

  return (
    <div className="space-y-5 pb-28 md:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[40px] leading-[1.05] font-bold tracking-[-0.03em] text-ink sm:text-5xl">{event.brief.title}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {event.brief.group_size} people · {event.brief.duration_minutes} minutes ·{" "}
            {startWindowText(event.brief.start_window.earliest, event.brief.start_window.latest)}
          </p>
        </div>
        <Link href={`/events/${encodeURIComponent(event.id)}/brief`} className={buttonClass("secondary")}>
          Edit brief
        </Link>
      </div>

      <PlanSummary event={event} version={v} snapshot={snapshot} step={step} busy={busy} onAction={() => runStep(step)} />

      {actionError && (
        <ActionErrorBanner
          {...actionError}
          reloading={reloading}
          onReload={async () => {
            if (await load()) setActionError(null);
          }}
        />
      )}

      {loadError && (
        <Alert tone="warning" role="alert" title="Couldn't refresh this event">
          Showing what was loaded before. {describeError(loadError).body}
        </Alert>
      )}

      {v.plan && event.last_run && (event.last_run.status === "failed" || event.last_run.status === "budget_exhausted") && (
        <Alert tone="warning" role="status" title="The last run didn't finish">
          {event.last_run.status === "budget_exhausted"
            ? "The agents hit their time or call limit, so nothing from that run was saved."
            : "Something went wrong during the run, so nothing from it was saved."}{" "}
          Your plan below is unchanged.
        </Alert>
      )}

      {v.evidence_snapshot_id && !snapshot && (
        <Alert tone="warning" role="status" title="The sources for this plan couldn't be loaded">
          The checks below may be out of date. Use &ldquo;Check the latest weather&rdquo; to fetch fresh data before
          approving.
        </Alert>
      )}

      <BlockersCard
        version={v}
        snapshot={snapshot}
        taskAction={(t) =>
          actions.confirm && confirmable(t) && !aboutCurrentPlan(t, v.plan) ? (
            <p className="mt-2 text-xs font-bold text-ink-2">
              This is about a different park or time than the current plan. Confirm it after you choose an option
              there; a confirmation only counts for the plan it was made for.
            </p>
          ) : actions.confirm && confirmable(t) ? (
            confirming === t.id ? (
              <ConfirmTaskForm
                task={t}
                snapshot={snapshot}
                busy={!!busy}
                onCancel={() => setConfirming(null)}
                onSubmit={async (c) => {
                  const r = await act(
                    "Saving your confirmation",
                    "confirmations",
                    { ...version, ...c },
                    Api.addConfirmation.response,
                  );
                  if (r.ok) setConfirming(null);
                }}
              />
            ) : (
              <Button className="mt-2" disabled={!!busy} onClick={() => setConfirming(t.id)}>
                Confirm
              </Button>
            )
          ) : null
        }
      />
      <Card
        title="More actions"
        description={
          <span aria-live="polite">
            {busy ? `${busy}… this can take a minute.` : "Change the plan or check it again."}
          </span>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant={v.plan ? "secondary" : "primary"}
            disabled={!!busy}
            onClick={draftPlan}
          >
            {v.plan ? "Draft a new plan" : "Draft a plan"}
          </Button>
          {actions.recheck && (
            <Button disabled={!!busy} onClick={recheck}>
              Check the latest weather
            </Button>
          )}
          {actions.reportChange && (
            <Button disabled={!!busy} onClick={() => setShowChange((s) => !s)} aria-expanded={showChange}>
              Report a problem
            </Button>
          )}
          {actions.requestReview && (
            <Button
              disabled={!!busy}
              onClick={findAlternatives}
            >
              Find alternatives
            </Button>
          )}
        </div>
        {showChange && (
          <ChangeForm
            disabled={!!busy}
            onCancel={() => setShowChange(false)}
            onSubmit={async (change) => {
              const r = await act("Reporting a problem", "changes", { ...version, change }, Api.reportChange.response);
              if (r.ok) setShowChange(false);
            }}
          />
        )}
      </Card>

      <ConfirmationsList event={event} snapshot={snapshot} />
      <Alternatives
        version={v}
        snapshot={snapshot}
        busy={!!busy}
        canApply={actions.applyOption}
        onApply={(o) =>
          act(
            "Switching to this option",
            "apply-option",
            { ...version, combined_option_id: o.combined_option_id },
            Api.applyOption.response,
          )
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <PlanCard version={v} snapshot={snapshot} />
        <ChecksList checks={v.checks} snapshot={snapshot} />
      </div>
      <ApprovalPanel
        event={event}
        version={v}
        busy={!!busy}
        gate={gate}
        blockedDetails={blockedDetails}
        onApprove={approve}
        onFinalize={lockIn}
      />
      <EvidenceList snapshot={snapshot} />
      <TechnicalDetails event={event} version={v} />
    </div>
  );
}

/** Scrolls to a section, without animation for people who prefer reduced motion. */
function scrollTo(id: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

function ActionErrorBanner({
  label,
  error,
  reloading,
  onReload,
}: {
  label: string;
  error: ApiFailure;
  reloading: boolean;
  onReload: () => void;
}) {
  const view = describeError(error, label);
  return (
    <Alert tone={view.tone} role="alert" title={view.title}>
      <p>{view.body}</p>
      {view.reload && (
        <Button variant="primary" className="mt-3" onClick={onReload} disabled={reloading}>
          {reloading ? "Reloading…" : "Reload the latest version"}
        </Button>
      )}
    </Alert>
  );
}

const CHANGE_KINDS: { value: ChangeReport["kind"]; label: string }[] = [
  { value: "time_unavailable", label: "The time doesn't work anymore" },
  { value: "park_issue", label: "Problem at the park" },
  { value: "workout_issue", label: "Problem with the workout" },
  { value: "conditions", label: "Weather or air quality changed" },
  { value: "other", label: "Something else" },
];

function ChangeForm({
  disabled,
  onSubmit,
  onCancel,
}: {
  disabled: boolean;
  onSubmit: (c: ChangeReport) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<ChangeReport["kind"]>("park_issue");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="clay-recessed mt-5 space-y-4 rounded-surface bg-lavender/50 p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = ChangeReport.safeParse({
          kind,
          description: description.trim(),
        });
        if (!parsed.success) return setError("Describe what changed");
        onSubmit(parsed.data);
      }}
    >
      <p className="text-sm text-ink-2">
        FieldDay will ask its specialists for alternatives. Your current plan stays as it is until you pick one.
      </p>
      <div>
        <label htmlFor="change-kind" className="mb-2 block text-sm font-bold text-ink">
          What changed?
        </label>
        <select
          id="change-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as ChangeReport["kind"])}
          className={fieldClass()}
        >
          {CHANGE_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="change-description" className="mb-2 block text-sm font-bold text-ink">
          Details
        </label>
        <textarea
          id="change-description"
          rows={2}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setError(null);
          }}
          placeholder="e.g. The running lane at the park is closed for repairs"
          aria-invalid={!!error}
          aria-describedby={error ? "change-error" : undefined}
          className={fieldClass(error, true)}
        />
        {error && (
          <p id="change-error" className="mt-1.5 text-sm font-bold text-danger-ink">
            {error}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={disabled}>
          Find alternatives
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function WorkspaceSkeleton() {
  return (
    <div role="status" aria-label="Loading the event" className="animate-pulse space-y-5">
      <div className="h-12 w-2/3 rounded-control bg-lavender" />
      <div className="h-14 rounded-control bg-cream" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-56 rounded-surface bg-cream" />
        <div className="h-56 rounded-surface bg-cream" />
      </div>
    </div>
  );
}
