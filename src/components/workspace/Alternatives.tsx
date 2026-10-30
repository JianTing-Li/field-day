"use client";

import { useState } from "react";
import { isConfirmableCheck, type CombinedOption, type EvidenceSnapshot, type PlanChange, type PlanVersion } from "@/contracts";
import { Button } from "../ui";
import { adaptationName, checkName, formatLocal, parkName, plainText, problemLines, templateName } from "./logic";

/**
 * The fix for a conflict, shown where the problem is (YT-10, reworked in JT-24): the reviewer's
 * recommendation (or best-ranked option) up front with one button, the others one tap away.
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
  const [showOthers, setShowOthers] = useState(false);
  const review = version.alternatives;
  if (!review || review.ranked_options.length === 0) return null;
  const options = [...review.ranked_options].sort((a, b) => rank(a) - rank(b));
  const best = options.find((o) => o.combined_option_id === review.recommendation?.combined_option_id) ?? options[0];
  const others = options.filter((o) => o !== best);

  return (
    <div id="alternatives" className="animate-enter mt-6 scroll-mt-24 space-y-3">
      <OptionCard option={best} snapshot={snapshot} label="Suggested fix" featured busy={busy} canApply={canApply} onApply={onApply} />
      {others.length > 0 && (
        <Button variant="ghost" onClick={() => setShowOthers((s) => !s)} aria-expanded={showOthers}>
          {showOthers ? "Hide other options" : `Other options (${others.length})`}
        </Button>
      )}
      {showOthers &&
        others.map((o) => (
          <OptionCard key={o.combined_option_id} option={o} snapshot={snapshot} busy={busy} canApply={canApply} onApply={onApply} />
        ))}
    </div>
  );
}

/** Options with a failed check sort last; fewer things left to check sort first. */
function rank(o: CombinedOption): number {
  const critical = o.checks.checks.filter((c) => c.critical);
  return critical.filter((c) => c.status === "fail").length * 10 + critical.filter((c) => c.status === "unknown").length;
}

function OptionCard({
  option: o,
  snapshot,
  label,
  featured = false,
  busy,
  canApply,
  onApply,
}: {
  option: CombinedOption;
  snapshot: EvidenceSnapshot | null;
  label?: string;
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
  const notes = [
    ...o.tradeoffs.slice(0, 2).map((t) => plainText(t, snapshot)),
    ...(toCheck.length > 0 ? [`you'll confirm the ${toCheck.join(" and ")}`] : []),
  ];
  return (
    <div className={`clay-sm rounded-disclosure p-5 ${featured ? "bg-mint" : "bg-cream"}`}>
      {label && <p className="text-xs font-bold tracking-wide text-ink uppercase">{label}</p>}
      <p className="mt-1 text-lg leading-snug font-bold text-ink">
        {time} at {parkName(snapshot, p.park_id)}
      </p>
      <p className="text-sm text-ink">
        {templateName(snapshot, p.workout_template_id)}
        {adaptation && `, ${adaptation.charAt(0).toLowerCase()}${adaptation.slice(1)}`}
      </p>
      {notes.length > 0 && <p className="mt-1 text-sm text-ink-2">{notes.join(" · ")}</p>}
      {stillWrong.length > 0 && <p className="mt-1 text-sm font-bold text-ink">Still a problem: {stillWrong.join("; ")}</p>}
      <Button variant={featured ? "surface" : "primary"} className="mt-4" disabled={busy || !canApply} onClick={() => onApply(o)}>
        Use this plan
      </Button>
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
