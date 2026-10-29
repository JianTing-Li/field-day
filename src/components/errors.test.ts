import { describe, expect, it } from "vitest";
import { ApiError } from "@/contracts";
import { describeError, type ApiFailure } from "./errors";

const fail = (code: ApiFailure["code"], message = "Server said no"): ApiFailure => ({ ok: false, status: 400, code, message });

describe("describeError", () => {
  it("covers every API error code plus network and bad responses, and always says nothing was saved", () => {
    for (const code of [...ApiError.shape.error.shape.code.options, "network", "bad_response"] as const) {
      const v = describeError(fail(code));
      expect(v.title.length).toBeGreaterThan(0);
      if (code !== "not_found") expect(v.body).toContain("Nothing was saved");
    }
  });

  it("offers a reload, not a retry, when the event changed", () => {
    expect(describeError(fail("stale_version"))).toMatchObject({ reload: true, tone: "warning" });
    expect(describeError(fail("internal")).reload).toBe(false);
  });

  it("names the action that failed", () => {
    expect(describeError(fail("internal"), "Finalize").title).toBe("Finalize didn't work");
  });
});
