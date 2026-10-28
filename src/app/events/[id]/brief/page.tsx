import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BriefForm } from "@/components/BriefForm";
import { briefFormOptions } from "@/components/form-options";

export const metadata: Metadata = { title: "Edit brief · FieldDay" };

export default function EditBriefPage(props: PageProps<"/events/[id]/brief">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-sm text-stone-600">Loading the event brief…</p>}>
        <EditBrief params={props.params} />
      </Suspense>
    </main>
  );
}

/** Reads the event ID from the URL; kept inside Suspense so the rest of the page can render first. */
async function EditBrief({ params }: { params: PageProps<"/events/[id]/brief">["params"] }) {
  const { id } = await params;
  return (
    <>
      <Link href={`/events/${encodeURIComponent(id)}`} className="text-sm text-stone-600 hover:text-stone-900">
        ← Back to the event
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold tracking-tight text-stone-900">Edit event brief</h1>
      <BriefForm mode="edit" eventId={id} {...briefFormOptions()} />
    </>
  );
}
