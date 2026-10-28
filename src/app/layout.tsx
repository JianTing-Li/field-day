import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { dataMode } from "@/server/data/mode";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {fixture && (
          <div role="note" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
            <strong className="font-semibold">Demo data.</strong> Weather, air quality, parks and confirmations come
            from recorded fixtures, not live sources. Do not use them to run a real event.
          </div>
        )}
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-emerald-900">
              <span
                aria-hidden="true"
                className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-800 text-sm text-white"
              >
                F
              </span>
              FieldDay
            </Link>
            <span className="hidden text-xs text-stone-500 sm:inline">Outdoor workout planning · New York City</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
