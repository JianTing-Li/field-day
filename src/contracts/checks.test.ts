import { describe, expect, it } from "vitest";
import { isWaitingOnForecast } from "./checks";

const c = (check_id: string, status: "pass" | "fail" | "unknown", critical = true) => ({ check_id, status, critical }) as never;

describe("isWaitingOnForecast (D-JT25-2)", () => {
  it("is true when nothing fails and the weather or air quality is unknown", () => {
    expect(isWaitingOnForecast({ checks: [c("heat.max_temperature", "unknown"), c("space_surface.space", "unknown")] })).toBe(true);
  });
  it("is false when something fails, or only organizer checks are open", () => {
    expect(isWaitingOnForecast({ checks: [c("heat.max_temperature", "unknown"), c("weather.rain", "fail")] })).toBe(false);
    expect(isWaitingOnForecast({ checks: [c("space_surface.space", "unknown")] })).toBe(false);
    expect(isWaitingOnForecast(null)).toBe(false);
  });
});
