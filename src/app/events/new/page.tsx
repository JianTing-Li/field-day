import type { Metadata } from "next";
import Link from "next/link";
import { BriefForm } from "@/components/BriefForm";
import { briefFormOptions } from "@/components/form-options";

export const metadata: Metadata = { title: "New event · FieldDay" };

export default function NewEventPage() {
  const options = briefFormOptions();
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="text-sm text-stone-600 hover:text-stone-900">
        ← Events
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-900">New event</h1>
      <p className="mb-6 mt-1 text-sm text-stone-600">
        Describe what you need. Nothing is booked or published: FieldDay drafts a plan and checks it against the
        weather, air quality and your constraints.
      </p>
      <BriefForm mode="create" {...options} />
    </main>
  );
}
