"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { z } from "zod";
import { Api, type EventBrief, type EvidenceSnapshot, type FieldDayEvent, type GateCheck } from "@/contracts";
import { apiGet, apiSend, type ApiResult } from "../api-client";
import { describeError, type ApiFailure } from "../errors";
import { AUTODRAFT_KEY } from "../BriefForm";
import { todayInNewYork } from "../format";
import { Alert, Button, buttonClass } from "../ui";
import { SuggestedFix } from "./Alternatives";
import { ConfirmPanel } from "./ApprovalFlow";
import { SomethingChanged } from "./Disruptions";
import { availableActions, confirmItems, currentVersion, finalizeKey, problemLines } from "./logic";
import { PlanSummary } from "./NextStep";
import { nextStep, type NextStep } from "./next-step";
import { HowWeChecked, SessionOutline } from "./sections";

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
  const [gate, setGate] = useState<GateCheck[] | null>(null);
  // Next keeps pages you left mounted but hidden; scroll targets are looked up inside this page only.
  const rootRef = useRef<HTMLDivElement>(null);
  const today = useSyncExternalStore(noSubscribe, todayInNewYork, () => null);
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

  // A brief that was just saved with no plan gets drafted right away, instead of waiting for a click.
  const waitingToDraft = data !== null && !currentVersion(data.event).plan && data.event.last_run === null;
  useEffect(() => {
    if (!waitingToDraft || busy) return;
    let flagged = false;
    try {
      flagged = sessionStorage.getItem(AUTODRAFT_KEY) === eventId;
      if (flagged) sessionStorage.removeItem(AUTODRAFT_KEY);
    } catch {
      // Storage can be blocked; the organizer then clicks "Draft a plan".
    }
    if (flagged) void act("Drafting a plan", "generate", { version: currentVersion(data!.event).version }, Api.generateDraft.response);
    // act is recreated every render; this runs once when the page first has a plan-less event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingToDraft, eventId]);

  /** Runs one action against the current version, then reloads so the snapshot stays in sync. */
  async function act<S extends z.ZodType>(
    label: string,
    path: string,
    body: object,
    schema: S,
  ): Promise<ApiResult<z.infer<S>>> {
    setBusy(label);
    setActionError(null);
    const r = await apiSend("POST", `${base}/${path}`, body, schema);
    if (r.ok) {
      setGate(null);
      await load();
    } else {
      setActionError({ label, error: r });
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
  const items = actions.confirm ? confirmItems(v, snapshot, event.brief.group_size) : [];
  // The last failed lock-in survives a reload (F-18) until the plan changes.
  const shownGate = gate ?? (v.status === "approved" && event.last_gate?.version === v.version ? event.last_gate.gate : null);
  const demoOnly = event.finalized?.version === v.version && event.finalized.demo_only === true;
  const step = nextStep(v, shownGate, event.last_run, { confirm: items, today, demoOnly });

  const draftPlan = () => act("Drafting a plan", "generate", version, Api.generateDraft.response);
  const recheck = () => act("Checking the latest weather", "recheck", version, Api.recheck.response);
  const findAlternatives = () => act("Finding alternatives", "review", version, Api.requestReview.response);
  const approve = () =>
    act("Approving", "approve", { ...version, evidence_snapshot_id: v.evidence_snapshot_id }, Api.approve.response);
  /** One click for the usual path: approve this exact version, then run the final save gate. */
  const approveAndLock = async () => {
    const r = await approve();
    if (r.ok) await lockIn();
  };
  const lockIn = async () => {
    const r = await act(
      "Locking it in",
      "finalize",
      { ...version, idempotency_key: finalizeKey(event.id, v.version) },
      Api.finalize.response,
    );
    if (r.ok && !r.data.finalized) setGate(r.data.gate);
  };

  /** Scrolls to a section of this page, without animation for people who prefer reduced motion. */
  const scrollTo = (id: string) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rootRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
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
      case "approve_and_lock":
        return approveAndLock();
      case "finalize":
        return lockIn();
      case "edit":
        return router.push(`/events/${encodeURIComponent(event.id)}/brief`);
      case "alternatives":
        return scrollTo("alternatives");
      case "confirm":
        return scrollTo(s.checkId ? `confirm-${s.checkId.replace(".", "-")}` : "confirm-checks");
    }
  };

  /**
   * Equipment and group-size changes edit the brief, then draft again straight away, so "Something
   * changed?" is one click whatever the change is.
   */
  const editAndReplan = async (patch: Partial<EventBrief>): Promise<boolean> => {
    setBusy("Finding a fix");
    setActionError(null);
    const edited = await apiSend(
      "PUT",
      `${base}/brief`,
      { brief: { ...event.brief, ...patch }, based_on_version: v.version },
      Api.updateBrief.response,
    );
    const drafted = edited.ok
      ? await apiSend("POST", `${base}/generate`, { version: edited.data.event.current_version }, Api.generateDraft.response)
      : edited;
    if (!drafted.ok) setActionError({ label: "Finding a fix", error: drafted });
    setGate(null);
    await load();
    setBusy(null);
    return drafted.ok;
  };

  const date = new Date(`${event.brief.date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div ref={rootRef} data-workspace className="animate-enter space-y-5 pb-28 md:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-ink-2">
            {date} · {event.brief.group_size} people
          </p>
          <h1 className="mt-1 text-[40px] leading-[1.05] font-bold tracking-[-0.03em] text-ink sm:text-5xl">{event.brief.title}</h1>
        </div>
        <Link href={`/events/${encodeURIComponent(event.id)}/brief`} className={buttonClass("secondary")}>
          Edit
        </Link>
      </div>

      <PlanSummary
        event={event}
        version={v}
        snapshot={snapshot}
        step={step}
        busy={busy}
        onAction={() => runStep(step)}
        problems={problemLines(v, snapshot)}
        fix={
          step.action === "alternatives" ? (
            <SuggestedFix
              version={v}
              snapshot={snapshot}
              busy={!!busy}
              canApply={actions.applyOption}
              onApply={(o) =>
                act("Switching to this plan", "apply-option", { ...version, combined_option_id: o.combined_option_id }, Api.applyOption.response)
              }
            />
          ) : undefined
        }
        footer={
          v.plan && !busy ? (
            <>
              {actions.recheck && (
                <Button variant="ghost" className="px-0" onClick={recheck}>
                  Check the weather again
                </Button>
              )}
              <Button variant="ghost" className="px-0" onClick={draftPlan}>
                Start over with a new plan
              </Button>
            </>
          ) : undefined
        }
      />

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
            ? "FieldDay ran out of time before it finished, so nothing from that run was saved."
            : "Something went wrong during the run, so nothing from it was saved."}{" "}
          Your plan is unchanged.
        </Alert>
      )}

      <ConfirmPanel
        items={items}
        busy={!!busy}
        onConfirm={(item, statement) =>
          act(
            "Saving your confirmation",
            "confirmations",
            { ...version, check_id: item.check_id, park_id: item.park_id, start_time: item.start_time, statement, note: null },
            Api.addConfirmation.response,
          )
        }
      />

      <SomethingChanged
        event={event}
        version={v}
        snapshot={snapshot}
        busy={!!busy}
        onReport={async (change) => (await act("Finding a fix", "changes", { ...version, change }, Api.reportChange.response)).ok}
        onEditBrief={editAndReplan}
      />

      <div className="space-y-3">
        <HowWeChecked checks={v.checks} snapshot={snapshot} />
        <SessionOutline version={v} snapshot={snapshot} />
      </div>
    </div>
  );
}

const noSubscribe = () => () => {};

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
