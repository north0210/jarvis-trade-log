import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Stock } from "@/lib/types";
import type { JQuantsResponse } from "./jquantsClient";

// jquantsClient をモック（実 fetch は行わない）。
const fetchJQuantsQuotes = vi.fn<(codes: string[], cred: unknown) => Promise<JQuantsResponse>>();
vi.mock("./jquantsClient", () => ({
  fetchJQuantsQuotes: (codes: string[], cred: unknown) => fetchJQuantsQuotes(codes, cred),
}));

// モック設定後に読み込む。
import { ManualPriceProvider, JQuantsPriceProvider, getPriceProvider } from "./provider";

const DUMMY_KEY = "dummy-api-key"; // ダミー値のみ

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

beforeEach(() => {
  fetchJQuantsQuotes.mockReset();
});

describe("ManualPriceProvider", () => {
  it("current_price を持つ銘柄のみ返す", async () => {
    const stocks = [stock("7203", 3000, 55), stock("9984", null, null)];
    const p = new ManualPriceProvider(stocks);
    const quotes = await p.fetchQuotes(["7203", "9984"]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ code: "7203", price: 3000 });
  });
});

describe("JQuantsPriceProvider", () => {
  it("成功時は取得価格を返し、終値系列から RSI を自動計算", async () => {
    // 15点以上の上げ相場系列 → RSI は算出可能（100 に近い）。
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    fetchJQuantsQuotes.mockResolvedValue({
      ok: true,
      status: "connected",
      quotes: [
        { code: "7203", current_price: 120, previous_close: 119, change: 1, change_rate: 0.84, volume: 100, date: "2026-01-05", closes, volumes: [] },
      ],
    });
    const fallback = new ManualPriceProvider([stock("7203", 3000, 55)]);
    const p = new JQuantsPriceProvider(fallback, { apiKey: DUMMY_KEY });
    const quotes = await p.fetchQuotes(["7203"]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].price).toBe(120);
    expect(typeof quotes[0].rsi).toBe("number");
    expect(quotes[0].asOf).toBe("2026-01-05");
  });

  it("応答が ok=false のときは fallback（手入力値）へ委譲", async () => {
    fetchJQuantsQuotes.mockResolvedValue({ ok: false, status: "error", message: "認証エラー" });
    const fallback = new ManualPriceProvider([stock("7203", 3000, 55)]);
    const p = new JQuantsPriceProvider(fallback, { apiKey: DUMMY_KEY });
    const quotes = await p.fetchQuotes(["7203"]);
    expect(quotes).toEqual([{ code: "7203", price: 3000, rsi: 55, asOf: expect.any(String) }]);
  });

  it("例外時も fallback へ委譲", async () => {
    fetchJQuantsQuotes.mockRejectedValue(new Error("network"));
    const fallback = new ManualPriceProvider([stock("7203", 3000, 55)]);
    const p = new JQuantsPriceProvider(fallback, { apiKey: DUMMY_KEY });
    const quotes = await p.fetchQuotes(["7203"]);
    expect(quotes[0].price).toBe(3000);
  });
});

describe("getPriceProvider", () => {
  it("manual モードは ManualPriceProvider", () => {
    const p = getPriceProvider([stock("7203", 3000, 55)], "manual");
    expect(p.name).toBe("manual");
  });
  it("jquants-ready モードは JQuantsPriceProvider", () => {
    const p = getPriceProvider([stock("7203", 3000, 55)], "jquants-ready", { apiKey: DUMMY_KEY });
    expect(p.name).toBe("jquants");
  });
});
