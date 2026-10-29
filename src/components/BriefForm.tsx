"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Api, type FieldDayEvent } from "@/contracts";
import { apiGet, apiSend } from "./api-client";
import { todayInNewYork } from "./format";
import {
  EMPTY_FORM,
  dateHint,
  equipmentLabel,
  fromBrief,
  toBrief,
  type BriefErrors,
  type BriefField,
  type BriefFormValues,
} from "./brief-form";
import { StatusBadge } from "./StatusBadge";
import { Alert, buttonClass, fieldClass } from "./ui";

/** Event brief form for creating (POST /api/events) and editing (PUT /api/events/:id/brief). Task YT-08. */

export interface ParkOption {
  id: string;
  name: string;
  borough: string;
}

export interface TemplateOption {
  id: string;
  name: string;
  duration_minutes: number;
  equipment: string[];
  reviewed: boolean;
}

type Props = { parks: ParkOption[]; templates: TemplateOption[] } & (
  | { mode: "create" }
  | { mode: "edit"; eventId: string }
);

const FIELD_ORDER: BriefField[] = [
  "title",
  "date",
  "duration_minutes",
  "group_size",
  "earliest",
  "latest",
  "allowed_park_ids",
  "preferred_park_id",
  "workout_template_id",
  "other_equipment",
  "max_temperature_f",
  "max_aqi",
];

const LABELS: Partial<Record<BriefField, string>> = {
  title: "Event name",
  date: "Date",
  duration_minutes: "Length",
  group_size: "Group size",
  earliest: "Earliest start",
  latest: "Latest start",
  allowed_park_ids: "Allowed parks",
  preferred_park_id: "Favorite park",
  workout_template_id: "Workout",
  other_equipment: "Other equipment",
  max_temperature_f: "Max temperature",
  max_aqi: "Max air quality (AQI)",
};

export function BriefForm(props: Props) {
  const router = useRouter();
  const [values, setValues] = useState<BriefFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<BriefErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [event, setEvent] = useState<FieldDayEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // Read in the browser only, so a pre-rendered page never carries a stale "today".
  const today = useSyncExternalStore(noSubscribe, todayInNewYork, () => null);

  const knownEquipment = [...new Set(props.templates.flatMap((t) => t.equipment))].sort();
  const editId = props.mode === "edit" ? props.eventId : null;

  useEffect(() => {
    if (editId === null) return;
    let live = true;
    apiGet(`/api/events/${encodeURIComponent(editId)}`, Api.getEvent.response).then((r) => {
      if (!live) return;
      if (!r.ok) return setLoadError(r.message);
      setEvent(r.data.event);
      const loaded = fromBrief(r.data.event.brief, knownEquipment);
      setValues(loaded);
      setMoreOpen(MORE_FIELDS.some((f) => hasValue(loaded[f])));
    });
    return () => {
      live = false;
    };
    // knownEquipment comes from props that don't change after the page loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Parks in an existing brief that aren't in the curated list (e.g. fixture parks) stay selectable.
  const parks: ParkOption[] = [
    ...props.parks,
    ...values.allowed_park_ids
      .filter((id) => !props.parks.some((p) => p.id === id))
      .map((id) => ({ id, name: `${id} (not in the park list)`, borough: "Other" })),
  ];
  const parkName = (id: string) => parks.find((p) => p.id === id)?.name ?? id;

  const set = <K extends BriefField>(field: K, value: BriefFormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const toggle = (field: "allowed_park_ids" | "equipment", id: string) => {
    const current = values[field];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    set(field, next);
    // Unchecking the preferred park clears the preference instead of leaving an invalid choice.
    if (field === "allowed_park_ids" && !next.includes(values.preferred_park_id)) set("preferred_park_id", "");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    // A saved past date can stay when editing; a new or changed date must be today or later.
    const checkDate = props.mode === "create" || values.date !== event?.brief.date;
    const r = toBrief(values, checkDate ? todayInNewYork() : undefined);
    if (!r.ok) {
      setErrors(r.errors);
      if (MORE_FIELDS.some((f) => r.errors[f])) setMoreOpen(true);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setErrors({});
    setSaving(true);
    const res =
      props.mode === "create"
        ? await apiSend("POST", Api.createEvent.path, { brief: r.brief }, Api.createEvent.response)
        : await apiSend(
            "PUT",
            `/api/events/${encodeURIComponent(props.eventId)}/brief`,
            { brief: r.brief, based_on_version: event?.current_version },
            Api.updateBrief.response,
          );
    setSaving(false);
    if (res.ok) {
      router.push(`/events/${encodeURIComponent(res.data.event.id)}`);
      return;
    }
    setServerError(
      res.code === "stale_version"
        ? "This event changed since you opened it, so nothing was saved. Reload the page to edit the latest version."
        : `${res.message}. Nothing was saved.`,
    );
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  if (loadError) {
    return (
      <Alert tone="danger" role="alert" title="This event could not be loaded.">
        <p>{loadError}.</p>
        <Link href="/" className={buttonClass("surface", "mt-3")}>
          Back to events
        </Link>
      </Alert>
    );
  }
  if (props.mode === "edit" && !event) {
    return <p role="status" className="text-sm text-ink-2">Loading the event brief…</p>;
  }

  const errorList = FIELD_ORDER.filter((f) => errors[f]);
  const template = props.templates.find((t) => t.id === values.workout_template_id);

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {event && (
        <div className="clay flex flex-wrap items-center gap-3 rounded-surface bg-cool px-6 py-5 text-sm text-ink">
          <StatusBadge status={event.versions.find((v) => v.version === event.current_version)?.status ?? "draft"} />
          <span>
            Editing the brief of <strong>v{event.current_version}</strong>. Saving creates{" "}
            <strong>v{event.current_version + 1}</strong> as a new draft: any approval and organizer confirmations are
            cleared, and you draft a new plan from the updated brief.
          </span>
        </div>
      )}

      {(errorList.length > 0 || serverError) && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="clay focus-ring rounded-surface bg-danger px-6 py-5 text-ink">
          {serverError ? (
            <p className="font-bold">{serverError}</p>
          ) : (
            <>
              <p className="font-bold">Fix {errorList.length === 1 ? "this field" : `these ${errorList.length} fields`} to continue:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {errorList.map((f) => (
                  <li key={f}>
                    <a href={`#field-${f}`} className="underline">
                      {LABELS[f]}
                    </a>
                    : {errors[f]}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <Section
        title="The event"
        tag="Required"
        hint="Name, date, group size, start window and parks are all FieldDay needs to draft a plan."
      >
        <Field id="title" label="Event name" error={errors.title} className="sm:col-span-2">
          <input
            id="field-title"
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Saturday bootcamp"
            className={input(errors.title)}
            {...describedBy("title", errors.title)}
          />
        </Field>
        <Field id="date" label="Date" error={errors.date}>
          <input
            id="field-date"
            type="date"
            min={props.mode === "create" && today ? today : undefined}
            value={values.date}
            onChange={(e) => set("date", e.target.value)}
            className={input(errors.date)}
            {...describedBy("date", errors.date)}
          />
          {!errors.date && today && dateHint(values.date, today) && (
            <p className="mt-2 text-xs text-ink-2">ℹ {dateHint(values.date, today)}</p>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="group_size" label="Group size" error={errors.group_size}>
            <input
              id="field-group_size"
              type="number"
              inputMode="numeric"
              min={1}
              value={values.group_size}
              onChange={(e) => set("group_size", e.target.value)}
              placeholder="e.g. 15"
              className={input(errors.group_size)}
              {...describedBy("group_size", errors.group_size)}
            />
          </Field>
          <Field id="duration_minutes" label="Length (min)" error={errors.duration_minutes}>
            <input
              id="field-duration_minutes"
              type="number"
              inputMode="numeric"
              min={1}
              step={5}
              value={values.duration_minutes}
              onChange={(e) => set("duration_minutes", e.target.value)}
              className={input(errors.duration_minutes)}
              {...describedBy("duration_minutes", errors.duration_minutes)}
            />
          </Field>
        </div>
      </Section>

      <Section title="When can it start?" tag="Required" hint="FieldDay picks the best start time inside this window. New York time.">
        <div className="flex flex-wrap gap-2 sm:col-span-2" role="group" aria-label="Quick start windows">
          {START_PRESETS.map((p) => {
            const active = values.earliest === p.earliest && values.latest === p.latest;
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  set("earliest", p.earliest);
                  set("latest", p.latest);
                }}
                className={`focus-ring rounded-control px-4 py-2 text-sm font-bold text-ink ${active ? "clay-recessed bg-mint" : "clay-sm bg-cream"}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <Field id="earliest" label="Earliest start" error={errors.earliest}>
          <input
            id="field-earliest"
            type="time"
            value={values.earliest}
            onChange={(e) => set("earliest", e.target.value)}
            className={input(errors.earliest)}
            {...describedBy("earliest", errors.earliest)}
          />
        </Field>
        <Field id="latest" label="Latest start" error={errors.latest}>
          <input
            id="field-latest"
            type="time"
            value={values.latest}
            onChange={(e) => set("latest", e.target.value)}
            className={input(errors.latest)}
            {...describedBy("latest", errors.latest)}
          />
        </Field>
      </Section>

      <Section title="Where?" tag="Required" hint="Pick every park you'd be happy with. FieldDay only considers these.">
        <fieldset id="field-allowed_park_ids" className="sm:col-span-2" {...describedBy("allowed_park_ids", errors.allowed_park_ids)}>
          <legend className="text-sm font-bold text-ink">
            Parks{" "}
            <span className="font-normal text-ink-2">
              ({values.allowed_park_ids.length === 0 ? "none chosen yet" : `${values.allowed_park_ids.length} chosen`})
            </span>
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {parks.map((p) => (
              <label
                key={p.id}
                className={`clay-sm flex cursor-pointer items-center gap-3 rounded-disclosure bg-cream px-4 py-2.5 text-sm has-[:checked]:clay-recessed has-[:checked]:bg-mint has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ink ${errors.allowed_park_ids ? "ring-2 ring-danger-ink" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={values.allowed_park_ids.includes(p.id)}
                  onChange={() => toggle("allowed_park_ids", p.id)}
                  className="h-4 w-4 accent-ink"
                />
                <span>
                  <span className="block font-bold text-ink">{p.name}</span>
                  <span className="block text-xs text-ink-2">{p.borough}</span>
                </span>
              </label>
            ))}
          </div>
          <FieldError id="allowed_park_ids" error={errors.allowed_park_ids} />
        </fieldset>
        {values.allowed_park_ids.length > 1 && (
          <Field id="preferred_park_id" label="Favorite park (optional)" error={errors.preferred_park_id}>
            <select
              id="field-preferred_park_id"
              value={values.preferred_park_id}
              onChange={(e) => set("preferred_park_id", e.target.value)}
              className={input(errors.preferred_park_id)}
              {...describedBy("preferred_park_id", errors.preferred_park_id)}
            >
              <option value="">No favorite</option>
              {values.allowed_park_ids.map((id) => (
                <option key={id} value={id}>
                  {parkName(id)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </Section>

      <details
        open={moreOpen}
        onToggle={(e) => setMoreOpen(e.currentTarget.open)}
        className="group clay rounded-surface bg-cream"
      >
        <summary className="focus-ring flex cursor-pointer list-none items-center gap-3 rounded-surface p-6 sm:p-8 [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="clay-recessed grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ground text-lg leading-none">
            <span className="group-open:hidden">+</span>
            <span className="hidden group-open:inline">−</span>
          </span>
          <span>
            <span className="block text-xl font-bold tracking-tight text-ink">
              More options <Tag>Optional</Tag>
            </span>
            <span className="mt-1 block text-sm text-ink-2">
              Workout, equipment, safety limits and priorities. FieldDay uses sensible defaults if you skip these.
            </span>
          </span>
        </summary>
        <div className="space-y-6 px-4 pb-6 sm:px-6 sm:pb-8">
          <Section title="Workout">
            <Field id="workout_template_id" label="Workout" error={errors.workout_template_id} className="sm:col-span-2">
              <select
                id="field-workout_template_id"
                value={values.workout_template_id}
                onChange={(e) => set("workout_template_id", e.target.value)}
                className={input(errors.workout_template_id)}
              >
                <option value="">Let FieldDay choose</option>
                {props.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.duration_minutes} min
                    {t.equipment.length ? ` · needs ${t.equipment.map(equipmentLabel).join(", ").toLowerCase()}` : ""}
                  </option>
                ))}
              </select>
              {template && !template.reviewed && (
                <p className="mt-2 text-xs font-bold text-ink">⚠ This workout hasn&apos;t been reviewed by an instructor yet.</p>
              )}
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-bold text-ink">Equipment you have</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {knownEquipment.map((id) => (
                  <label
                    key={id}
                    className="clay-sm flex cursor-pointer items-center gap-2 rounded-control bg-cream px-4 py-2 text-sm has-[:checked]:clay-recessed has-[:checked]:bg-mint has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ink"
                  >
                    <input
                      type="checkbox"
                      checked={values.equipment.includes(id)}
                      onChange={() => toggle("equipment", id)}
                      className="h-4 w-4 accent-ink"
                    />
                    {equipmentLabel(id)}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field id="other_equipment" label="Other equipment (comma-separated)" error={errors.other_equipment} className="sm:col-span-2">
              <input
                id="field-other_equipment"
                value={values.other_equipment}
                onChange={(e) => set("other_equipment", e.target.value)}
                placeholder="e.g. cones, jump ropes"
                className={input(errors.other_equipment)}
              />
            </Field>
            <Field id="exercise_exclusions" label="Exercises to avoid (one per line)" className="sm:col-span-2">
              <textarea
                id="field-exercise_exclusions"
                rows={2}
                value={values.exercise_exclusions}
                onChange={(e) => set("exercise_exclusions", e.target.value)}
                placeholder="e.g. Burpees"
                className={input(undefined, true)}
              />
            </Field>
          </Section>

          <Section
            title="Safety limits"
            hint="Leave blank to use FieldDay's defaults: 90°F and AQI 100. You can only make them stricter."
          >
            <Field id="max_temperature_f" label="Max temperature (°F)" error={errors.max_temperature_f}>
              <input
                id="field-max_temperature_f"
                type="number"
                inputMode="decimal"
                value={values.max_temperature_f}
                onChange={(e) => set("max_temperature_f", e.target.value)}
                placeholder="Default 90"
                className={input(errors.max_temperature_f)}
                {...describedBy("max_temperature_f", errors.max_temperature_f)}
              />
            </Field>
            <Field id="max_aqi" label="Max air quality (AQI)" error={errors.max_aqi}>
              <input
                id="field-max_aqi"
                type="number"
                inputMode="numeric"
                min={0}
                value={values.max_aqi}
                onChange={(e) => set("max_aqi", e.target.value)}
                placeholder="Default 100"
                className={input(errors.max_aqi)}
                {...describedBy("max_aqi", errors.max_aqi)}
              />
              <p className="mt-2 text-xs text-ink-2">Above 100, the air starts to be unhealthy for sensitive people.</p>
            </Field>
            <Field id="limit_notes" label="Notes for the instructor" className="sm:col-span-2">
              <textarea
                id="field-limit_notes"
                rows={2}
                value={values.limit_notes}
                onChange={(e) => set("limit_notes", e.target.value)}
                className={input(undefined, true)}
              />
            </Field>
          </Section>

          <Section title="Priorities" hint="If two options are equally safe, FieldDay picks the one that fits these best.">
            <Field id="priorities" label="One per line, most important first" className="sm:col-span-2">
              <textarea
                id="field-priorities"
                rows={2}
                value={values.priorities}
                onChange={(e) => set("priorities", e.target.value)}
                placeholder={"e.g. Keep the same park\nStart as early as possible"}
                className={input(undefined, true)}
              />
            </Field>
          </Section>
        </div>
      </details>

      <div className="sticky bottom-3 z-10">
        <div className="clay flex flex-wrap items-center gap-4 rounded-control bg-cream px-4 py-3">
          <button type="submit" disabled={saving} className={buttonClass("primary", "px-7 py-3 text-base disabled:cursor-wait")}>
            {saving ? "Saving…" : props.mode === "create" ? "Create event" : `Save as v${(event?.current_version ?? 0) + 1}`}
          </button>
          <Link
            href={props.mode === "edit" ? `/events/${encodeURIComponent(props.eventId)}` : "/"}
            className={buttonClass("ghost")}
          >
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}

const input = fieldClass;

function describedBy(field: BriefField, error?: string) {
  return error ? { "aria-invalid": true, "aria-describedby": `error-${field}` } : {};
}

/** Fields inside "More options"; an error in one of them opens it. */
const MORE_FIELDS: BriefField[] = [
  "workout_template_id",
  "other_equipment",
  "exercise_exclusions",
  "max_temperature_f",
  "max_aqi",
  "limit_notes",
  "priorities",
];

const noSubscribe = () => () => {};

const hasValue = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "");

const START_PRESETS = [
  { label: "Early morning · 6–8 AM", earliest: "06:00", latest: "08:00" },
  { label: "Morning · 8–10 AM", earliest: "08:00", latest: "10:00" },
  { label: "Midday · 11 AM–1 PM", earliest: "11:00", latest: "13:00" },
  { label: "Evening · 5–7 PM", earliest: "17:00", latest: "19:00" },
];

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1 inline-block rounded-control bg-ground px-2 py-0.5 align-middle text-xs font-bold tracking-normal text-ink-2">
      {children}
    </span>
  );
}

function Section({ title, tag, hint, children }: { title: string; tag?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="clay rounded-surface bg-cream p-6 sm:p-8">
      <h2 className="text-xl font-bold tracking-tight text-ink">
        {title}
        {tag && <Tag>{tag}</Tag>}
      </h2>
      {hint && <p className="mt-1 text-sm text-ink-2">{hint}</p>}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  error,
  className = "",
  children,
}: {
  id: BriefField;
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={`field-${id}`} className="mb-2 block text-sm font-bold text-ink">
        {label}
      </label>
      {children}
      <FieldError id={id} error={error} />
    </div>
  );
}

function FieldError({ id, error }: { id: BriefField; error?: string }) {
  if (!error) return null;
  return (
    <p id={`error-${id}`} className="mt-1.5 text-sm font-bold text-danger-ink">
      {error}
    </p>
  );
}
