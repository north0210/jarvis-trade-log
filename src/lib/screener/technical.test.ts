import { describe, it, expect } from "vitest";
import { toSyntheticStock, screenRow, buildScreenerRows, rankRows, selectTopN, rescoreWithFundamentals, type ScreenerRow } from "./technical";
import type { UniverseEntry, AdjBar } from "./universe";
import type { Fundamentals } from "@/lib/pricing/fundamentals";

function entry(code: string, over: Partial<UniverseEntry> = {}): UniverseEntry {
  return { code, name: `銘柄${code}`, nameEn: "", sector17: "", sector33: "情報通信", scaleCategory: "", market: "プライム", ...over };
}
/** 調整後系列（上げ相場・RSI/MACD 算出可能な長さ）。 */
function risingSeries(len = 40, start = 100): AdjBar[] {
  return Array.from({ length: len }, (_, i) => ({ date: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`, adjClose: start + i, adjVolume: 1000 + i * 10 }));
}

describe("toSyntheticStock", () => {
  it("ファンダは null・技術指標は既存 indicators で埋まる", () => {
    const s = toSyntheticStock(entry("7203"), risingSeries());
    // ファンダは全て null（Stage 4b で付与）
    expect(s.per).toBeNull();
    expect(s.pbr).toBeNull();
    expect(s.roe).toBeNull();
    expect(s.sales_growth).toBeNull();
    expect(s.operating_margin).toBeNull();
    // 技術指標は算出済み
    expect(typeof s.rsi).toBe("number");
    expect(s.current_price).toBe(139); // start100 + (40-1)
  });

  it("系列が空でも破綻しない（price null・rsi null）", () => {
    const s = toSyntheticStock(entry("7203"), []);
    expect(s.current_price).toBeNull();
    expect(s.rsi).toBeNull();
  });
});

describe("scoreStock 再利用の null 安全（技術寄与のみ）", () => {
  it("ファンダ null でも例外なくスコア算出・0〜100・ファンダは『データなし』", () => {
    const s = toSyntheticStock(entry("7203"), risingSeries());
    // technical.ts は scoreStock を再利用（rsi/macd/volume の再実装なし）
    const row = screenRow(entry("7203"), risingSeries());
    expect(Number.isFinite(row.score)).toBe(true);
    expect(row.score).toBeGreaterThanOrEqual(0);
    expect(row.score).toBeLessThanOrEqual(100);
    expect(["S", "A", "B", "C", "D"]).toContain(row.grade);
    // 合成 Stock 経由でもファンダは未取得
    expect(s.per).toBeNull();
  });
});

describe("rankRows（決定的な同点処理）", () => {
  const mk = (code: string, score: number): ScreenerRow => ({
    code, name: code, sector: "", market: "", price: 1, rsi: null, macd: "不明", relativeVolume: null, score, grade: "D",
  });

  it("スコア降順・同点は code 昇順で決定的", () => {
    const rows = [mk("9984", 20), mk("7203", 20), mk("6758", 30), mk("4063", 20)];
    const ranked = rankRows(rows);
    expect(ranked.map((r) => r.code)).toEqual(["6758", "4063", "7203", "9984"]);
  });

  it("入力順が変わっても結果は同一（安定・決定的）", () => {
    const a = rankRows([mk("7203", 20), mk("9984", 20), mk("4063", 20)]);
    const b = rankRows([mk("9984", 20), mk("4063", 20), mk("7203", 20)]);
    expect(a.map((r) => r.code)).toEqual(b.map((r) => r.code));
    expect(a.map((r) => r.code)).toEqual(["4063", "7203", "9984"]);
  });

  it("元配列を破壊しない", () => {
    const rows = [mk("9984", 20), mk("6758", 30)];
    rankRows(rows);
    expect(rows.map((r) => r.code)).toEqual(["9984", "6758"]);
  });
});

describe("selectTopN", () => {
  const mk = (code: string, score: number): ScreenerRow => ({
    code, name: code, sector: "", market: "", price: 1, rsi: null, macd: "不明", relativeVolume: null, score, grade: "D",
  });
  it("上位 N を返す", () => {
    const rows = [mk("a", 10), mk("b", 30), mk("c", 20), mk("d", 40)];
    expect(selectTopN(rows, 2).map((r) => r.code)).toEqual(["d", "b"]);
  });
  it("N<=0 は空・N>件数は全件", () => {
    const rows = [mk("a", 10), mk("b", 30)];
    expect(selectTopN(rows, 0)).toEqual([]);
    expect(selectTopN(rows, 99)).toHaveLength(2);
  });
});

describe("rescoreWithFundamentals（二段目・フルスコア）", () => {
  const baseRow = (): ScreenerRow => screenRow(entry("7203"), risingSeries());
  const fund = (o: Partial<Fundamentals> = {}): Fundamentals => ({ per: null, pbr: null, roe: null, operatingMargin: null, salesGrowth: null, basis: null, asOf: null, ...o });

  it("財務ありでフルスコア再算出・basis/取得日/available を記録", () => {
    const row = baseRow();
    const rescored = rescoreWithFundamentals(row, fund({ per: 15, pbr: 2, roe: 25, operatingMargin: 22, salesGrowth: 12, basis: "FY", asOf: "2026-03-31" }));
    expect(rescored.fundamentalsAvailable).toBe(true);
    expect(rescored.fundamentalsBasis).toBe("FY");
    expect(rescored.fundamentalsAsOf).toBe("2026-03-31");
    expect(rescored.roe).toBe(25);
    // 財務加点で技術のみより高くなる
    expect(rescored.score).toBeGreaterThan(row.score);
  });

  it("f=null は技術スコアのまま残留・financials 未取得を記録（破棄しない）", () => {
    const row = baseRow();
    const rescored = rescoreWithFundamentals(row, null);
    expect(rescored.fundamentalsAvailable).toBe(false);
    expect(rescored.score).toBe(row.score); // 技術スコア不変
    expect(rescored.per).toBeNull();
  });

  it("全 null 財務（欠損）も available=false・技術スコア維持", () => {
    const row = baseRow();
    const rescored = rescoreWithFundamentals(row, fund());
    expect(rescored.fundamentalsAvailable).toBe(false);
    expect(rescored.score).toBe(row.score);
  });
});

describe("buildScreenerRows", () => {
  it("系列の無い銘柄はスキップする", () => {
    const universe = [entry("7203"), entry("9984"), entry("6758")];
    const seriesByCode = new Map<string, AdjBar[]>([
      ["7203", risingSeries()],
      ["6758", risingSeries()],
      // 9984 は系列なし
    ]);
    const rows = buildScreenerRows(universe, seriesByCode);
    expect(rows.map((r) => r.code).sort()).toEqual(["6758", "7203"]);
  });
});
