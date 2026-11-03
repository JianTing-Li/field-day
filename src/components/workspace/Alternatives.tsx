"use client";

import { isConfirmableCheck, type CombinedOption, type EvidenceSnapshot, type PlanChange, type PlanVersion } from "@/contracts";
import { Button } from "../ui";
import { adaptationName, checkName, conditionsLine, formatLocal, parkName, problemLines, templateName, weatherIcon } from "./logic";

/**
 * The fix for a conflict, shown where the problem is (YT-10, reworked in JT-24 and JT-28): every
 * option side by side, the reviewer's recommendation (or best-ranked option) first.
 */

export function SuggestedFix({
  version,
  snapshot,
  busy,
  canApply,
  onApply,
}: {
  version: PlanVersion;
  snapshot: EvidenceSnapshot | null;
  busy: boolean;
  canApply: boolean;
  onApply: (option: CombinedOption) => void;
}) {
  const review = version.alternatives;
  if (!review || review.ranked_options.length === 0) return null;
  const options = [...review.ranked_options].sort((a, b) => rank(a) - rank(b));
  const best = options.find((o) => o.combined_option_id === review.recommendation?.combined_option_id) ?? options[0];
  const ordered = [best, ...options.filter((o) => o !== best)];
  const working = ordered.filter((o) => o.checks.overall !== "fail").length;

  // Every option is on screen side by side (JT-28): a hidden "Other options" button was easy to miss.
  return (
    <div id="alternatives" className="animate-enter mt-6 scroll-mt-24">
      <p className="text-lg font-bold text-ink">
        {working === 0 ? "No option fixes everything" : working === 1 ? "1 way to fix it" : `${working} ways to fix it`}
      </p>
      {ordered.length > 1 && <p className="text-sm text-ink-2">The first one is FieldDay&apos;s pick.</p>}
      <div className={`mt-3 grid gap-3 ${ordered.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {ordered.map((o, n) => (
          <OptionCard
            key={o.combined_option_id}
            option={o}
            current={version.plan}
            snapshot={snapshot}
            label={n === 0 ? (o.checks.overall === "fail" ? "Closest option" : "Best fix") : `Option ${n + 1}`}
            featured={n === 0 && o.checks.overall !== "fail"}
            busy={busy}
            canApply={canApply}
            onApply={onApply}
          />
        ))}
      </div>
    </div>
  );
}

/** Options with a failed check sort last; fewer things left to check sort first. */
function rank(o: CombinedOption): number {
  const critical = o.checks.checks.filter((c) => c.critical);
  return critical.filter((c) => c.status === "fail").length * 10 + critical.filter((c) => c.status === "unknown").length;
}

/** What an option changes from the current plan, in short phrases: "8:00 AM, not 10:00 AM". */
export function optionChanges(o: CombinedOption, current: PlanVersion["plan"], snapshot: EvidenceSnapshot | null): string[] {
  if (!current) return [];
  const p = o.plan;
  const clock = (t: string | null) => formatLocal(t).split(" · ").at(-1);
  const day = (t: string | null) => formatLocal(t).split(" · ")[0];
  const out: string[] = [];
  if (p.start_time && current.start_time && p.start_time.slice(0, 10) !== current.start_time.slice(0, 10)) {
    out.push(`${day(p.start_time)}, not ${day(current.start_time)}`);
  }
  if (p.start_time !== current.start_time && clock(p.start_time) !== clock(current.start_time)) {
    out.push(`${clock(p.start_time)}, not ${clock(current.start_time)}`);
  }
  if (p.park_id !== current.park_id) out.push(`${parkName(snapshot, p.park_id)}, not ${parkName(snapshot, current.park_id)}`);
  else out.push("Same park");
  if (p.workout_template_id !== current.workout_template_id) out.push(`New workout: ${templateName(snapshot, p.workout_template_id)}`);
  if (p.duration_minutes && current.duration_minutes && p.duration_minutes !== current.duration_minutes) {
    out.push(`${p.duration_minutes} min, not ${current.duration_minutes}`);
  }
  return out;
}

function OptionCard({
  option: o,
  current,
  snapshot,
  label,
  featured = false,
  busy,
  canApply,
  onApply,
}: {
  option: CombinedOption;
  current: PlanVersion["plan"];
  snapshot: EvidenceSnapshot | null;
  label: string;
  featured?: boolean;
  busy: boolean;
  canApply: boolean;
  onApply: (option: CombinedOption) => void;
}) {
  const p = o.plan;
  const time = formatLocal(p.start_time).split(" · ").at(-1);
  const adaptation = p.adaptation_ids.map((a) => shortAdaptation(adaptationName(snapshot, p.workout_template_id, a))).join(", ");
  const toCheck = o.checks.checks
    .filter((c) => c.critical && c.status === "unknown" && isConfirmableCheck(c.check_id))
    .map((c) => checkName(c.check_id).toLowerCase());
  const stillWrong = problemLines({ checks: o.checks } as PlanVersion, snapshot);
  const changes = optionChanges(o, current, snapshot);
  const conditions = conditionsLine(snapshot, p);
  const newWorkout = !!current && p.workout_template_id !== current.workout_template_id;
  return (
    <div className={`clay-sm flex flex-col rounded-disclosure p-5 ${featured ? "bg-mint" : "bg-cream"}`}>
      <p className="text-xs font-bold tracking-wide text-ink uppercase">{label}</p>
      <p className="mt-1 text-lg leading-snug font-bold text-ink">
        {time} at {parkName(snapshot, p.park_id)}
      </p>
      {changes.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="What changes">
          {changes.map((c) => (
            <li key={c} className={`rounded-control px-2.5 py-0.5 text-xs font-bold text-ink ${featured ? "bg-cream/70" : "bg-ground"}`}>
              {c}
            </li>
          ))}
        </ul>
      )}
      {/* A new workout is already named in its chip; say it once. */}
      {(!newWorkout || adaptation) && (
        <p className="mt-2 text-sm text-ink">
          {!newWorkout && templateName(snapshot, p.workout_template_id)}
          {adaptation && <span className="block text-ink-2">Swap: {adaptation.charAt(0).toLowerCase()}{adaptation.slice(1)}</span>}
        </p>
      )}
      {conditions && (
        <p className="mt-1 text-sm text-ink">
          <span aria-hidden="true">{weatherIcon(snapshot, p)} </span>
          {conditions}
        </p>
      )}
      {toCheck.length > 0 && <p className="mt-1 text-sm text-ink-2">You&apos;ll check: {toCheck.join(", ")}</p>}
      {stillWrong.length > 0 && <p className="mt-1 text-sm font-bold text-ink">Still a problem: {stillWrong.join("; ")}</p>}
      {/* An option that still fails a critical check can't be approved, so it isn't offered (D-JT25-1). */}
      {stillWrong.length === 0 && (
        <Button variant={featured ? "surface" : "primary"} className="mt-4 self-start" disabled={busy || !canApply} onClick={() => onApply(o)}>
          Use this plan
        </Button>
      )}
    </div>
  );
}

/** "Replace the running intervals with a stationary circuit (high knees, …)" -> the part before the list. */
function shortAdaptation(text: string): string {
  return text.replace(/\s*\(.*\)\s*$/, "");
}

/** A change's before/after value in words. */
export function changeValue(c: PlanChange, value: string | null, snapshot: EvidenceSnapshot | null, templateId: string | null): string {
  if (value === null) return "none";
  switch (c.field) {
    case "park":
      return parkName(snapshot, value);
    case "start_time":
      return /T\d\d:\d\d$/.test(value) ? formatLocal(value) : value;
    case "workout":
      return templateName(snapshot, value);
    case "adaptation":
      return adaptationName(snapshot, templateId, value);
    case "duration":
      return /^\d+$/.test(value) ? `${value} min` : value;
    default:
      return value;
  }
}
