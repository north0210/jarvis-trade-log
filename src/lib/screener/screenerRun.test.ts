import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UniverseEntry, AdjBar } from "./universe";
import type { BarsBatchResult } from "./batch";
import type { BulkFundamentalsResult } from "./fundamentalsProvider";
import type { JQuantsResponse } from "@/lib/pricing/jquantsClient";
import type { Fundamentals } from "@/lib/pricing/fundamentals";

const h = vi.hoisted(() => ({
  probe: vi.fn(),
  fetchUniverse: vi.fn(),
  fetchBarsBatch: vi.fn(),
  fetchBulk: vi.fn(),
  saveUniverse: vi.fn(),
  saveSnapshot: vi.fn(),
}));

vi.mock("@/lib/pricing/jquantsClient", () => ({ fetchJQuantsBarsByDate: h.probe }));
vi.mock("./batch", async (orig) => {
  const actual = await orig<typeof import("./batch")>();
  return { ...actual, fetchUniverse: h.fetchUniverse, fetchBarsBatch: h.fetchBarsBatch };
});
vi.mock("@/lib/pricing/fundamentalsProvider", () => ({
  getFundamentalsProvider: () => ({ name: "jquants", fetchFundamentalsBulk: h.fetchBulk }),
}));
vi.mock("./screenerRepository", () => ({
  saveUniverse: h.saveUniverse,
  saveScreenerSnapshot: h.saveSnapshot,
}));

import { runScreener } from "./screenerRun";
import { __setJQuantsRateLimiter } from "@/lib/pricing/rateLimiter";

const DUMMY = { apiKey: "dummy-key" };
const limiterAcquire = vi.fn().mockResolvedValue(undefined);

function uEntry(code: string, over: Partial<UniverseEntry> = {}): UniverseEntry {
  return { code, name: `銘柄${code}`, nameEn: "", sector17: "", sector33: "情報通信", scaleCategory: "", market: "プライム", marketCode: "0111", prodCategory: "011", ...over };
}
function rising(len = 40, start = 100): AdjBar[] {
  return Array.from({ length: len }, (_, i) => ({ date: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`, adjClose: start + i, adjVolume: 1000 + i }));
}
function batchResult(codes: string[], stopped: BarsBatchResult["stopped"] = null): BarsBatchResult {
  const seriesByCode = new Map<string, AdjBar[]>(codes.map((c) => [c, rising()]));
  return { seriesByCode, requestedDates: 40, fetchedDates: 40, emptyDates: 0, totalPages: 40, stopped, retried: false, stoppedAt: stopped ? 4 : undefined };
}
function fund(o: Partial<Fundamentals> = {}): Fundamentals {
  return { per: null, pbr: null, roe: null, operatingMargin: null, salesGrowth: null, basis: null, asOf: null, ...o };
}
function bulk(over: Partial<BulkFundamentalsResult>): BulkFundamentalsResult {
  return { items: [], failedCodes: [], stopped: null, ...over };
}
const probeOk = (date: string): JQuantsResponse => ({ ok: true, status: "connected", date, bars: [], pages: 1 });

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  limiterAcquire.mockClear();
  __setJQuantsRateLimiter({ acquire: limiterAcquire }); // probe の acquire を no-wait 化
});

describe("runScreener（Stage 4b オーケストレーション）", () => {
  it("happy path: universe→bars→fins→再スコア→snapshot 永続化", async () => {
    h.probe.mockResolvedValue(probeOk("2026-04-10"));
    h.fetchUniverse.mockResolvedValue({ universe: [uEntry("7203"), uEntry("9984"), uEntry("13060", { prodCategory: "014" })], stopped: null });
    h.fetchBarsBatch.mockResolvedValue(batchResult(["7203", "9984"]));
    h.fetchBulk.mockResolvedValue(
      bulk({
        items: [
          { code: "7203", fundamentals: fund({ per: 15, roe: 25, basis: "FY", asOf: "2026-03-31" }) },
          { code: "9984", fundamentals: fund({ per: 40, roe: 8, basis: "FY", asOf: "2026-02-14" }) },
        ],
      })
    );
    const r = await runScreener(DUMMY, { anchorDate: "2026-04-10" });
    expect(r.ok).toBe(true);
    expect(r.stopped).toBeNull();
    // ETF(13060) はフィルタ除外 → universeCount=2
    expect(r.snapshot?.universeCount).toBe(2);
    expect(r.finsCovered).toBe(2);
    expect(h.saveSnapshot).toHaveBeenCalledTimes(1);
    // rows に basis / asOf / available を含む
    const row = r.snapshot!.rows.find((x) => x.code === "7203")!;
    expect(row.fundamentalsBasis).toBe("FY");
    expect(row.fundamentalsAsOf).toBe("2026-03-31");
    expect(row.fundamentalsAvailable).toBe(true);
  });

  it("probe 認証失敗 → 破棄（保存しない）", async () => {
    h.probe.mockResolvedValue({ ok: false, status: "error", reason: "auth", message: "認証エラー" });
    const r = await runScreener(DUMMY);
    expect(r.ok).toBe(false);
    expect(r.stopped).toBe("auth");
    expect(h.saveSnapshot).not.toHaveBeenCalled();
  });

  it("bars 中断 → 破棄（保存しない）", async () => {
    h.fetchUniverse.mockResolvedValue({ universe: [uEntry("7203")], stopped: null });
    h.fetchBarsBatch.mockResolvedValue(batchResult(["7203"], "aborted"));
    const r = await runScreener(DUMMY, { anchorDate: "2026-04-10" });
    expect(r.ok).toBe(false);
    expect(r.stopped).toBe("aborted");
    expect(h.saveSnapshot).not.toHaveBeenCalled();
  });

  it("fins auth → 破棄（保存しない）", async () => {
    h.fetchUniverse.mockResolvedValue({ universe: [uEntry("7203")], stopped: null });
    h.fetchBarsBatch.mockResolvedValue(batchResult(["7203"]));
    h.fetchBulk.mockResolvedValue(bulk({ stopped: "auth" }));
    const r = await runScreener(DUMMY, { anchorDate: "2026-04-10" });
    expect(r.ok).toBe(false);
    expect(r.stopped).toBe("auth");
    expect(h.saveSnapshot).not.toHaveBeenCalled();
  });

  it("fins レート/欠損 → 部分許容で保存・未取得は技術のみ残留", async () => {
    h.fetchUniverse.mockResolvedValue({ universe: [uEntry("7203"), uEntry("9984")], stopped: null });
    h.fetchBarsBatch.mockResolvedValue(batchResult(["7203", "9984"]));
    // 7203 のみ財務取得・9984 は欠損（空 fundamentals）、全体は stopped=rate
    h.fetchBulk.mockResolvedValue(
      bulk({
        items: [
          { code: "7203", fundamentals: fund({ per: 15, roe: 25, basis: "FY", asOf: "2026-03-31" }) },
          { code: "9984", fundamentals: fund() },
        ],
        stopped: "rate",
      })
    );
    const r = await runScreener(DUMMY, { anchorDate: "2026-04-10" });
    expect(r.ok).toBe(true); // 破棄しない
    expect(r.stopped).toBe("rate");
    expect(r.finsCovered).toBe(1);
    expect(r.finsMissing).toBe(1);
    expect(h.saveSnapshot).toHaveBeenCalledTimes(1);
    expect(r.message).toContain("財務未取得");
    const missing = r.snapshot!.rows.find((x) => x.code === "9984")!;
    expect(missing.fundamentalsAvailable).toBe(false);
  });

  it("診断: bars レート制限は理由＋フェーズを表示（時間をおいて再試行）", async () => {
    h.fetchUniverse.mockResolvedValue({ universe: [uEntry("7203")], stopped: null });
    h.fetchBarsBatch.mockResolvedValue(batchResult(["7203"], "rate"));
    const r = await runScreener(DUMMY, { anchorDate: "2026-04-10" });
    expect(r.stopped).toBe("rate");
    expect(r.message).toContain("レート制限");
    expect(r.message).toContain("価格系列");
    expect(r.message).toContain("再試行");
    // 診断: 停止した日番号と自動リトライ有無を表示
    expect(r.message).toContain("日目");
    expect(r.message).toContain("自動リトライ: 未実施");
    expect(h.saveSnapshot).not.toHaveBeenCalled();
  });

  it("診断: probe レート制限は『最新日検出』フェーズを表示", async () => {
    h.probe.mockResolvedValue({ ok: false, status: "error", reason: "rate", message: "レート制限" });
    const r = await runScreener(DUMMY); // anchorDate 省略 → probe 実行
    expect(r.stopped).toBe("rate");
    expect(r.message).toContain("最新日検出");
    expect(r.message).toContain("レート制限");
  });

  it("網羅: probe は共有リミッタを acquire する", async () => {
    h.probe.mockResolvedValue(probeOk("2026-04-10"));
    h.fetchUniverse.mockResolvedValue({ universe: [uEntry("7203")], stopped: null });
    h.fetchBarsBatch.mockResolvedValue(batchResult(["7203"]));
    h.fetchBulk.mockResolvedValue(bulk({ items: [{ code: "7203", fundamentals: fund({ per: 15 }) }] }));
    await runScreener(DUMMY); // anchorDate 省略 → probe 経路
    expect(limiterAcquire).toHaveBeenCalledTimes(1); // probe の1回（universe/bars/fins はモックで acquire しない）
  });
});
