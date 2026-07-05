// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Stock } from "@/lib/types";
import type { Fundamentals } from "./fundamentals";
import type { BulkFundamentalsResult } from "./fundamentalsProvider";

const h = vi.hoisted(() => ({
  listMock: vi.fn(),
  updateMock: vi.fn(),
  fetchBulkMock: vi.fn(),
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
vi.mock("./fundamentalsProvider", () => ({
  getFundamentalsProvider: () => ({ name: "jquants", fetchFundamentalsBulk: h.fetchBulkMock }),
}));

import { planFundamentalsUpdate, updateAllFundamentals } from "./fundamentalsUpdater";

function stock(code: string, over: Partial<Stock> = {}): Stock {
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
    current_price: 3000,
    stop_loss: null,
    take_profit: null,
    rank: "B",
    status: "watch",
    memo: null,
    price_updated_at: null,
    ...over,
  } as Stock;
}

function fundamentals(over: Partial<Fundamentals> = {}): Fundamentals {
  return { per: null, pbr: null, roe: null, operatingMargin: null, salesGrowth: null, basis: null, asOf: null, ...over };
}

function bulk(over: Partial<BulkFundamentalsResult>): BulkFundamentalsResult {
  return { items: [], failedCodes: [], stopped: null, ...over };
}

beforeEach(() => {
  window.localStorage.clear();
  h.listMock.mockReset();
  h.updateMock.mockReset().mockResolvedValue(undefined);
  h.fetchBulkMock.mockReset();
  h.getProviderMode.mockReturnValue("jquants-ready");
  h.setJQuantsStatus.mockReset();
});

describe("planFundamentalsUpdate（純関数・computed ?? manual）", () => {
  it("computed が非 null なら採用し updatedFields に載せる", () => {
    const s = stock("7203", { per: 99, pbr: 1 });
    const plan = planFundamentalsUpdate(s, fundamentals({ per: 20, pbr: 2, roe: 10 }));
    expect(plan.updates.per).toBe(20);
    expect(plan.updates.pbr).toBe(2);
    expect(plan.updates.roe).toBe(10);
    expect(plan.updatedFields).toEqual(["per", "pbr", "roe"]);
  });

  it("computed が null の指標は手入力値を維持（非破壊・updatedFields に載らない）", () => {
    const s = stock("7203", { per: 15, roe: 8 });
    const plan = planFundamentalsUpdate(s, fundamentals({ per: null, roe: null, operatingMargin: 12 }));
    expect(plan.updates.per).toBe(15); // 手入力維持
    expect(plan.updates.roe).toBe(8); // 手入力維持
    expect(plan.updates.operating_margin).toBe(12); // 新値
    expect(plan.updatedFields).toEqual(["operating_margin"]);
  });

  it("全 null なら updatedFields 空（＝書き込み不要）", () => {
    const plan = planFundamentalsUpdate(stock("7203"), fundamentals());
    expect(plan.updatedFields).toEqual([]);
  });
});

describe("updateAllFundamentals（書き込み部）", () => {
  it("指標を反映し、更新数・指標数を返す", async () => {
    h.listMock.mockResolvedValue([stock("7203"), stock("9984")]);
    h.fetchBulkMock.mockResolvedValue(
      bulk({
        items: [
          { code: "7203", fundamentals: fundamentals({ per: 20, pbr: 2, roe: 10 }) },
          { code: "9984", fundamentals: fundamentals({ operatingMargin: 15 }) },
        ],
      })
    );
    const r = await updateAllFundamentals();
    expect(r.ok).toBe(true);
    expect(r.successCount).toBe(2);
    expect(r.fieldCount).toBe(4); // 3 + 1
    expect(h.updateMock).toHaveBeenCalledTimes(2);
    expect(r.message).toContain("財務指標を更新しました");
  });

  it("新値ゼロの銘柄は書き込まない（手入力維持）", async () => {
    h.listMock.mockResolvedValue([stock("7203"), stock("9984")]);
    h.fetchBulkMock.mockResolvedValue(
      bulk({
        items: [
          { code: "7203", fundamentals: fundamentals({ per: 20 }) },
          { code: "9984", fundamentals: fundamentals() }, // 全 null
        ],
      })
    );
    const r = await updateAllFundamentals();
    expect(r.successCount).toBe(1);
    expect(r.failedCount).toBe(1);
    expect(h.updateMock).toHaveBeenCalledTimes(1);
  });

  it("ユーザー中断は『ユーザー中断』を明示・ok=false", async () => {
    h.listMock.mockResolvedValue([stock("7203"), stock("9984")]);
    h.fetchBulkMock.mockResolvedValue(bulk({ items: [{ code: "7203", fundamentals: fundamentals({ per: 20 }) }], stopped: "aborted" }));
    const r = await updateAllFundamentals();
    expect(r.ok).toBe(false);
    expect(r.message).toContain("ユーザー中断");
  });

  it("手入力モードでは取得せず案内", async () => {
    h.getProviderMode.mockReturnValue("manual");
    h.listMock.mockResolvedValue([stock("7203")]);
    const r = await updateAllFundamentals();
    expect(r.message).toContain("手入力モード");
    expect(h.fetchBulkMock).not.toHaveBeenCalled();
  });

  it("onProgress を Provider へ伝播", async () => {
    h.listMock.mockResolvedValue([stock("7203")]);
    h.fetchBulkMock.mockImplementation(async (_codes: string[], _price: unknown, opts?: { onProgress?: (p: unknown) => void }) => {
      opts?.onProgress?.({ done: 1, total: 1, code: "7203" });
      return bulk({ items: [{ code: "7203", fundamentals: fundamentals({ per: 20 }) }] });
    });
    const onProgress = vi.fn();
    await updateAllFundamentals({ onProgress });
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 1, code: "7203" });
  });
});
