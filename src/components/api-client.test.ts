import { afterEach, describe, expect, it, vi } from "vitest";
import { Api } from "@/contracts";
import { apiGet, apiSend } from "./api-client";

const list = Api.listEvents;
const summary = {
  id: "evt-1",
  title: "Morning bootcamp",
  date: "2026-10-29",
  status: "draft",
  current_version: 1,
  finalized_version: null,
  updated_at: "2026-10-28T18:05:00Z",
};

function respondWith(status: number, body: unknown) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("apiGet", () => {
  it("returns data that matches the contract", async () => {
    respondWith(200, { events: [summary] });
    const r = await apiGet(list.path, list.response);
    expect(r).toEqual({ ok: true, data: { events: [summary] } });
  });

  it("rejects data in an unexpected shape instead of rendering it", async () => {
    respondWith(200, { events: [{ ...summary, status: "maybe" }] });
    const r = await apiGet(list.path, list.response);
    expect(r).toMatchObject({ ok: false, code: "bad_response" });
  });

  it("passes on the API's own error code and message", async () => {
    respondWith(409, { error: { code: "stale_version", message: "This event changed" } });
    const r = await apiGet(list.path, list.response);
    expect(r).toEqual({ ok: false, status: 409, code: "stale_version", message: "This event changed" });
  });

  it("handles an error page that isn't JSON", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>oops</html>", { status: 502 }));
    const r = await apiGet(list.path, list.response);
    expect(r).toMatchObject({ ok: false, status: 502, code: "bad_response" });
  });

  it("handles the server being unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const r = await apiGet(list.path, list.response);
    expect(r).toEqual({ ok: false, status: null, code: "network", message: "Could not reach the FieldDay server" });
  });
});
describe("apiSend", () => {
  it("sends JSON with the method and checks the response", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    });
    const r = await apiSend("POST", "/api/events", { hello: "world" }, list.response);
    expect(r).toEqual({ ok: true, data: { events: [] } });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe('{"hello":"world"}');
    expect(new Headers(calls[0].init.headers).get("Content-Type")).toBe("application/json");
  });
});
