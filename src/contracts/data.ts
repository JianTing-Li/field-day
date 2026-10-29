import { z } from "zod";
import { DataOrigin, Id, LocalDateTime } from "./common";
import type { EvidenceItem } from "./evidence";

/**
 * Data adapter contracts (NYC Parks, NWS, AirNow). Adapters run in the harness only.
 * Every adapter supports fixture and live mode behind the same function.
 */

export const DataMode = DataOrigin;
export type DataMode = z.infer<typeof DataMode>;

export const ConditionsRequest = z.object({
  park_id: Id,
  lat: z.number(),
  lon: z.number(),
  start_time: LocalDateTime,
  end_time: LocalDateTime,
});
export type ConditionsRequest = z.infer<typeof ConditionsRequest>;

/** Adapters never throw on provider failure: they return items plus explicit gaps. */
export interface AdapterResult {
  origin: DataMode;
  items: EvidenceItem[];
  coverage_gaps: string[];
}

/** Implemented by src/server/data/weather.ts (NWS). */
export type FetchForecast = (req: ConditionsRequest, mode: DataMode) => Promise<AdapterResult>;

/** Implemented by src/server/data/air.ts (AirNow). */
export type FetchAirQuality = (req: ConditionsRequest, mode: DataMode) => Promise<AdapterResult>;
