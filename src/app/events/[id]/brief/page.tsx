import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BriefForm } from "@/components/BriefForm";
import { briefFormOptions } from "@/components/form-options";
import { getEvent } from "@/server/lifecycle/service";

export const metadata: Metadata = { title: "Edit brief · FieldDay" };

export default function EditBriefPage(props: PageProps<"/events/[id]/brief">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <Suspense fallback={<p role="status" className="text-sm text-ink-2">Loading the event brief…</p>}>
        <EditBrief params={props.params} />
      </Suspense>
    </main>
  );
}

/** Reads the event ID from the URL and loads the brief on the server, so the form opens filled in. */
async function EditBrief({ params }: { params: PageProps<"/events/[id]/brief">["params"] }) {
  const { id } = await params;
  const initial = await getEvent(id).catch(() => null);
  return (
    <>
      <Link href={`/events/${encodeURIComponent(id)}`} className="focus-ring rounded-control text-sm font-bold text-ink-2 hover:text-ink">
        ← Back to the event
      </Link>
      <h1 className="mb-6 mt-2 text-[40px] leading-[1.05] font-bold tracking-[-0.03em] text-ink sm:text-5xl">Edit event brief</h1>
      <BriefForm mode="edit" eventId={id} initialEvent={initial?.event ?? null} {...briefFormOptions()} />
    </>
  );
}
