// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { testJQuantsConnection, fetchJQuantsQuotes, fetchJQuantsSeries } from "./jquantsClient";

// ※ APIキーはダミー値のみ。実 fetch はモック。
const DUMMY_KEY = "dummy-client-key";

function mockFetchOnce(json: unknown) {
  const fn = vi.fn().mockResolvedValue({ json: async () => json });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** 直近の fetch 呼び出しの body を JSON として取り出す。 */
function lastBody(fn: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fn.mock.calls[fn.mock.calls.length - 1];
  return JSON.parse((call[1] as RequestInit).body as string);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("testJQuantsConnection", () => {
  it("action=test と apiKey を /api/jquants へ送る（idToken/token は送らない）", async () => {
    const fn = mockFetchOnce({ ok: true, status: "connected", message: "接続成功" });
    const res = await testJQuantsConnection({ apiKey: DUMMY_KEY });
    expect(res.ok).toBe(true);
    expect(fn).toHaveBeenCalledWith("/api/jquants", expect.objectContaining({ method: "POST" }));
    const body = lastBody(fn);
    expect(body.action).toBe("test");
    expect(body.apiKey).toBe(DUMMY_KEY);
    expect(body).not.toHaveProperty("idToken");
    expect(body).not.toHaveProperty("credentials");
  });
});

describe("fetchJQuantsQuotes", () => {
  it("action=quotes・codes・apiKey を送る", async () => {
    const fn = mockFetchOnce({ ok: true, status: "connected", quotes: [] });
    await fetchJQuantsQuotes(["7203", "9984"], { apiKey: DUMMY_KEY });
    const body = lastBody(fn);
    expect(body.action).toBe("quotes");
    expect(body.codes).toEqual(["7203", "9984"]);
    expect(body.apiKey).toBe(DUMMY_KEY);
  });

  it("credentials が null なら apiKey は undefined（body から省略）", async () => {
    const fn = mockFetchOnce({ ok: true, status: "connected", quotes: [] });
    await fetchJQuantsQuotes(["7203"], null);
    const body = lastBody(fn);
    expect(body.apiKey).toBeUndefined();
  });
});

describe("fetchJQuantsSeries", () => {
  it("キャッシュ未ヒット時に action=series で取得し、成功系列を返す", async () => {
    const series = [{ date: "2026-01-05", close: 100, adjClose: 100, volume: 10 }];
    const fn = mockFetchOnce({ ok: true, status: "connected", series });
    const res = await fetchJQuantsSeries("7203", "2026-01-01", "2026-01-31", { apiKey: DUMMY_KEY });
    expect(res.ok).toBe(true);
    expect(res.series).toEqual(series);
    expect(res.cached).toBe(false);
    const body = lastBody(fn);
    expect(body.action).toBe("series");
    expect(body.apiKey).toBe(DUMMY_KEY);
  });
});
