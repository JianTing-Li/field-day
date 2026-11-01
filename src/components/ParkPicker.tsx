"use client";

import { useState } from "react";
import { findParks, MAX_PARKS, zipCentre, type PickerPark, type Point } from "./park-picker";
import { fieldClass } from "./ui";

/**
 * Pick up to 5 parks without a wall of checkboxes (JT-24, D-JT24-13): search, borough chips, or
 * "near me" / a zip code to sort by distance. Picked parks show as tags at the top.
 */

const BOROUGHS = ["Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island"];
const SHOWN = 8;

export function ParkPicker({
  parks,
  selected,
  onChange,
  idPrefix,
  error,
}: {
  parks: PickerPark[];
  selected: string[];
  onChange: (ids: string[]) => void;
  idPrefix: string;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [borough, setBorough] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ point: Point; label: string } | null>(null);
  const [zip, setZip] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const matches = findParks(parks, { query, borough, origin: origin?.point ?? null });
  const shown = showAll ? matches : matches.slice(0, SHOWN);
  const full = selected.length >= MAX_PARKS;
  const nameOf = (id: string) => parks.find((p) => p.id === id)?.name ?? id;
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : full ? selected : [...selected, id]);

  const nearMe = () => {
    setNote(null);
    if (!("geolocation" in navigator)) return setNote("Your browser can't share a location. Type a zip code instead.");
    navigator.geolocation.getCurrentPosition(
      (pos) => setOrigin({ point: { lat: pos.coords.latitude, lon: pos.coords.longitude }, label: "you" }),
      () => setNote("Location is off. Type a zip code instead."),
      { timeout: 8000 },
    );
  };
  const applyZip = (value: string) => {
    setZip(value);
    setNote(null);
    if (!/^\d{5}$/.test(value)) return value.length === 0 ? setOrigin(null) : undefined;
    const point = zipCentre(value);
    if (point) setOrigin({ point, label: value });
    else setNote("That zip code isn't in New York City.");
  };

  return (
    <div className="space-y-3 sm:col-span-2">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Parks you picked">
          {selected.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={`Remove ${nameOf(id)}`}
                className="clay-recessed focus-ring flex items-center gap-2 rounded-control bg-mint px-3.5 py-1.5 text-sm font-bold text-ink"
              >
                {nameOf(id)} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-2" aria-live="polite">
        {full ? `That's the most for one event (${MAX_PARKS}). Remove one to add another.` : `${selected.length} of ${MAX_PARKS} picked`}
      </p>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_8rem]">
        <input
          id={`${idPrefix}-field-allowed_park_ids`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search parks"
          aria-label="Search parks"
          className={fieldClass(error)}
        />
        <button type="button" onClick={nearMe} className="clay-sm focus-ring rounded-control bg-cream px-4 py-2 text-sm font-bold text-ink">
          Near me
        </button>
        <input
          inputMode="numeric"
          maxLength={5}
          value={zip}
          onChange={(e) => applyZip(e.target.value.replace(/\D/g, ""))}
          placeholder="Zip code"
          aria-label="Sort by distance from a zip code"
          className={fieldClass()}
        />
      </div>
      {note && <p className="text-xs font-bold text-ink">{note}</p>}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Borough">
        {[null, ...BOROUGHS].map((b) => (
          <button
            key={b ?? "all"}
            type="button"
            aria-pressed={borough === b}
            onClick={() => setBorough(b)}
            className={`focus-ring rounded-control px-3 py-1.5 text-xs font-bold text-ink ${borough === b ? "clay-recessed bg-mint" : "clay-sm bg-cream"}`}
          >
            {b ?? "All boroughs"}
          </button>
        ))}
      </div>

      {origin && <p className="text-xs text-ink-2">Nearest to {origin.label} first.</p>}
      <ul className="divide-y divide-ink/10 rounded-disclosure bg-ground px-4">
        {shown.length === 0 && <li className="py-3 text-sm text-ink-2">No park matches. Try another name or borough.</li>}
        {shown.map((p) => {
          const picked = selected.includes(p.id);
          return (
            <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-ink">{p.name}</span>
                <span className="block text-xs text-ink-2">
                  {p.borough}
                  {p.miles !== null && ` · ${p.miles < 10 ? p.miles.toFixed(1) : Math.round(p.miles)} mi`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                disabled={!picked && full}
                aria-pressed={picked}
                className={`focus-ring shrink-0 rounded-control px-3.5 py-1.5 text-xs font-bold text-ink disabled:opacity-55 ${picked ? "clay-recessed bg-mint" : "clay-sm bg-cream"}`}
              >
                {picked ? "✓ Added" : "Add"}
              </button>
            </li>
          );
        })}
      </ul>
      {matches.length > SHOWN && (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="text-sm font-bold text-ink underline-offset-4 hover:underline">
          {showAll ? "Show fewer" : `Show all ${matches.length} parks`}
        </button>
      )}
    </div>
  );
}
