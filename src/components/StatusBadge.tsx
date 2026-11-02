import type { LifecycleStatus } from "@/contracts";
import { FINALIZED_FORECAST_PENDING, STATUS, WAITING_ON_FORECAST } from "./format";

const TONE: Record<string, string> = {
  neutral: "bg-lavender text-ink",
  warning: "bg-butter text-ink",
  info: "bg-cool text-ink",
  success: "bg-mint text-ink",
  final: "bg-ink text-cream",
  danger: "bg-danger text-ink",
};

/** A lifecycle status in words. Color only reinforces the text. */
export function StatusBadge({ status, waiting = false }: { status: LifecycleStatus; waiting?: boolean }) {
  const s =
    waiting && status === "needs_verification"
      ? WAITING_ON_FORECAST
      : waiting && status === "finalized"
        ? FINALIZED_FORECAST_PENDING
        : STATUS[status];
  return (
    <span
      title={s.hint}
      className={`clay-sm inline-flex items-center gap-1.5 whitespace-nowrap rounded-control px-3 py-1 text-xs font-bold ${TONE[s.tone]}`}
    >
      {s.icon && <span aria-hidden="true">{s.icon}</span>}
      {s.label}
    </span>
  );
}
