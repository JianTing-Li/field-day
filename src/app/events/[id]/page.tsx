import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Workspace, WorkspaceSkeleton } from "@/components/workspace/Workspace";
import { todayInNewYork } from "@/components/format";
import { getEvent } from "@/server/lifecycle/service";

export const metadata: Metadata = { title: "Event · FieldDay" };

export default function EventPage(props: PageProps<"/events/[id]">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/" className="focus-ring rounded-control text-sm font-bold text-ink-2 hover:text-ink">
        ← Events
      </Link>
      <div className="mt-3">
        <Suspense fallback={<WorkspaceSkeleton />}>
          <EventWorkspace params={props.params} />
        </Suspense>
      </div>
    </main>
  );
}

/**
 * Reads the event ID inside Suspense, as Next 16 requires for runtime params, and loads the event on
 * the server so the page opens with it. If that fails, the workspace loads it and shows the error.
 */
async function EventWorkspace({ params }: { params: PageProps<"/events/[id]">["params"] }) {
  const { id } = await params;
  // Request time only: the event and "today" must never be baked into a prerendered shell.
  await connection();
  const initial = await getEvent(id).catch(() => null);
  return <Workspace eventId={id} initial={initial} serverToday={todayInNewYork()} />;
}
