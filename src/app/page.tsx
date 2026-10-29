import { EventList, NewEventLink } from "@/components/EventList";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <section className="clay relative overflow-hidden rounded-surface bg-accent px-6 py-9 sm:px-10 sm:py-12 md:rounded-tray md:px-14">
        <div className="relative z-10 max-w-xl md:max-w-[55%]">
          <p className="text-sm font-bold tracking-wide text-ink uppercase">Welcome to FieldDay</p>
          <h1 className="mt-2 text-[44px] leading-[0.98] font-bold tracking-[-0.035em] text-ink md:text-[clamp(48px,6vw,80px)]">
            Your outdoor workout planner
          </h1>
          <p className="mt-4 max-w-md text-base text-ink">
            Plan group workouts in NYC parks. FieldDay picks a park, time and workout, then checks the weather, air
            quality and space so you know it&apos;s safe before anyone shows up.
          </p>
          <NewEventLink className="mt-6" label="Plan a new event" />
        </div>
        <Sculpture />
      </section>
      <ol aria-label="How FieldDay works" className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className={`clay rounded-surface px-6 py-5 ${step.bg}`}>
            <p className="text-xs font-bold tracking-wide text-ink uppercase">Step {i + 1}</p>
            <p className="mt-1 text-lg leading-snug font-bold text-ink">{step.title}</p>
            <p className="mt-1 text-sm text-ink">{step.body}</p>
          </li>
        ))}
      </ol>
      <section aria-labelledby="your-events" className="space-y-4">
        <h2 id="your-events" className="px-2 text-2xl font-bold tracking-tight text-ink">
          Your events
        </h2>
        <EventList />
      </section>
    </main>
  );
}

const STEPS = [
  { title: "Tell us the basics", body: "Date, group size, start window and the parks you like.", bg: "bg-mint" },
  { title: "FieldDay checks it", body: "Weather, air quality, space and equipment, with every source shown.", bg: "bg-lavender" },
  { title: "You approve", body: "Confirm what only you can, approve, and lock in your final plan.", bg: "bg-butter" },
];

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
