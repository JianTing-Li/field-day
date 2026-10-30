import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import Link from "next/link";
import { ViewTransition } from "react";
import { dataMode } from "@/server/data/mode";
import { agentMode } from "@/server/orchestrator/agents";
import { AGENT_RUN_LIMITS } from "./api/_lib/rate-limit";
import "./globals.css";

// "Claymorphism Instrument": the UI system's typeface (see globals.css).
const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FieldDay",
  description: "Plan outdoor group workouts in NYC parks with checked weather, air quality and space.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const fixture = dataMode() === "fixture";
  const realAgents = agentMode() === "real";
  return (
    <html lang="en" className={`${instrument.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* Shown in every mode (D-JT24-2): the limits and workouts are unreviewed even with live data. */}
        <div role="note" className="bg-butter px-4 py-2 text-center text-sm text-ink">
          <strong className="font-bold">Demo:</strong>{" "}
          {fixture
            ? "weather, air quality and parks are recorded samples, not live data."
            : "live weather and air quality, but the safety limits and workouts aren't reviewed by an instructor yet."}{" "}
          Don&apos;t use it to run a real event.
          {realAgents && (
            <>
              {" "}
              Plans are drafted by Claude on shared demo credits, limited to {AGENT_RUN_LIMITS.per_visitor_per_hour} agent
              runs per visitor per hour.
            </>
          )}
        </div>
        {/* Same width and side padding as every page's <main>, so the bar lines up with the content. */}
        <header className="mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6">
          <div className="clay flex w-full items-center justify-between gap-4 rounded-disclosure bg-cream px-4 py-2.5 sm:px-6">
            <Link href="/" className="focus-ring flex items-center gap-2.5 rounded-control font-bold tracking-tight text-ink">
              <span aria-hidden="true" className="clay-sm grid h-9 w-9 place-items-center rounded-full bg-accent text-base">
                F
              </span>
              FieldDay
            </Link>
            <span className="hidden text-xs text-ink-2 sm:inline">Outdoor workout planning · New York City</span>
          </div>
        </header>
        {/* Page changes crossfade instead of swapping in one frame; the banner and header stay put. */}
        <ViewTransition>{children}</ViewTransition>
      </body>
    </html>
  );
}
