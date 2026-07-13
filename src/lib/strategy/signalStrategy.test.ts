import { describe, it, expect } from "vitest";
import {
  sma,
  priorHigh,
  momentumPct,
  currentGainPct,
  lastClose,
  toCloses,
  isGoldenCross,
  rsiLast,
  type StrategyBar,
} from "./signalStrategy";

/** 終値配列を日付つきバー列に変換（日付はルール評価に無関係なので連番 ISO）。 */
function toBars(closes: number[]): StrategyBar[] {
  const base = Date.UTC(2020, 0, 1);
  return closes.map((c, i) => ({ date: new Date(base + i * 86400000).toISOString().slice(0, 10), close: c }));
}

describe("sma", () => {
  it("直近 period 本の単純移動平均を返す", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5); // (3+4)/2
    expect(sma([2, 4, 6], 3)).toBe(4);
  });
  it("データ不足・不正 period は null", () => {
    expect(sma([1, 2], 3)).toBeNull();
    expect(sma([1, 2, 3], 0)).toBeNull();
  });
});

describe("priorHigh", () => {
  it("最新バーを除いた直前 period 本の最大終値", () => {
    expect(priorHigh([1, 5, 2, 3], 2)).toBe(5); // 末尾(3)を除く直前2本[5,2]の最大
  });
  it("データ不足は null（period+1 本必要）", () => {
    expect(priorHigh([1, 2], 2)).toBeNull();
  });
});

describe("momentumPct", () => {
  it("lookback 本前比の騰落率(%)", () => {
    expect(momentumPct([100, 110], 1)).toBeCloseTo(10, 6);
    expect(momentumPct([100, 90], 1)).toBeCloseTo(-10, 6);
  });
  it("データ不足・ゼロ除算は null", () => {
    expect(momentumPct([100], 1)).toBeNull();
    expect(momentumPct([0, 5, 10], 2)).toBeNull();
  });
});

describe("currentGainPct / lastClose / toCloses", () => {
  it("建玉価格に対する最新終値の損益率", () => {
    expect(currentGainPct(100, toBars([100, 90]))).toBeCloseTo(-10, 6);
    expect(currentGainPct(0, toBars([100]))).toBeNull();
  });
  it("lastClose は最新終値（空は null）", () => {
    expect(lastClose(toBars([1, 2, 3]))).toBe(3);
    expect(lastClose([])).toBeNull();
  });
  it("toCloses は終値配列", () => {
    expect(toCloses(toBars([1, 2, 3]))).toEqual([1, 2, 3]);
  });
});

describe("isGoldenCross / rsiLast（indicators 委譲）", () => {
  it("最終バーでのゴールデンクロスを検出", () => {
    const closes: number[] = [];
    for (let i = 0; i < 60; i++) closes.push(200 - 0.5 * i);
    closes.push(205); // 最終バーで急伸 → GC
    expect(isGoldenCross(closes)).toBe(true);
  });
  it("単調上昇はゴールデンクロスではない（既にクロス済み）", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
    expect(isGoldenCross(closes)).toBe(false);
  });
  it("rsiLast は calculateRSI に委譲", () => {
    expect(rsiLast([1, 2], 14)).toBeNull(); // データ不足
  });
});
