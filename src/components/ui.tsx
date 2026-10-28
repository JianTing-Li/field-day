import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Shared UI building blocks (owner: Yadan). Screens use these instead of repeating class strings,
 * so the design-system pass can restyle the whole app from here.
 */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-emerald-800 text-white hover:bg-emerald-700 focus-visible:outline-emerald-800",
  secondary: "bg-white text-stone-800 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus-visible:outline-emerald-800",
  danger: "bg-rose-800 text-white hover:bg-rose-700 focus-visible:outline-rose-800",
  ghost: "text-stone-700 hover:bg-stone-100 focus-visible:outline-emerald-800",
};

export function buttonClass(variant: ButtonVariant = "secondary", extra = "") {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON[variant]} ${extra}`;
}

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

export function Card({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-5 sm:p-6 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-stone-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-stone-600">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "info" | "warning" | "danger" | "success" | "neutral";

const ALERT: Record<Tone, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  danger: "border-rose-200 bg-rose-50 text-rose-950",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  neutral: "border-stone-200 bg-stone-50 text-stone-800",
};

export function Alert({
  tone = "info",
  title,
  children,
  role,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  role?: "alert" | "status" | "note";
}) {
  return (
    <div role={role} className={`rounded-xl border p-4 text-sm ${ALERT[tone]}`}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

/** Small label, e.g. "Forecast" or "Fixture". */
export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const t: Record<Tone, string> = {
    info: "bg-sky-50 text-sky-800 ring-sky-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
    danger: "bg-rose-50 text-rose-800 ring-rose-200",
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    neutral: "bg-stone-100 text-stone-700 ring-stone-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${t[tone]}`}>
      {children}
    </span>
  );
}
