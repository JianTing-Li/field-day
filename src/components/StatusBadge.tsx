import type { LifecycleStatus } from "@/contracts";
import { STATUS } from "./format";

const TONE: Record<string, string> = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-300",
  warning: "bg-amber-50 text-amber-800 ring-amber-300",
  info: "bg-sky-50 text-sky-800 ring-sky-300",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  final: "bg-emerald-800 text-white ring-emerald-900",
  danger: "bg-rose-50 text-rose-800 ring-rose-300",
};

/** A lifecycle status as icon + words. Color only reinforces the text. */
export function StatusBadge({ status }: { status: LifecycleStatus }) {
  const s = STATUS[status];
  return (
    <span
      title={s.hint}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONE[s.tone]}`}
    >
      <span aria-hidden="true">{s.icon}</span>
      {s.label}
    </span>
  );
}
