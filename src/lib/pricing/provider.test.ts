import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Stock } from "@/lib/types";
import type { JQuantsResponse } from "./jquantsClient";
import type { RateLimiter } from "./rateLimiter";

// jquantsClient をモック（実 fetch は行わない）。
const fetchJQuantsQuotes = vi.fn<(codes: string[], cred: unknown) => Promise<JQuantsResponse>>();
vi.mock("./jquantsClient", () => ({
  fetchJQuantsQuotes: (codes: string[], cred: unknown) => fetchJQuantsQuotes(codes, cred),
}));

import { ManualPriceProvider, JQuantsPriceProvider, getPriceProvider } from "./provider";

const DUMMY_KEY = "dummy-api-key"; // ダミー値のみ
/** 待機しないリミッタ（テスト用）。 */
const NO_WAIT: RateLimiter = { acquire: async () => {} };

function stock(code: string, price: number | null, rsi: number | null): Stock {
  return {
    id: `id-${code}`,
    code,
    name: `銘柄${code}`,
    market: null,
    theme: null,
    per: null,
    pbr: null,
    roe: null,
    sales_growth: null,
    operating_margin: null,
    rsi,
    macd: "不明",
    current_price: price,
    stop_loss: null,
    take_profit: null,
    rank: "B",
    status: "watch",
    memo: null,
    price_updated_at: null,
  } as Stock;
}

/** 単一コードのクオート応答を作る。 */
function quoteResponse(code: string, price: number, closes: number[]): JQuantsResponse {
  return {
    ok: true,
    status: "connected",
    quotes: [
      { code, current_price: price, previous_close: price - 1, change: 1, change_rate: 0.5, volume: 100, date: "2026-01-05", closes, volumes: [10, 20, 30] },
    ],
  };
}

beforeEach(() => {
  fetchJQuantsQuotes.mockReset();
});

describe("ManualPriceProvider", () => {
  it("current_price を持つ銘柄のみ返す", async () => {
    const p = new ManualPriceProvider([stock("7203", 3000, 55), stock("9984", null, null)]);
    const quotes = await p.fetchQuotes(["7203", "9984"]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ code: "7203", price: 3000, rsi: 55 });
  });

  it("fetchQuotesBulk は即時に全件返し、onProgress を発火", async () => {
    const p = new ManualPriceProvider([stock("7203", 3000, 55)]);
    const onProgress = vi.fn();
    const r = await p.fetchQuotesBulk(["7203", "9999"], { onProgress });
    expect(r.quotes.map((q) => q.code)).toEqual(["7203"]);
    expect(r.failedCodes).toEqual(["9999"]);
    expect(r.stopped).toBeNull();
    expect(onProgress).toHaveBeenCalledTimes(2);
  });
});

describe("JQuantsPriceProvider.fetchQuotes（読み取り）", () => {
  it("成功時は終値系列から RSI を自動計算", async () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    fetchJQuantsQuotes.mockResolvedValue(quoteResponse("7203", 120, closes));
    const p = new JQuantsPriceProvider(new ManualPriceProvider([]), { apiKey: DUMMY_KEY }, NO_WAIT);
    const quotes = await p.fetchQuotes(["7203"]);
    expect(quotes[0].price).toBe(120);
    expect(typeof quotes[0].rsi).toBe("number");
  });

  it("ok=false のときは fallback（手入力値）へ委譲", async () => {
    fetchJQuantsQuotes.mockResolvedValue({ ok: false, status: "error", message: "err" });
    const p = new JQuantsPriceProvider(new ManualPriceProvider([stock("7203", 3000, 55)]), { apiKey: DUMMY_KEY }, NO_WAIT);
    const quotes = await p.fetchQuotes(["7203"]);
    expect(quotes[0]).toMatchObject({ code: "7203", price: 3000 });
  });
});

describe("JQuantsPriceProvider.fetchQuotesBulk（更新）", () => {
  it("1銘柄ずつ取得し、指標を載せて返す・onProgress を件数分発火", async () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    fetchJQuantsQuotes.mockImplementation(async (codes) => quoteResponse(codes[0], 500, closes));
    const p = new JQuantsPriceProvider(new ManualPriceProvider([]), { apiKey: DUMMY_KEY }, NO_WAIT);
    const onProgress = vi.fn();
    const r = await p.fetchQuotesBulk(["7203", "9984"], { onProgress });
    expect(fetchJQuantsQuotes).toHaveBeenCalledTimes(2);
    expect(fetchJQuantsQuotes.mock.calls[0][0]).toEqual(["7203"]); // 1銘柄ずつ
    expect(r.quotes).toHaveLength(2);
    expect(typeof r.quotes[0].rsi).toBe("number");
    expect(r.quotes[0].volume).toBe(30);
    expect(r.stopped).toBeNull();
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it("認証エラー（reason=auth）で即中断・部分成功を返す", async () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    fetchJQuantsQuotes
      .mockResolvedValueOnce(quoteResponse("7203", 500, closes))
      .mockResolvedValueOnce({ ok: false, status: "error", reason: "auth", message: "認証エラー" });
    const p = new JQuantsPriceProvider(new ManualPriceProvider([]), { apiKey: DUMMY_KEY }, NO_WAIT);
    const r = await p.fetchQuotesBulk(["7203", "9984", "6758"]);
    expect(r.quotes.map((q) => q.code)).toEqual(["7203"]); // 1件目のみ成功
    expect(r.stopped).toBe("auth");
    expect(fetchJQuantsQuotes).toHaveBeenCalledTimes(2); // 3件目は呼ばれない
  });

  it("レート制限（reason=rate）で即中断", async () => {
    fetchJQuantsQuotes.mockResolvedValue({ ok: false, status: "error", reason: "rate", message: "レート制限" });
    const p = new JQuantsPriceProvider(new ManualPriceProvider([]), { apiKey: DUMMY_KEY }, NO_WAIT);
    const r = await p.fetchQuotesBulk(["7203", "9984"]);
    expect(r.stopped).toBe("rate");
    expect(r.quotes).toHaveLength(0);
  });

  it("事前に abort 済みなら stopped=aborted で即返す", async () => {
    const p = new JQuantsPriceProvider(new ManualPriceProvider([]), { apiKey: DUMMY_KEY }, NO_WAIT);
    const controller = new AbortController();
    controller.abort();
    const r = await p.fetchQuotesBulk(["7203"], { signal: controller.signal });
    expect(r.stopped).toBe("aborted");
    expect(fetchJQuantsQuotes).not.toHaveBeenCalled();
  });

  it("データ無し銘柄は failedCodes にスキップして継続", async () => {
    fetchJQuantsQuotes.mockResolvedValue({ ok: true, status: "connected", quotes: [] });
    const p = new JQuantsPriceProvider(new ManualPriceProvider([]), { apiKey: DUMMY_KEY }, NO_WAIT);
    const r = await p.fetchQuotesBulk(["7203", "9984"]);
    expect(r.failedCodes).toEqual(["7203", "9984"]);
    expect(r.stopped).toBeNull();
  });
});

describe("getPriceProvider", () => {
  it("manual → ManualPriceProvider / jquants-ready → JQuantsPriceProvider", () => {
    expect(getPriceProvider([], "manual").name).toBe("manual");
    expect(getPriceProvider([], "jquants-ready", { apiKey: DUMMY_KEY }).name).toBe("jquants");
  });
});
