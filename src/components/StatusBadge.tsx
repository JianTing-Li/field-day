import type { LifecycleStatus } from "@/contracts";
import { STATUS } from "./format";

const TONE: Record<string, string> = {
  neutral: "bg-lavender text-ink",
  warning: "bg-butter text-ink",
  info: "bg-cool text-ink",
  success: "bg-mint text-ink",
  final: "bg-ink text-cream",
  danger: "bg-danger text-ink",
};

/** A lifecycle status in words. Color only reinforces the text. */
export function StatusBadge({ status }: { status: LifecycleStatus }) {
  const s = STATUS[status];
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
