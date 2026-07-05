import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JQuantsResponse } from "./jquantsClient";

// jquantsClient をモック（fins・quotes 両方。実 fetch なし）。
const fetchJQuantsFins = vi.fn<(code: string, cred: unknown) => Promise<JQuantsResponse>>();
const fetchJQuantsQuotes = vi.fn<(codes: string[], cred: unknown) => Promise<JQuantsResponse>>();
vi.mock("./jquantsClient", () => ({
  fetchJQuantsFins: (code: string, cred: unknown) => fetchJQuantsFins(code, cred),
  fetchJQuantsQuotes: (codes: string[], cred: unknown) => fetchJQuantsQuotes(codes, cred),
}));

import { JQuantsFundamentalsProvider, getFundamentalsProvider } from "./fundamentalsProvider";
import { JQuantsPriceProvider, ManualPriceProvider } from "./provider";
import { __setJQuantsRateLimiter, type RateLimiter } from "./rateLimiter";

const DUMMY_KEY = "dummy-api-key"; // ダミー値のみ
const NO_WAIT: RateLimiter = { acquire: async () => {} };

function finRecord() {
  return {
    DocType: "FYFinancialStatements_Consolidated_IFRS",
    CurPerType: "FY",
    CurPerEn: "2026-03-31",
    DiscDate: "2026-05-10",
    Sales: "1200",
    OP: "120",
    NP: "90",
    Eq: "1000",
    EPS: "150",
    BPS: "1500",
  };
}

beforeEach(() => {
  fetchJQuantsFins.mockReset();
  fetchJQuantsQuotes.mockReset();
});

describe("JQuantsFundamentalsProvider.fetchFundamentalsBulk", () => {
  it("成功時は指標を計算して返す（price を PER/PBR に反映）", async () => {
    fetchJQuantsFins.mockResolvedValue({ ok: true, status: "connected", fins: [finRecord()] });
    const p = new JQuantsFundamentalsProvider({ apiKey: DUMMY_KEY }, NO_WAIT);
    const priceByCode = new Map([["7203", 3000]]);
    const r = await p.fetchFundamentalsBulk(["7203"], priceByCode);
    expect(r.items).toHaveLength(1);
    const f = r.items[0].fundamentals;
    expect(f.per).toBe(20); // 3000/150
    expect(f.roe).toBe(10); // 150/1500*100
    expect(f.operatingMargin).toBe(10);
    expect(r.stopped).toBeNull();
  });

  it("onProgress を件数分発火・1銘柄ずつ取得", async () => {
    fetchJQuantsFins.mockResolvedValue({ ok: true, status: "connected", fins: [finRecord()] });
    const p = new JQuantsFundamentalsProvider({ apiKey: DUMMY_KEY }, NO_WAIT);
    const onProgress = vi.fn();
    await p.fetchFundamentalsBulk(["7203", "9984"], new Map(), { onProgress });
    expect(fetchJQuantsFins).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it("認証エラーで即中断（部分成功）", async () => {
    fetchJQuantsFins
      .mockResolvedValueOnce({ ok: true, status: "connected", fins: [finRecord()] })
      .mockResolvedValueOnce({ ok: false, status: "error", reason: "auth" });
    const p = new JQuantsFundamentalsProvider({ apiKey: DUMMY_KEY }, NO_WAIT);
    const r = await p.fetchFundamentalsBulk(["7203", "9984", "6758"], new Map());
    expect(r.items).toHaveLength(1);
    expect(r.stopped).toBe("auth");
    expect(fetchJQuantsFins).toHaveBeenCalledTimes(2);
  });

  it("レート制限で即中断", async () => {
    fetchJQuantsFins.mockResolvedValue({ ok: false, status: "error", reason: "rate" });
    const p = new JQuantsFundamentalsProvider({ apiKey: DUMMY_KEY }, NO_WAIT);
    const r = await p.fetchFundamentalsBulk(["7203"], new Map());
    expect(r.stopped).toBe("rate");
  });

  it("事前 abort 済みなら stopped=aborted", async () => {
    const p = new JQuantsFundamentalsProvider({ apiKey: DUMMY_KEY }, NO_WAIT);
    const c = new AbortController();
    c.abort();
    const r = await p.fetchFundamentalsBulk(["7203"], new Map(), { signal: c.signal });
    expect(r.stopped).toBe("aborted");
    expect(fetchJQuantsFins).not.toHaveBeenCalled();
  });

  it("財務データ無し（空 fins）は item を返すが指標は全 null", async () => {
    fetchJQuantsFins.mockResolvedValue({ ok: true, status: "connected", fins: [] });
    const p = new JQuantsFundamentalsProvider({ apiKey: DUMMY_KEY }, NO_WAIT);
    const r = await p.fetchFundamentalsBulk(["7203"], new Map([["7203", 3000]]));
    expect(r.items[0].fundamentals.per).toBeNull();
  });
});

describe("共有レートリミッタ（価格更新と財務更新の直列化）", () => {
  afterEach(() => __setJQuantsRateLimiter(null));

  it("価格Providerと財務Providerが同一の共有リミッタを通る", async () => {
    const acquire = vi.fn().mockResolvedValue(undefined);
    __setJQuantsRateLimiter({ acquire });

    // 既定リミッタ（＝共有）で構築する。
    const priceP = new JQuantsPriceProvider(new ManualPriceProvider([]), { apiKey: DUMMY_KEY });
    const finP = new JQuantsFundamentalsProvider({ apiKey: DUMMY_KEY });

    fetchJQuantsQuotes.mockImplementation(async (codes) => ({
      ok: true,
      status: "connected",
      quotes: [{ code: codes[0], current_price: 100, previous_close: 99, change: 1, change_rate: 1, volume: 1, date: "2026-04-10", closes: [], volumes: [] }],
    }));
    fetchJQuantsFins.mockResolvedValue({ ok: true, status: "connected", fins: [] });

    await Promise.all([
      priceP.fetchQuotesBulk(["7203", "9984"]), // 2 回
      finP.fetchFundamentalsBulk(["6758"], new Map()), // 1 回
    ]);

    // 価格2 + 財務1 = 3 回、すべて同じ共有リミッタで acquire される。
    expect(acquire).toHaveBeenCalledTimes(3);
  });
});

describe("getFundamentalsProvider", () => {
  it("manual → Manual / jquants-ready → JQuants", () => {
    expect(getFundamentalsProvider("manual").name).toBe("manual");
    expect(getFundamentalsProvider("jquants-ready", { apiKey: DUMMY_KEY }).name).toBe("jquants");
  });
});
