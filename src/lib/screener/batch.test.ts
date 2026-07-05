import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JQuantsResponse } from "@/lib/pricing/jquantsClient";
import type { RateLimiter } from "@/lib/pricing/rateLimiter";

const fetchJQuantsMaster = vi.fn<(date: string | undefined, cred: unknown) => Promise<JQuantsResponse>>();
const fetchJQuantsBarsByDate = vi.fn<(date: string, cred: unknown) => Promise<JQuantsResponse>>();
vi.mock("@/lib/pricing/jquantsClient", () => ({
  fetchJQuantsMaster: (d: string | undefined, c: unknown) => fetchJQuantsMaster(d, c),
  fetchJQuantsBarsByDate: (d: string, c: unknown) => fetchJQuantsBarsByDate(d, c),
}));

import { recentWeekdays, fetchUniverse, fetchBarsBatch } from "./batch";

const DUMMY_KEY = "dummy-api-key";
const NO_WAIT: RateLimiter = { acquire: async () => {} };

function barsResp(date: string, codes: string[], pages = 1): JQuantsResponse {
  return {
    ok: true,
    status: "connected",
    pages,
    date,
    bars: codes.map((code) => ({ Code: code, Date: date, AdjC: 100, AdjVo: 10 })),
  };
}

beforeEach(() => {
  fetchJQuantsMaster.mockReset();
  fetchJQuantsBarsByDate.mockReset();
});

describe("recentWeekdays（純関数・土日除外・新しい順）", () => {
  it("月曜 anchor から3営業日（土日を飛ばす）", () => {
    // 2026-01-12 = 月曜。← 01-11(日)/01-10(土) を飛ばして 01-09(金),01-08(木)
    expect(recentWeekdays("2026-01-12", 3)).toEqual(["2026-01-12", "2026-01-09", "2026-01-08"]);
  });
  it("土曜 anchor は当日を除外し前営業日から", () => {
    expect(recentWeekdays("2026-01-10", 2)).toEqual(["2026-01-09", "2026-01-08"]);
  });
  it("count<=0 / 不正日付は空", () => {
    expect(recentWeekdays("2026-01-12", 0)).toEqual([]);
    expect(recentWeekdays("bogus", 3)).toEqual([]);
  });
});

describe("fetchUniverse", () => {
  it("成功時はユニバースを構築", async () => {
    fetchJQuantsMaster.mockResolvedValue({ ok: true, status: "connected", master: [{ Code: "72030", CoName: "トヨタ" }, { Code: "99840", CoName: "SBG" }] });
    const r = await fetchUniverse("2026-04-10", { apiKey: DUMMY_KEY }, { limiter: NO_WAIT });
    expect(r.universe.map((u) => u.code).sort()).toEqual(["72030", "99840"]);
    expect(r.stopped).toBeNull();
  });
  it("認証失敗は stopped=auth・空ユニバース", async () => {
    fetchJQuantsMaster.mockResolvedValue({ ok: false, status: "error", reason: "auth", message: "認証エラー" });
    const r = await fetchUniverse("2026-04-10", { apiKey: DUMMY_KEY }, { limiter: NO_WAIT });
    expect(r.stopped).toBe("auth");
    expect(r.universe).toEqual([]);
  });

  it("共有/注入リミッタを acquire する（網羅）", async () => {
    const acquire = vi.fn().mockResolvedValue(undefined);
    fetchJQuantsMaster.mockResolvedValue({ ok: true, status: "connected", master: [{ Code: "72030" }] });
    await fetchUniverse("2026-04-10", { apiKey: DUMMY_KEY }, { limiter: { acquire } });
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});

describe("fetchBarsBatch", () => {
  it("複数日を集約し、銘柄別系列・統計を返す", async () => {
    fetchJQuantsBarsByDate.mockImplementation(async (date) => barsResp(date, ["72030", "99840"], 1));
    const onProgress = vi.fn();
    const r = await fetchBarsBatch(["2026-04-10", "2026-04-09"], { apiKey: DUMMY_KEY }, { limiter: NO_WAIT, onProgress });
    expect(r.seriesByCode.get("72030")?.map((b) => b.date)).toEqual(["2026-04-09", "2026-04-10"]); // 昇順集約
    expect(r.fetchedDates).toBe(2);
    expect(r.totalPages).toBe(2);
    expect(r.stopped).toBeNull();
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it("pagination の pages を合算する", async () => {
    fetchJQuantsBarsByDate
      .mockResolvedValueOnce(barsResp("2026-04-10", ["72030"], 3))
      .mockResolvedValueOnce(barsResp("2026-04-09", ["72030"], 2));
    const r = await fetchBarsBatch(["2026-04-10", "2026-04-09"], { apiKey: DUMMY_KEY }, { limiter: NO_WAIT });
    expect(r.totalPages).toBe(5);
  });

  it("空データの日を emptyDates に計上", async () => {
    fetchJQuantsBarsByDate
      .mockResolvedValueOnce(barsResp("2026-04-10", ["72030"]))
      .mockResolvedValueOnce({ ok: true, status: "connected", bars: [], pages: 1, date: "2026-01-01" });
    const r = await fetchBarsBatch(["2026-04-10", "2026-01-01"], { apiKey: DUMMY_KEY }, { limiter: NO_WAIT });
    expect(r.fetchedDates).toBe(2);
    expect(r.emptyDates).toBe(1);
  });

  it("認証失敗で中断し部分結果＋stopped=auth", async () => {
    fetchJQuantsBarsByDate
      .mockResolvedValueOnce(barsResp("2026-04-10", ["72030"]))
      .mockResolvedValueOnce({ ok: false, status: "error", reason: "auth" });
    const r = await fetchBarsBatch(["2026-04-10", "2026-04-09", "2026-04-08"], { apiKey: DUMMY_KEY }, { limiter: NO_WAIT });
    expect(r.stopped).toBe("auth");
    expect(r.seriesByCode.has("72030")).toBe(true); // 部分結果は保持して返す
    expect(fetchJQuantsBarsByDate).toHaveBeenCalledTimes(2); // 3日目は呼ばれない
  });

  it("事前 abort 済みは stopped=aborted・未取得", async () => {
    const c = new AbortController();
    c.abort();
    const r = await fetchBarsBatch(["2026-04-10"], { apiKey: DUMMY_KEY }, { limiter: NO_WAIT, signal: c.signal });
    expect(r.stopped).toBe("aborted");
    expect(fetchJQuantsBarsByDate).not.toHaveBeenCalled();
  });

  it("初回1発目の rate は自動待機して1回リトライ", async () => {
    fetchJQuantsBarsByDate
      .mockResolvedValueOnce({ ok: false, status: "error", reason: "rate" })
      .mockResolvedValueOnce(barsResp("2026-04-10", ["72030"]));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = await fetchBarsBatch(["2026-04-10"], { apiKey: DUMMY_KEY }, { limiter: NO_WAIT, sleep, retryWaitMs: 1 });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(r.stopped).toBeNull();
    expect(r.seriesByCode.has("72030")).toBe(true);
  });

  it("2件目以降の rate はリトライせず破棄（stopped=rate）", async () => {
    fetchJQuantsBarsByDate
      .mockResolvedValueOnce(barsResp("2026-04-10", ["72030"]))
      .mockResolvedValueOnce({ ok: false, status: "error", reason: "rate" });
    const sleep = vi.fn();
    const r = await fetchBarsBatch(["2026-04-10", "2026-04-09"], { apiKey: DUMMY_KEY }, { limiter: NO_WAIT, sleep });
    expect(sleep).not.toHaveBeenCalled();
    expect(r.stopped).toBe("rate");
  });
});
