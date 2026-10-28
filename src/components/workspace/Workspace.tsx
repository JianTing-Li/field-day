"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import { Api, ChangeReport, type EvidenceSnapshot, type FieldDayEvent } from "@/contracts";
import { apiGet, apiSend, type ApiResult } from "../api-client";
import { Alert, Button, buttonClass, Card } from "../ui";
import { approveBlockedReason, availableActions, currentVersion } from "./logic";
import { BlockersCard, ChecksList, EvidenceList, PlanCard, StatusBar } from "./sections";

/** Event workspace (GET /api/events/:id). Owner: Yadan, task YT-09. */

type Loaded = { event: FieldDayEvent; snapshot: EvidenceSnapshot | null };

export function Workspace({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showChange, setShowChange] = useState(false);
  const base = `/api/events/${encodeURIComponent(eventId)}`;

  const load = useCallback(async () => {
    const r = await apiGet(base, Api.getEvent.response);
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else {
      setLoadError(r.message);
    }
  }, [base]);

  useEffect(() => {
    let live = true;
    apiGet(base, Api.getEvent.response).then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data);
      else setLoadError(r.message);
    });
    return () => {
      live = false;
    };
  }, [base]);

  /** Runs one action against the current version, then reloads so the snapshot stays in sync. */
  async function act<S extends z.ZodType>(label: string, path: string, body: object, schema: S): Promise<ApiResult<z.infer<S>>> {
    setBusy(label);
    setActionError(null);
    const r = await apiSend("POST", `${base}/${path}`, body, schema);
    if (r.ok) await load();
    else setActionError(`${label} didn't work: ${r.message}. Nothing was changed.`);
    setBusy(null);
    return r;
  }

  if (loadError && !data) {
    return (
      <Alert tone="danger" role="alert" title="This event could not be loaded.">
        <p>{loadError}.</p>
        <div className="mt-3 flex gap-2">
          <Button variant="danger" onClick={load}>
            Try again
          </Button>
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
  const blockedApprove = approveBlockedReason(v);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{event.brief.title}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {event.brief.group_size} people · {event.brief.duration_minutes} minutes · starts between{" "}
            {event.brief.start_window.earliest} and {event.brief.start_window.latest}
          </p>
        </div>
        <Link href={`/events/${encodeURIComponent(event.id)}/brief`} className={buttonClass("secondary")}>
          Edit brief
        </Link>
      </div>

      <StatusBar event={event} version={v} />

      {actionError && (
        <Alert tone="danger" role="alert">
          {actionError}
        </Alert>
      )}

      <Card title="Actions" description={busy ? `${busy}…` : "Each action works on the current version."}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={v.plan ? "secondary" : "primary"}
            disabled={!!busy}
            onClick={() => act("Generate plan", "generate", version, Api.generateDraft.response)}
          >
            {v.plan ? "Generate a new plan" : "Generate plan"}
          </Button>
          {actions.recheck && (
            <Button disabled={!!busy} onClick={() => act("Recheck", "recheck", version, Api.recheck.response)}>
              Recheck conditions
            </Button>
          )}
          {actions.reportChange && (
            <Button disabled={!!busy} onClick={() => setShowChange((s) => !s)} aria-expanded={showChange}>
              Something changed
            </Button>
          )}
          {actions.requestReview && (
            <Button disabled={!!busy} onClick={() => act("Request review", "review", version, Api.requestReview.response)}>
              Request review
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!!busy || !actions.approve || !v.evidence_snapshot_id}
            title={blockedApprove ?? undefined}
            onClick={() =>
              act("Approve", "approve", { ...version, evidence_snapshot_id: v.evidence_snapshot_id }, Api.approve.response)
            }
          >
            Approve v{v.version}
          </Button>
        </div>
        {blockedApprove && <p className="mt-2 text-sm text-stone-600">{blockedApprove}</p>}
        {showChange && (
          <ChangeForm
            disabled={!!busy}
            onCancel={() => setShowChange(false)}
            onSubmit={async (change) => {
              const r = await act("Report a change", "changes", { ...version, change }, Api.reportChange.response);
              if (r.ok) setShowChange(false);
            }}
          />
        )}
      </Card>

      <BlockersCard version={v} snapshot={snapshot} />
      <div className="grid gap-5 lg:grid-cols-2">
        <PlanCard version={v} snapshot={snapshot} />
        <ChecksList checks={v.checks} />
      </div>
      <EvidenceList snapshot={snapshot} />
    </div>
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
      className="mt-4 space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = ChangeReport.safeParse({ kind, description: description.trim() });
        if (!parsed.success) return setError("Describe what changed");
        onSubmit(parsed.data);
      }}
    >
      <p className="text-sm text-stone-700">
        FieldDay will ask its specialists for alternatives. Your current plan stays as it is until you pick one.
      </p>
      <div>
        <label htmlFor="change-kind" className="mb-1 block text-sm font-medium text-stone-800">
          What changed?
        </label>
        <select
          id="change-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as ChangeReport["kind"])}
          className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        >
          {CHANGE_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="change-description" className="mb-1 block text-sm font-medium text-stone-800">
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
          className={`block w-full rounded-lg border bg-white px-3 py-2 text-sm ${error ? "border-rose-400" : "border-stone-300"}`}
        />
        {error && (
          <p id="change-error" className="mt-1 text-sm text-rose-700">
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
      <div className="h-8 w-2/3 rounded bg-stone-200" />
      <div className="h-12 rounded-xl bg-stone-100" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-56 rounded-xl bg-stone-100" />
        <div className="h-56 rounded-xl bg-stone-100" />
      </div>
    </div>
  );
}
