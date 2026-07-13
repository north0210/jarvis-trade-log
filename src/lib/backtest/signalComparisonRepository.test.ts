// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { K } from "@/lib/storage/keys";
import { loadStrategyComparison, saveStrategyComparison } from "./signalComparisonRepository";
import type { StrategyComparisonResult } from "./signalSimulator";

const sample = (): StrategyComparisonResult => ({
  generatedAt: "2026-07-13T00:00:00.000Z",
  from: "2021-07-13",
  to: "2026-07-13",
  mid: "2024-01-12",
  universeCount: 12,
  entries: [
    {
      strategyId: "trend-follow",
      strategyName: "A トレンドフォロー",
      disclaimer: "検証用",
      full: { tradeCount: 20, winRate: 0.55, profitFactor: 1.4, maxDrawdownPct: 12, expectancyPct: 1.2, avgHoldingDays: 18 },
      firstHalf: { tradeCount: 11, winRate: 0.6, profitFactor: 1.6, maxDrawdownPct: 8, expectancyPct: 1.5, avgHoldingDays: 17 },
      secondHalf: { tradeCount: 9, winRate: 0.5, profitFactor: 1.2, maxDrawdownPct: 12, expectancyPct: 0.9, avgHoldingDays: 19 },
      substituteFills: 2,
      lapses: 0,
    },
  ],
});

beforeEach(() => window.localStorage.clear());

describe("signalComparisonRepository", () => {
  it("未保存なら null", () => {
    expect(loadStrategyComparison()).toBeNull();
  });
  it("保存 → 読込でラウンドトリップ", () => {
    const r = sample();
    saveStrategyComparison(r);
    expect(loadStrategyComparison()).toEqual(r);
  });
  it("破損 JSON は null", () => {
    window.localStorage.setItem(K.strategyComparison, "{ broken");
    expect(loadStrategyComparison()).toBeNull();
  });
  it("形状不正（entries 欠落）は null", () => {
    window.localStorage.setItem(K.strategyComparison, JSON.stringify({ generatedAt: "x", from: "a", to: "b" }));
    expect(loadStrategyComparison()).toBeNull();
  });
});
