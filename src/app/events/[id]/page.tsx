import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Workspace } from "@/components/workspace/Workspace";

export const metadata: Metadata = { title: "Event · FieldDay" };

export default function EventPage(props: PageProps<"/events/[id]">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/" className="focus-ring rounded-control text-sm font-bold text-ink-2 hover:text-ink">
        ← Events
      </Link>
      <div className="mt-3">
        <Suspense fallback={<p className="text-sm text-ink-2">Loading the event…</p>}>
          <EventWorkspace params={props.params} />
        </Suspense>
      </div>
    </main>
  );
}

/** Reads the event ID inside Suspense, as Next 16 requires for runtime params. */
async function EventWorkspace({ params }: { params: PageProps<"/events/[id]">["params"] }) {
  const { id } = await params;
  return <Workspace eventId={id} />;
}
