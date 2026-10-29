import type { CombinedOption, EvidenceSnapshot, PlanChange, PlanVersion } from "@/contracts";
import { Alert, Button, Pill } from "../ui";
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
    <section id="alternatives" className="clay scroll-mt-24 rounded-surface bg-lavender p-6 sm:p-8 md:rounded-tray md:p-10">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-ink">Alternatives</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">
            Ranked by the reviewer. Picking one creates a new draft version, which is checked again before you can
            approve it.
          </p>
        </div>
        <Pill tone={review.status === "draft" ? "success" : "warning"}>{reviewStatus(review.status)}</Pill>
      </div>
      {review.blocking_issues.length > 0 && (
        <div className="mb-5">
          <Alert tone="warning" title="Still unresolved">
            <ul className="list-disc space-y-0.5 pl-5">
              {review.blocking_issues.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      <p className="mb-5 text-sm text-ink">
        {review.recommendation ? (
          <>
            <strong className="font-bold">Recommendation:</strong> {review.recommendation.reason}
          </>
        ) : (
          "No option is recommended yet: each one still has something unconfirmed. Compare them and confirm what you can."
        )}
      </p>
      {review.ranked_options.length === 0 ? (
        <p className="text-sm text-ink">The reviewer found no workable option.</p>
      ) : (
        <ol className="space-y-5">
          {review.ranked_options.map((o, i) => (
            <OptionShelf
              key={o.combined_option_id}
              rank={i + 1}
              option={o}
              snapshot={snapshot}
              recommended={o.combined_option_id === recommended}
              busy={busy}
              canApply={canApply}
              onApply={() => onApply(o)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

/** One broad horizontal shelf: identity, details, action. The recommended shelf is teal. */
function OptionShelf({
  rank,
  option: o,
  snapshot,
  recommended,
  busy,
  canApply,
  onApply,
}: {
  rank: number;
  option: CombinedOption;
  snapshot: EvidenceSnapshot | null;
  recommended: boolean;
  busy: boolean;
  canApply: boolean;
  onApply: () => void;
}) {
  const problems = sortChecks(o.checks.checks).filter((c) => c.critical && c.status !== "pass");
  const p = o.plan;
  return (
    <li
      className={`clay grid gap-5 rounded-surface p-5 sm:p-6 min-[1100px]:grid-cols-[minmax(12rem,15rem)_1fr_auto] min-[1100px]:items-start ${
        recommended ? "bg-accent" : "bg-cream"
      }`}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="clay-sm grid h-9 w-9 place-items-center rounded-full bg-cream text-sm font-bold text-ink">
            <span className="sr-only">Option </span>
            {rank}
          </span>
          {recommended && <Pill tone="success">★ Recommended</Pill>}
        </div>
        <p className="mt-3 text-lg leading-snug font-bold text-ink">{parkName(snapshot, p.park_id)}</p>
        <p className="text-sm text-ink">{formatLocal(p.start_time)}</p>
        <p className="mt-1 text-sm text-ink-2">
          {templateName(snapshot, p.workout_template_id)}
          {p.adaptation_ids.length > 0 &&
            ` · ${p.adaptation_ids.map((a) => adaptationName(snapshot, p.workout_template_id, a)).join("; ")}`}
        </p>
        <div className="mt-3">
          <CheckStatusPill status={o.checks.overall} label={`Checks: ${o.checks.overall}`} />
        </div>
      </div>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {o.changes_from_original.length > 0 && (
          <div>
            <h4 className="text-xs font-bold tracking-wide text-ink-2 uppercase">What changes</h4>
            <ul className="mt-1.5 space-y-1 text-sm">
              {o.changes_from_original.map((c, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-bold text-ink">{FIELD_LABEL[c.field]}:</span>
                  <span className="text-ink-2 line-through decoration-ink-2">
                    {changeValue(c, c.from, snapshot, p.workout_template_id)}
                  </span>
                  <span aria-label="becomes">→</span>
                  <span className="text-ink">{changeValue(c, c.to, snapshot, p.workout_template_id)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(problems.length > 0 || o.unknowns.length > 0) && (
          <div>
            <h4 className="text-xs font-bold tracking-wide text-ink-2 uppercase">Not resolved yet</h4>
            <ul className="mt-1.5 space-y-1.5">
              {problems.map((c) => (
                <li key={c.check_id} className="flex gap-2 text-sm">
                  <CheckStatusPill status={c.status} />
                  <span className="text-ink">
                    {checkName(c.check_id)}: {c.reason}
                  </span>
                </li>
              ))}
            </ul>
            {o.unknowns.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink">
                {o.unknowns.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {o.tradeoffs.length > 0 && (
          <ul className="space-y-0.5 text-sm text-ink-2 sm:col-span-2">
            {o.tradeoffs.map((t, i) => (
              <li key={i}>⚖ {t}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-[1100px]:w-44">
        <Button
          variant={recommended ? "surface" : "primary"}
          disabled={busy || !canApply}
          onClick={onApply}
          className="w-full"
        >
          Use this option
        </Button>
        {o.checks.overall === "fail" && (
          <p className="mt-2 text-xs font-bold text-ink">
            This option still fails a critical check, so it can&apos;t be approved as is.
          </p>
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
