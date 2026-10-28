import type { CombinedOption, EvidenceSnapshot, PlanChange, PlanVersion } from "@/contracts";
import { Alert, Button, Card, Pill } from "../ui";
import { adaptationName, checkName, formatLocal, parkName, sortChecks, templateName } from "./logic";
import { CheckStatusPill } from "./sections";

/** Ranked alternatives from conflict review (alternatives on the current version). Task YT-10. */

const FIELD_LABEL: Record<PlanChange["field"], string> = {
  park: "Park",
  start_time: "Start",
  duration: "Length",
  workout: "Workout",
  adaptation: "Adaptation",
  session: "Session",
};

export function Alternatives({
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
  if (!review) return null;
  const recommended = review.recommendation?.combined_option_id ?? null;

  return (
    <Card
      title="Alternatives"
      description="Ranked by the reviewer. Picking one creates a new draft version, which is checked again before you can approve it."
      actions={<Pill tone={review.status === "draft" ? "success" : "warning"}>{reviewStatus(review.status)}</Pill>}
    >
      {review.blocking_issues.length > 0 && (
        <div className="mb-4">
          <Alert tone="warning" title="Still unresolved">
            <ul className="list-disc space-y-0.5 pl-5">
              {review.blocking_issues.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      {review.recommendation ? (
        <p className="mb-4 text-sm text-stone-700">
          <strong className="font-semibold">Recommendation:</strong> {review.recommendation.reason}
        </p>
      ) : (
        <p className="mb-4 text-sm text-stone-700">
          No option is recommended yet: each one still has something unconfirmed. Compare them and confirm what you can.
        </p>
      )}
      {review.ranked_options.length === 0 ? (
        <p className="text-sm text-stone-600">The reviewer found no workable option.</p>
      ) : (
        <ol className="grid gap-4 md:grid-cols-2">
          {review.ranked_options.map((o, i) => (
            <OptionCard
              key={o.combined_option_id}
              rank={i + 1}
              option={o}
              original={version}
              snapshot={snapshot}
              recommended={o.combined_option_id === recommended}
              busy={busy}
              canApply={canApply}
              onApply={() => onApply(o)}
            />
          ))}
        </ol>
      )}
    </Card>
  );
}

function OptionCard({
  rank,
  option: o,
  original,
  snapshot,
  recommended,
  busy,
  canApply,
  onApply,
}: {
  rank: number;
  option: CombinedOption;
  original: PlanVersion;
  snapshot: EvidenceSnapshot | null;
  recommended: boolean;
  busy: boolean;
  canApply: boolean;
  onApply: () => void;
}) {
  const problems = sortChecks(o.checks.checks).filter((c) => c.critical && c.status !== "pass");
  const p = o.plan;
  return (
    <li className={`flex flex-col rounded-xl border p-4 ${recommended ? "border-emerald-600 ring-1 ring-emerald-600" : "border-stone-200"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-stone-900 text-xs font-semibold text-white">{rank}</span>
        {recommended && <Pill tone="success">★ Recommended</Pill>}
        <span className="ml-auto">
          <CheckStatusPill status={o.checks.overall} label={`Checks: ${o.checks.overall}`} />
        </span>
      </div>

      <p className="mt-3 text-sm font-medium text-stone-900">
        {parkName(snapshot, p.park_id)} · {formatLocal(p.start_time)}
      </p>
      <p className="text-sm text-stone-600">
        {templateName(snapshot, p.workout_template_id)}
        {p.adaptation_ids.length > 0 && ` · ${p.adaptation_ids.map((a) => adaptationName(snapshot, p.workout_template_id, a)).join("; ")}`}
      </p>

      {o.changes_from_original.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-stone-500">Changes from v{original.version}</h4>
          <ul className="mt-1 space-y-1 text-sm">
            {o.changes_from_original.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-1.5">
                <span className="font-medium text-stone-800">{FIELD_LABEL[c.field]}:</span>
                <span className="text-stone-500 line-through decoration-stone-400">{changeValue(c, c.from, snapshot, p.workout_template_id)}</span>
                <span aria-label="becomes">→</span>
                <span className="text-stone-900">{changeValue(c, c.to, snapshot, p.workout_template_id)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {problems.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-stone-500">Not resolved yet</h4>
          <ul className="mt-1 space-y-1">
            {problems.map((c) => (
              <li key={c.check_id} className="flex gap-2 text-sm">
                <CheckStatusPill status={c.status} />
                <span className="text-stone-700">
                  {checkName(c.check_id)}: {c.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {o.unknowns.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-amber-900">
          {o.unknowns.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      )}

      {o.tradeoffs.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-sm text-stone-600">
          {o.tradeoffs.map((t, i) => (
            <li key={i}>⚖ {t}</li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-4">
        <Button variant={recommended ? "primary" : "secondary"} disabled={busy || !canApply} onClick={onApply} className="w-full">
          Use this option
        </Button>
        {o.checks.overall === "fail" && (
          <p className="mt-1.5 text-xs text-rose-700">This option still fails a critical check, so it can&apos;t be approved as is.</p>
        )}
      </div>
    </li>
  );
}

function reviewStatus(s: NonNullable<PlanVersion["alternatives"]>["status"]) {
  return { draft: "Ready to compare", revision_requested: "Revision requested", needs_verification: "Needs checking", no_feasible_option: "No workable option" }[s];
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
