// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Stock } from "@/lib/types";
import type { Quote, BulkQuotesResult } from "./provider";

// 依存をモック（provider/repo/settings）。
const h = vi.hoisted(() => ({
  listMock: vi.fn(),
  updateMock: vi.fn(),
  fetchQuotesBulkMock: vi.fn(),
  getProviderMode: vi.fn(() => "jquants-ready" as string),
  setJQuantsStatus: vi.fn(),
}));

vi.mock("@/lib/storage/stockRepository", () => ({
  getStockRepository: () => ({ list: h.listMock, update: h.updateMock }),
}));
vi.mock("./settings", () => ({
  getProviderMode: h.getProviderMode,
  getJQuantsCredentials: () => ({ apiKey: "dummy-key" }),
  setJQuantsStatus: h.setJQuantsStatus,
}));
vi.mock("./provider", () => ({
  getPriceProvider: () => ({
    name: "jquants",
    fetchQuotes: async () => [],
    fetchQuotesBulk: h.fetchQuotesBulkMock,
  }),
}));

import { updateAllPrices, updateStockPrice } from "./priceUpdater";

function stock(code: string): Stock {
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
    rsi: null,
    macd: "不明",
    current_price: null,
    stop_loss: null,
    take_profit: null,
    rank: "B",
    status: "watch",
    memo: null,
    price_updated_at: null,
  } as Stock;
}

function quote(code: string, price: number): Quote {
  return { code, price, rsi: 60, macd: "GC", volume: 1000, relativeVolume: 1.2, volumeTrend: "increasing", asOf: "2026-01-05" };
}

function bulk(partial: Partial<BulkQuotesResult>): BulkQuotesResult {
  return { quotes: [], failedCodes: [], stopped: null, ...partial };
}

beforeEach(() => {
  window.localStorage.clear();
  h.listMock.mockReset();
  h.updateMock.mockReset().mockResolvedValue(undefined);
  h.fetchQuotesBulkMock.mockReset();
  h.getProviderMode.mockReturnValue("jquants-ready");
  h.setJQuantsStatus.mockReset();
});

describe("updateAllPrices", () => {
  it("全成功: 各銘柄を更新し完了メッセージ", async () => {
    h.listMock.mockResolvedValue([stock("7203"), stock("9984")]);
    h.fetchQuotesBulkMock.mockResolvedValue(bulk({ quotes: [quote("7203", 500), quote("9984", 800)] }));
    const r = await updateAllPrices();
    expect(r.ok).toBe(true);
    expect(r.successCount).toBe(2);
    expect(r.failedCount).toBe(0);
    expect(r.message).toContain("完了");
    expect(h.updateMock).toHaveBeenCalledTimes(2);
    // 反映値の確認（1件目）
    const [, input] = h.updateMock.mock.calls[0];
    expect(input).toMatchObject({ current_price: 500, rsi: 60, macd: "GC", price_updated_at: "2026-01-05" });
  });

  it("ユーザー中断: 既更新分を保持し『ユーザー中断』を明示、ok=false", async () => {
    h.listMock.mockResolvedValue([stock("7203"), stock("9984")]);
    h.fetchQuotesBulkMock.mockResolvedValue(bulk({ quotes: [quote("7203", 500)], stopped: "aborted" }));
    const r = await updateAllPrices();
    expect(r.ok).toBe(false);
    expect(r.successCount).toBe(1);
    expect(r.message).toContain("ユーザー中断");
    expect(h.updateMock).toHaveBeenCalledTimes(1);
  });

  it("レート制限中断のメッセージ", async () => {
    h.listMock.mockResolvedValue([stock("7203"), stock("9984")]);
    h.fetchQuotesBulkMock.mockResolvedValue(bulk({ quotes: [quote("7203", 500)], stopped: "rate" }));
    const r = await updateAllPrices();
    expect(r.message).toContain("レート制限で中断");
  });

  it("onProgress を Provider へ伝播する", async () => {
    h.listMock.mockResolvedValue([stock("7203")]);
    h.fetchQuotesBulkMock.mockImplementation(async (_codes: string[], opts?: { onProgress?: (p: unknown) => void }) => {
      opts?.onProgress?.({ done: 1, total: 1, code: "7203" });
      return bulk({ quotes: [quote("7203", 500)] });
    });
    const onProgress = vi.fn();
    await updateAllPrices({ onProgress });
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 1, code: "7203" });
  });

  it("手入力モードでは取得せず案内を返す", async () => {
    h.getProviderMode.mockReturnValue("manual");
    h.listMock.mockResolvedValue([stock("7203")]);
    const r = await updateAllPrices();
    expect(r.ok).toBe(false);
    expect(r.message).toContain("手入力モード");
    expect(h.fetchQuotesBulkMock).not.toHaveBeenCalled();
  });

  it("対象銘柄が無ければ案内を返す", async () => {
    h.listMock.mockResolvedValue([]);
    const r = await updateAllPrices();
    expect(r.message).toContain("対象銘柄がありません");
  });
});

describe("updateStockPrice", () => {
  it("成功時は当該銘柄を更新", async () => {
    h.listMock.mockResolvedValue([stock("7203")]);
    h.fetchQuotesBulkMock.mockResolvedValue(bulk({ quotes: [quote("7203", 500)] }));
    const r = await updateStockPrice("id-7203");
    expect(r.ok).toBe(true);
    expect(h.updateMock).toHaveBeenCalledTimes(1);
  });

  it("データ取得不可なら失敗メッセージ（更新しない）", async () => {
    h.listMock.mockResolvedValue([stock("7203")]);
    h.fetchQuotesBulkMock.mockResolvedValue(bulk({ failedCodes: ["7203"] }));
    const r = await updateStockPrice("id-7203");
    expect(r.ok).toBe(false);
    expect(h.updateMock).not.toHaveBeenCalled();
  });

  it("認証エラー時は APIキー確認を促す", async () => {
    h.listMock.mockResolvedValue([stock("7203")]);
    h.fetchQuotesBulkMock.mockResolvedValue(bulk({ stopped: "auth" }));
    const r = await updateStockPrice("id-7203");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("APIキー");
  });
});
