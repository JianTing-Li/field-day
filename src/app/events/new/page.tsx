import type { Metadata } from "next";
import Link from "next/link";
import { BriefForm } from "@/components/BriefForm";
import { briefFormOptions } from "@/components/form-options";

export const metadata: Metadata = { title: "New event · FieldDay" };

export default function NewEventPage() {
  const options = briefFormOptions();
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="focus-ring rounded-control text-sm font-bold text-ink-2 hover:text-ink">
        ← Events
      </Link>
      <h1 className="mt-2 text-[40px] leading-[1.05] font-bold tracking-[-0.03em] text-ink sm:text-5xl">New event</h1>
      <p className="mb-6 mt-1 text-sm text-ink-2">
        Describe what you need. Nothing is booked or published: FieldDay drafts a plan and checks it against the
        weather, air quality and your constraints.
      </p>
      <BriefForm mode="create" {...options} />
    </main>
  );
}
