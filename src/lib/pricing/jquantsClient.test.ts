// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { testJQuantsConnection, fetchJQuantsQuotes, fetchJQuantsSeries, fetchJQuantsFins, fetchJQuantsMaster, fetchJQuantsBarsByDate } from "./jquantsClient";
import { __setJQuantsRateLimiter } from "./rateLimiter";

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

// 実待機を避けるため共有リミッタを no-wait に差し替える。
const limiterAcquire = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  window.localStorage.clear();
  limiterAcquire.mockClear();
  __setJQuantsRateLimiter({ acquire: limiterAcquire });
});
afterEach(() => {
  vi.restoreAllMocks();
  __setJQuantsRateLimiter(null);
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

describe("fetchJQuantsFins", () => {
  it("action=fins・code・apiKey を送り、fins レコードを返す", async () => {
    const fins = [{ Code: "72030", DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2026-03-31", Sales: "1200", EPS: "150", BPS: "1500" }];
    const fn = mockFetchOnce({ ok: true, status: "connected", fins });
    const res = await fetchJQuantsFins("7203", { apiKey: DUMMY_KEY });
    expect(res.ok).toBe(true);
    expect(res.fins).toEqual(fins);
    const body = lastBody(fn);
    expect(body.action).toBe("fins");
    expect(body.code).toBe("7203");
    expect(body.apiKey).toBe(DUMMY_KEY);
  });
});

describe("共有リミッタの網羅（単発呼び出し）", () => {
  it("testJQuantsConnection は共有リミッタを acquire する", async () => {
    mockFetchOnce({ ok: true, status: "connected" });
    await testJQuantsConnection({ apiKey: DUMMY_KEY });
    expect(limiterAcquire).toHaveBeenCalledTimes(1);
  });

  it("fetchJQuantsSeries はキャッシュミス時に acquire する", async () => {
    mockFetchOnce({ ok: true, status: "connected", series: [{ date: "2026-04-10", close: 1, adjClose: 1, volume: 1 }] });
    await fetchJQuantsSeries("7203", "2026-01-01", "2026-04-10", { apiKey: DUMMY_KEY });
    expect(limiterAcquire).toHaveBeenCalledTimes(1);
  });
});

describe("fetchJQuantsMaster", () => {
  it("action=master・date・apiKey を送り、master と pages を返す", async () => {
    const fn = mockFetchOnce({ ok: true, status: "connected", master: [{ Code: "72030", CoName: "トヨタ" }], pages: 1 });
    const res = await fetchJQuantsMaster("2026-04-10", { apiKey: DUMMY_KEY });
    expect(res.ok).toBe(true);
    expect(res.master).toHaveLength(1);
    const body = lastBody(fn);
    expect(body.action).toBe("master");
    expect(body.date).toBe("2026-04-10");
    expect(body.apiKey).toBe(DUMMY_KEY);
  });
});

describe("fetchJQuantsBarsByDate", () => {
  it("action=bars-by-date・date・apiKey を送り、bars/pages/date を返す", async () => {
    const fn = mockFetchOnce({ ok: true, status: "connected", bars: [{ Code: "72030", Date: "2026-04-10", AdjC: 3050 }], pages: 2, date: "2026-04-10" });
    const res = await fetchJQuantsBarsByDate("2026-04-10", { apiKey: DUMMY_KEY });
    expect(res.ok).toBe(true);
    expect(res.bars).toHaveLength(1);
    expect(res.pages).toBe(2);
    const body = lastBody(fn);
    expect(body.action).toBe("bars-by-date");
    expect(body.date).toBe("2026-04-10");
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
