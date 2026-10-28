import { EventList, NewEventLink } from "@/components/EventList";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <section className="clay relative overflow-hidden rounded-surface bg-accent px-6 py-9 sm:px-10 sm:py-12 md:rounded-tray md:px-14">
        <div className="relative z-10 max-w-xl md:max-w-[55%]">
          <h1 className="text-[54px] leading-[0.95] font-bold tracking-[-0.035em] text-ink md:text-[clamp(54px,7vw,94px)]">
            Events
          </h1>
          <p className="mt-4 max-w-md text-base text-ink">
            Each event shows its current plan version and, once saved, the version that was finalized.
          </p>
          <NewEventLink className="mt-6" />
        </div>
        <Sculpture />
      </section>
      <EventList />
    </main>
  );
}

/** Decorative molded shapes; static, and kept clear of the headline and action. */
function Sculpture() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] md:block">
      <span className="clay absolute top-[14%] right-[30%] h-28 w-28 rounded-full bg-cream lg:h-36 lg:w-36" />
      <span className="clay absolute top-[38%] right-[8%] h-24 w-40 rotate-[-12deg] rounded-surface bg-lavender lg:h-28 lg:w-48" />
      <span className="clay absolute right-[44%] bottom-[12%] h-16 w-16 rounded-full bg-butter lg:h-20 lg:w-20" />
      <span className="clay absolute right-[14%] bottom-[-8%] h-24 w-24 rounded-[30px] bg-cool lg:h-28 lg:w-28" />
    </div>
  );
}
