import { EventList, NewEventLink } from "@/components/EventList";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Events</h1>
          <p className="mt-1 text-sm text-stone-600">
            Each event shows its current plan version and, once saved, the version that was finalized.
          </p>
        </div>
        <NewEventLink />
      </div>
      <EventList />
    </main>
  );
}
