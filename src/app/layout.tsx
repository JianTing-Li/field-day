import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import Link from "next/link";
import { dataMode } from "@/server/data/mode";
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
  return (
    <html lang="en" className={`${instrument.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {fixture && (
          <div role="note" className="bg-butter px-4 py-2 text-center text-sm text-ink">
            <strong className="font-bold">Demo data.</strong> Weather, air quality, parks and confirmations come from
            recorded fixtures, not live sources. Do not use them to run a real event.
          </div>
        )}
        <header className="px-4 pt-4 sm:px-6">
          <div className="clay mx-auto flex w-full max-w-5xl items-center justify-between gap-4 rounded-control bg-cream px-4 py-2.5 sm:px-6">
            <Link href="/" className="focus-ring flex items-center gap-2.5 rounded-control font-bold tracking-tight text-ink">
              <span aria-hidden="true" className="clay-sm grid h-9 w-9 place-items-center rounded-full bg-accent text-base">
                F
              </span>
              FieldDay
            </Link>
            <span className="hidden text-xs text-ink-2 sm:inline">Outdoor workout planning · New York City</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
