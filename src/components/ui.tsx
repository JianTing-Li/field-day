import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Shared UI building blocks (owner: Yadan), styled with the Claymorphism UI system (globals.css).
 * Screens use these instead of repeating class strings, so the look changes in one place.
 */

type ButtonVariant = "primary" | "secondary" | "surface" | "danger" | "ghost";

const BUTTON: Record<ButtonVariant, string> = {
  // Thick molded pills. "surface" is the cream pill used on top of pink areas.
  primary: "clay-control bg-accent text-ink",
  secondary: "clay-control bg-cream text-ink",
  surface: "clay-control bg-cream text-ink",
  danger: "clay-control bg-accent text-ink",
  // Plain text action beside a primary button.
  ghost: "text-ink underline-offset-4 hover:underline",
};

export function buttonClass(variant: ButtonVariant = "secondary", extra = "") {
  return `focus-ring inline-flex items-center justify-center gap-1.5 rounded-control px-5 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-55 ${BUTTON[variant]} ${extra}`;
}

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

/** A cream cushion holding one group of content. */
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
    <section className={`clay rounded-surface bg-cream p-6 sm:p-8 ${className}`}>
      {(title || actions) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-xl font-bold tracking-tight text-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "info" | "warning" | "danger" | "success" | "neutral";

/** Pastel cushion per tone; meaning always comes from the words, never color alone. */
export const TONE_BG: Record<Tone, string> = {
  info: "bg-cool",
  warning: "bg-butter",
  danger: "bg-accent",
  success: "bg-mint",
  neutral: "bg-lavender",
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
    <div role={role} className={`clay rounded-surface px-6 py-5 text-sm text-ink ${TONE_BG[tone]}`}>
      {title && <p className="text-base font-bold">{title}</p>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

/** Small label, e.g. "Forecast" or "Fixture". */
export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`clay-sm inline-flex items-center rounded-control px-2.5 py-0.5 text-xs font-bold text-ink ${TONE_BG[tone]}`}>
      {children}
    </span>
  );
}

/** Recessed text fields: pills for one line, softer corners for multi-line. Errors add a plum ring. */
export function fieldClass(error?: boolean | string | null, multiline = false) {
  return `clay-recessed focus-ring block w-full bg-ground px-4 py-2.5 text-sm text-ink placeholder:text-ink-2/60 disabled:opacity-55 ${
    multiline ? "rounded-disclosure" : "rounded-control"
  } ${error ? "ring-2 ring-danger-ink" : ""}`;
}
