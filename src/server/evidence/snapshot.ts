import { createHash } from "node:crypto";
import { z } from "zod";
import {
  WorkoutTemplate,
  type AdapterResult,
  type ConditionsRequest,
  type DataMode,
  type EventBrief,
  type EvidenceItem,
  type EvidenceSnapshot,
  type FetchAirQuality,
  type FetchForecast,
  type ParkCandidate,
  type ParkTimeCandidate,
} from "@/contracts";
import workouts from "@/server/content/workouts.json";
import { fetchAirQuality } from "@/server/data/air";
import { dataMode } from "@/server/data/mode";
import { fetchParkRecords, getCuratedParks } from "@/server/data/parks";
import { fetchForecast } from "@/server/data/weather";
import { fromLocalDateTime } from "@/server/time";
import { addMinutes } from "./coverage";
import { assessFreshness } from "./freshness";

/**
 * Evidence snapshot builder (owner: JT, task JT-03). Gathers parks, conditions and
 * templates for one event version, assesses freshness and coverage, and records gaps.
 * Only the harness calls this; agent tools read the snapshot it returns and never fetch.
 *
 * Freshness: in live mode every item's age is measured against the snapshot's creation time.
 * Recorded fixture responses are months old by design, so in fixture mode each item is assessed
 * at its own recording time and labeled that way; fixture evidence never supports real-world
 * finalization (PRD §3 "Validation Policies").
 */

/** Minutes between candidate start times inside the organizer's start window. */
export const CANDIDATE_STEP_MINUTES = 30;

export interface SnapshotDeps {
  mode?: DataMode;
  now?: () => Date;
  fetchForecast?: FetchForecast;
  fetchAirQuality?: FetchAirQuality;
  fetchParkRecords?: (mode: DataMode) => Promise<AdapterResult>;
  /** Curated parks; defaults to content/parks.json. */
  parks?: ParkCandidate[];
  /** Workout templates; defaults to content/workouts.json. */
  templates?: WorkoutTemplate[];
}

const FIXTURE_NOTE = "Fixture data: assessed at its recording time, not against the current time";

export async function buildSnapshot(
  args: { event_id: string; event_version: number; brief: EventBrief },
  deps: SnapshotDeps = {},
): Promise<EvidenceSnapshot> {
  const { event_id, event_version, brief } = args;
  const mode = deps.mode ?? dataMode();
  const createdAt = (deps.now ?? (() => new Date()))().toISOString();
  const curated = deps.parks ?? (await getCuratedParks());
  const templates = deps.templates ?? z.array(WorkoutTemplate).parse(workouts);
  const gaps: string[] = [];

  // Parks: only the organizer's allowed parks, and only those with a reviewed coordinate get conditions.
  for (const id of brief.allowed_park_ids) {
    if (!curated.some((p) => p.id === id)) gaps.push(`Park ${id} is not a curated park, so FieldDay has no record for it`);
  }
  const parks = curated.filter((p) => brief.allowed_park_ids.includes(p.id));
  const located = parks.filter((p) => p.location !== null);
  for (const p of parks) {
    if (p.location === null) gaps.push(`${p.id} has no reviewed coordinate, so weather and AQI cannot be looked up for it`);
  }

  const parkRecords = await (deps.fetchParkRecords ?? ((m: DataMode) => fetchParkRecords(m)))(mode);
  const allowedIds = new Set(parks.map((p) => p.id));
  const parkItems = parkRecords.items.filter((e) => e.applies_to.park_id !== null && allowedIds.has(e.applies_to.park_id));
  gaps.push(...parkRecords.coverage_gaps);

  // Candidates: every allowed start time, every located park.
  const starts = startTimes(brief);
  const park_time_candidates: ParkTimeCandidate[] = located.flatMap((p) =>
    starts.map((start_time) => ({
      id: `cand-${p.id}-${start_time.slice(11).replace(":", "")}`,
      park_id: p.id,
      start_time,
      end_time: addMinutes(start_time, brief.duration_minutes),
    })),
  );

  // Conditions cover every candidate, including the longest permitted adaptation.
  const longestExtra = Math.max(0, ...templates.flatMap((t) => t.permitted_adaptations.map((a) => a.duration_delta_minutes)));
  const windowStart = starts[0];
  const windowEnd = addMinutes(starts[starts.length - 1], brief.duration_minutes + longestExtra);
  const forecastFn = deps.fetchForecast ?? fetchForecast;
  const airFn = deps.fetchAirQuality ?? fetchAirQuality;
  const conditions = await Promise.all(
    located.map(async (p) => {
      const req: ConditionsRequest = {
        park_id: p.id,
        lat: p.location!.lat,
        lon: p.location!.lon,
        start_time: windowStart,
        end_time: windowEnd,
      };
      const [weather, air] = await Promise.all([forecastFn(req, mode), airFn(req, mode)]);
      return { items: [...weather.items, ...air.items], gaps: [...weather.coverage_gaps, ...air.coverage_gaps] };
    }),
  );
  const conditionItems = conditions.flatMap((c) => c.items);
  gaps.push(...conditions.flatMap((c) => c.gaps));

  const items = uniqueIds([...parkItems, ...templateItems(templates, mode, createdAt), ...conditionItems]).map((e) => ({
    ...e,
    freshness:
      mode === "fixture" ? assessFreshness(e, e.retrieved_at, FIXTURE_NOTE) : assessFreshness(e, createdAt),
  }));

  const body = {
    event_id,
    event_version,
    origin: mode,
    park_candidates: parks,
    park_time_candidates,
    workout_templates: templates,
    items,
    coverage_gaps: [...new Set(gaps)],
  };
  return { id: snapshotId(body), created_at: createdAt, ...body };
}

/** Start times from the window's earliest to latest (inclusive), every CANDIDATE_STEP_MINUTES. */
export function startTimes(brief: EventBrief): string[] {
  const first = `${brief.date}T${brief.start_window.earliest}`;
  const lastMs = fromLocalDateTime(`${brief.date}T${brief.start_window.latest}`).getTime();
  const out: string[] = [];
  for (let t = first; fromLocalDateTime(t).getTime() <= lastMs; t = addMinutes(t, CANDIDATE_STEP_MINUTES)) out.push(t);
  return out;
}

function templateItems(templates: WorkoutTemplate[], mode: DataMode, retrievedAt: string): EvidenceItem[] {
  return templates.map((t) => ({
    id: t.evidence_id,
    metric: "workout_template",
    evidence_type: "reference",
    origin: mode,
    source: { name: "FieldDay templates", url: null, record_id: t.id },
    value: t.name,
    unit: null,
    category: null,
    pollutant: null,
    missing_reason: null,
    retrieved_at: retrievedAt,
    valid_from: null,
    valid_to: null,
    applies_to: { scope: "event", park_id: null, area_label: null },
    freshness: { status: "unknown", assessed_at: null, note: null },
    limitations: [
      "A template is not individualized medical clearance",
      ...(t.review.status === "reviewed" ? [] : ["Not yet reviewed by an instructor"]),
    ],
    confirms_check_id: null,
  }));
}

/**
 * Two parks in the same NWS grid or AirNow reporting area get the same provider record, so an
 * ID can repeat. The repeat gets its park ID appended so every snapshot ID is unique.
 */
function uniqueIds(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  return items.map((e) => {
    let id = e.id;
    if (seen.has(id)) id = `${e.id}-${e.applies_to.park_id ?? "event"}`;
    for (let n = 2; seen.has(id); n++) id = `${e.id}-${e.applies_to.park_id ?? "event"}-${n}`;
    seen.add(id);
    return id === e.id ? e : { ...e, id };
  });
}

/**
 * Content-based ID: the same evidence for the same event version gives the same ID, so a recheck
 * with unchanged evidence leaves the plan as it is (D-016). Live data has new retrieval times on
 * every fetch, so a live recheck always gets a new ID.
 */
function snapshotId(body: Omit<EvidenceSnapshot, "id" | "created_at">): string {
  // Freshness depends on when the snapshot was built, and template records are read at build
  // time; neither is a change in the evidence itself.
  const items = body.items.map((e) => ({
    ...e,
    freshness: undefined,
    retrieved_at: e.metric === "workout_template" ? undefined : e.retrieved_at,
  }));
  const hash = createHash("sha256").update(JSON.stringify({ ...body, items })).digest("hex").slice(0, 12);
  return `snap-${body.event_id}-v${body.event_version}-${hash}`;
}
