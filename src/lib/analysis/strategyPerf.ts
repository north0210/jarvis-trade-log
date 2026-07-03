/**
 * 戦略別成績分析（完全ローカル・純関数）。
 * 取引履歴を戦略ごとに集計し、成績と所見を返す。
 * 既存の analyzeTrades / matchStrategy / scoreStock を再利用する。
 */
import type { Stock, Strategy, Trade } from "@/lib/types";
import { analyzeTrades } from "./trades";
import { matchStrategy } from "@/lib/strategy/match";
import { scoreStock } from "@/lib/score";

export interface StrategyStat {
  id: string | null; // null = 未分類
  name: string;
  count: number;
  wins: number;
  winRate: number;
  totalRealizedPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  avgHoldingDays: number | null;
  maxWin: Trade | null;
  maxLoss: Trade | null;
}

const NONE = "__none__";

function toStat(id: string | null, name: string, ts: Trade[]): StrategyStat {
  const a = analyzeTrades(ts);
  return {
    id,
    name,
    count: a.count,
    wins: a.wins,
    winRate: a.winRate,
    totalRealizedPnl: a.totalRealizedPnl,
    avgWin: a.avgWin,
    avgLoss: a.avgLoss,
    profitFactor: a.profitFactor,
    avgHoldingDays: a.avgHoldingDays,
    maxWin: a.maxWin,
    maxLoss: a.maxLoss,
  };
}

/** 戦略別に取引を集計し、実現損益の高い順で返す。 */
export function analyzeByStrategy(trades: Trade[], strategies: Strategy[]): StrategyStat[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = t.strategyId ?? NONE;
    const arr = groups.get(k) ?? [];
    arr.push(t);
    groups.set(k, arr);
  }
  const stats: StrategyStat[] = [];
  for (const s of strategies) {
    const ts = groups.get(s.id);
    if (ts && ts.length) stats.push(toStat(s.id, s.name, ts));
  }
  const none = groups.get(NONE);
  if (none && none.length) stats.push(toStat(null, "未分類", none));
  return stats.sort((a, b) => b.totalRealizedPnl - a.totalRealizedPnl);
}

/**
 * 戦略未設定の取引について、現在の銘柄データから推定戦略名を返す（確定ではない）。
 * 「見送り条件」は除外し、最初に完全適合した戦略を候補とする。
 */
export function estimateStrategy(trade: Trade, stocks: Stock[], strategies: Strategy[]): string | null {
  if (trade.strategyId) return null;
  const stock = stocks.find((s) => s.code === trade.stockCode);
  if (!stock) return null;
  const score = scoreStock(stock);
  for (const s of strategies) {
    if (s.name.includes("見送り")) continue;
    const r = matchStrategy(s, stock, score, { hasStopLoss: stock.stop_loss != null });
    if (r.status === "match") return `推定：${s.name} 候補`;
  }
  return null;
}

/** 取引の戦略IDを返す（設定済みならそれ、無ければ現在データから推定）。見送りは除外。 */
export function estimateStrategyId(trade: Trade, stocks: Stock[], strategies: Strategy[]): string | null {
  if (trade.strategyId) return trade.strategyId;
  const stock = stocks.find((s) => s.code === trade.stockCode);
  if (!stock) return null;
  const score = scoreStock(stock);
  for (const s of strategies) {
    if (s.name.includes("見送り")) continue;
    if (matchStrategy(s, stock, score, { hasStopLoss: stock.stop_loss != null }).status === "match") return s.id;
  }
  return null;
}

/** JARVIS 戦略成績コメント。 */
export function strategyPerfComments(stats: StrategyStat[]): string[] {
  const out: string[] = [];
  const totalTrades = stats.reduce((a, s) => a + s.count, 0);
  if (totalTrades < 5) out.push("取引件数が少ないため、統計判断はまだ限定的です。");

  const ranked = stats.filter((s) => s.count > 0);
  if (ranked.length) {
    const best = ranked[0];
    out.push(
      `${best.name}戦略の勝率は${(best.winRate * 100).toFixed(0)}%、損益比は${best.profitFactor != null ? best.profitFactor.toFixed(1) : "—"}です。現在のところ最も相性の良い戦略です。`
    );
    // 高利益・高リスク傾向
    const risky = ranked.find((s) => s.avgWin > 0 && s.avgLoss < 0 && Math.abs(s.avgLoss) > s.avgWin * 1.2);
    if (risky) {
      out.push(`${risky.name}は利益が出る一方、損失幅も大きい傾向があります。ポジションサイズを抑える余地があります。`);
    }
    const worst = ranked[ranked.length - 1];
    if (ranked.length > 1 && worst.totalRealizedPnl < 0) {
      out.push(`${worst.name}は現状マイナスです。条件の見直しを検討してください、ボス。`);
    }
  }
  if (out.length === 0) out.push("戦略に紐付いた取引がありません。売却時に戦略を選択すると分析されます。");
  return out;
}
