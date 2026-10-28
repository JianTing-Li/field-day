"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Api, type EventSummary } from "@/contracts";
import { apiGet, type ApiResult } from "./api-client";
import { formatEventDate, formatUpdated, versionText } from "./format";
import { StatusBadge } from "./StatusBadge";

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
      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <p className="font-medium">Events could not be loaded.</p>
        <p className="mt-1 text-sm">{result.message}. Nothing was changed.</p>
        <button
          type="button"
          onClick={load}
          className="mt-3 rounded-lg bg-rose-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900"
        >
          Try again
        </button>
      </div>
    );
  }

  const { events } = result.data;
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
        <p className="font-medium text-stone-900">No events yet</p>
        <p className="mt-1 text-sm text-stone-600">Start with an event brief: date, time window, parks and workout.</p>
        <NewEventLink className="mt-4" />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
      <li
        aria-hidden="true"
        className="hidden grid-cols-[1fr_9rem_10rem_5rem_7rem] gap-4 bg-stone-50 px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-stone-500 md:grid"
      >
        <span>Event</span>
        <span>Date</span>
        <span>Status</span>
        <span>Version</span>
        <span>Finalized</span>
      </li>
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
    </ul>
  );
}

function EventRow({ event: e }: { event: EventSummary }) {
  const v = versionText(e.current_version, e.finalized_version);
  return (
    <li>
      <Link
        href={`/events/${encodeURIComponent(e.id)}`}
        className="grid gap-x-4 gap-y-2 px-5 py-4 hover:bg-stone-50 focus-visible:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-700 md:grid-cols-[1fr_9rem_10rem_5rem_7rem] md:items-center"
      >
        <span className="min-w-0">
          <span className="block font-medium text-stone-900 md:truncate">{e.title}</span>
          <span className="block text-xs text-stone-500">Updated {formatUpdated(e.updated_at)}</span>
        </span>
        <span className="text-sm text-stone-700">
          <span className="text-stone-500 md:hidden">Date: </span>
          {formatEventDate(e.date)}
        </span>
        <span>
          <StatusBadge status={e.status} />
        </span>
        <span className="text-sm text-stone-700">
          <span className="text-stone-500 md:hidden">Current version: </span>
          <span className="font-mono">{v.current}</span>
        </span>
        <span className="text-sm text-stone-700">
          <span className="text-stone-500 md:hidden">Finalized: </span>
          <span className={e.finalized_version === null ? "text-stone-400" : "font-mono"}>{v.finalized}</span>
        </span>
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading events" className="space-y-px overflow-hidden rounded-xl border border-stone-200 bg-white">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-5 py-5">
          <div className="h-4 flex-1 rounded bg-stone-200" />
          <div className="h-4 w-24 rounded bg-stone-100" />
          <div className="h-6 w-28 rounded-full bg-stone-100" />
        </div>
      ))}
    </div>
  );
}

export function NewEventLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/events/new"
      className={`inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 ${className}`}
    >
      <span aria-hidden="true">+</span> New event
    </Link>
  );
}
