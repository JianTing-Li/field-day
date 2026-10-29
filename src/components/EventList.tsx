"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Api, type EventSummary } from "@/contracts";
import { apiGet, type ApiResult } from "./api-client";
import { describeError } from "./errors";
import { formatEventDate, formatUpdated } from "./format";
import { StatusBadge } from "./StatusBadge";
import { Alert, Button, buttonClass } from "./ui";

type ListResult = ApiResult<{ events: EventSummary[] }>;

/** The organizer's events (GET /api/events), newest change first. Owner: Yadan, task YT-07. */
export function EventList() {
  const [result, setResult] = useState<ListResult | null>(null);

  const load = useCallback(async () => {
    setResult(null);
    setResult(await apiGet(Api.listEvents.path, Api.listEvents.response));
  }, []);

  useEffect(() => {
    let live = true;
    apiGet(Api.listEvents.path, Api.listEvents.response).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, []);

  if (result === null) return <ListSkeleton />;

  if (!result.ok) {
    return (
      <Alert tone="danger" role="alert" title="Events could not be loaded.">
        <p>{describeError(result, "Loading events").title}. Nothing was changed.</p>
        <Button variant="surface" className="mt-3" onClick={load}>
          Try again
        </Button>
      </Alert>
    );
  }

  const { events } = result.data;
  if (events.length === 0) {
    return (
      <div className="clay rounded-surface bg-cream p-10 text-center md:rounded-tray">
        <p className="text-xl font-bold text-ink">No events yet</p>
        <p className="mt-1 text-sm text-ink-2">Plan your first one: it takes about a minute.</p>
        <NewEventLink className="mt-5" variant="primary" label="Plan a new event" />
      </div>
    );
  }

  return (
    <ul className="clay space-y-1 rounded-surface bg-cream p-3 sm:p-5 md:rounded-tray md:p-8">
      <li
        aria-hidden="true"
        className="hidden grid-cols-[minmax(0,1fr)_9rem_11rem] gap-4 px-5 pb-2 text-xs font-bold tracking-wide text-ink-2 uppercase lg:grid"
      >
        <span>Event</span>
        <span>Date</span>
        <span>Status</span>
      </li>
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
    </ul>
  );
}

function EventRow({ event: e }: { event: EventSummary }) {
  return (
    <li>
      <Link
        href={`/events/${encodeURIComponent(e.id)}`}
        className="focus-ring grid gap-x-4 gap-y-2 rounded-disclosure px-5 py-4 transition-colors duration-[var(--dp-motion-interaction)] hover:bg-lavender/50 lg:grid-cols-[minmax(0,1fr)_9rem_11rem] lg:items-center"
      >
        <span className="min-w-0">
          <span className="block font-bold text-ink lg:line-clamp-2">{e.title}</span>
          <span className="block text-xs text-ink-2">Updated {formatUpdated(e.updated_at)}</span>
        </span>
        <span className="text-sm text-ink-2">
          <span className="text-ink-2 lg:hidden">Date: </span>
          {formatEventDate(e.date)}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={e.status} />
          {e.finalized_version !== null && e.status !== "finalized" && (
            <span className="text-xs text-ink-2">🔒 An earlier plan is locked in</span>
          )}
        </span>
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading events" className="clay space-y-1 rounded-surface bg-cream p-5 md:rounded-tray md:p-8">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-5 py-5">
          <div className="h-4 flex-1 rounded-control bg-lavender" />
          <div className="h-4 w-24 rounded-control bg-ground" />
          <div className="h-7 w-28 rounded-control bg-ground" />
        </div>
      ))}
    </div>
  );
}

/** "+ New event". Cream on the teal hero, teal elsewhere. */
export function NewEventLink({
  className = "",
  variant = "surface",
  label = "New event",
}: {
  className?: string;
  variant?: "surface" | "primary";
  label?: string;
}) {
  return (
    <Link href="/events/new" className={buttonClass(variant, `px-6 py-3 text-base ${className}`)}>
      <span aria-hidden="true">+</span> {label}
    </Link>
  );
}
