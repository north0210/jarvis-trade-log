/**
 * 戦略バックテスト一括実行（Phase 38・完全ローカル・純関数）。
 * 登録戦略を価格系列バックテスト（backtest-engine）へ一括投入し、
 * CAGR/PF/最大DD/勝率/期待値/Sharpe/Sortino でランキングする。
 * 日足系列は呼び出し側で取得（キャッシュ優先）して渡す。
 */
import type { Stock, Strategy } from "@/lib/types";
import type { SeriesPoint } from "@/lib/analytics/priceCache";
import { runEngineBacktest, selectUniverse, type EngineResult } from "@/lib/analytics/backtest-engine";
import { scoreStock } from "@/lib/score";

const MAX_UNIVERSE = 12;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export interface StrategyBatchResult {
  strategyId: string;
  strategyName: string;
  tradeCount: number;
  winRate: number;
  profitFactor: number | null;
  cagr: number;
  maxDrawdown: number;
  expectedValue: number; // 1取引あたり平均リターン(%)
  sharpe: number;
  sortino: number;
  finalEquity: number;
  rank: number; // CAGR 降順の順位
  jarvisComment: string;
  engine: EngineResult; // 詳細・サマリー保存用
}

function comment(r: EngineResult): string {
  if (r.tradeCount === 0) return "エントリ条件を満たす場面がありませんでした。";
  const parts: string[] = [];
  if (r.cagr >= 15 && r.maxDrawdownPct >= 25) parts.push("CAGRが高い一方、最大DDも大きめです。");
  else if (r.cagr < 8 && r.maxDrawdownPct < 15) parts.push("リターンは控えめですが、DDが安定しています。");
  if (r.profitFactor != null && r.profitFactor >= 1.8 && r.tradeCount < 10) parts.push("PFは高いものの、取引回数が少なく統計的信頼性は限定的です。");
  if (r.tradeCount < 10 && parts.length === 0) parts.push("取引回数が少なく、結果は参考程度に留めてください。");
  if (parts.length === 0) parts.push(`CAGR ${r.cagr.toFixed(1)}% / 最大DD ${r.maxDrawdownPct.toFixed(1)}% / 勝率 ${(r.winRate * 100).toFixed(0)}%。`);
  return parts.join(" ");
}

export function runStrategyBatch(
  strategies: Strategy[],
  stocks: Stock[],
  seriesByCode: Map<string, SeriesPoint[]>,
  from: string,
  to: string,
  initialCapital: number
): StrategyBatchResult[] {
  const results: StrategyBatchResult[] = strategies.map((strategy) => {
    let universe = selectUniverse(stocks, strategy);
    if (universe.length > MAX_UNIVERSE) {
      universe = universe.slice().sort((a, b) => scoreStock(b).score - scoreStock(a).score).slice(0, MAX_UNIVERSE);
    }
    const perCode = universe
      .map((s) => ({ code: s.code, series: seriesByCode.get(s.code) ?? [] }))
      .filter((x) => x.series.length > 0);
    const r = runEngineBacktest(perCode, strategy, from, to);
    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      tradeCount: r.tradeCount,
      winRate: r.winRate,
      profitFactor: r.profitFactor,
      cagr: r.cagr,
      maxDrawdown: r.maxDrawdownPct,
      expectedValue: mean(r.tradeReturns),
      sharpe: r.sharpe,
      sortino: r.sortino,
      finalEquity: initialCapital * (1 + r.totalReturnPct / 100),
      rank: 0,
      jarvisComment: comment(r),
      engine: r,
    };
  });

  results
    .slice()
    .sort((a, b) => b.cagr - a.cagr)
    .forEach((r, i) => {
      r.rank = i + 1;
    });
  return results;
}

/** 出来高条件を無効化した戦略コピーを返す（あり/なし比較用）。 */
export function stripVolumeConditions(strategy: Strategy): Strategy {
  return { ...strategy, minRelativeVolume: null, requiredVolumeTrend: null, avoidVolumeSpikeWithHighRsi: false };
}

/** 全戦略の対象ユニバース（現在の銘柄プールから）のユニークコード集合を返す。 */
export function collectBatchCodes(strategies: Strategy[], stocks: Stock[]): string[] {
  const set = new Set<string>();
  for (const strategy of strategies) {
    let universe = selectUniverse(stocks, strategy);
    if (universe.length > MAX_UNIVERSE) {
      universe = universe.slice().sort((a, b) => scoreStock(b).score - scoreStock(a).score).slice(0, MAX_UNIVERSE);
    }
    universe.forEach((s) => set.add(s.code));
  }
  return Array.from(set);
}
