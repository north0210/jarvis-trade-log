/**
 * バックテスト（Phase 24 MVP・完全ローカル）。
 *
 * 蓄積済みの確定取引（Trade）を「戦略×期間」でリプレイし、
 * エクイティカーブ・ドローダウン・PF・期待値・連勝連敗などを算出する。
 * ※ 真の価格系列シミュレーション（未約定の仮想売買）は Phase 25 で
 *    J-Quants 時系列取得により拡張予定。本MVPは実現損益ベース。
 */
import type { Trade } from "@/lib/types";

export interface EquityPoint {
  date: string;
  equity: number; // 累積純損益
  drawdown: number; // ピークからの下落額（正の値）
}

export interface BacktestResult {
  tradeCount: number;
  totalProfit: number; // 総利益（勝ちトレード合計）
  totalLoss: number; // 総損失（負けトレード合計・負値）
  netPnl: number;
  profitFactor: number | null;
  winRate: number;
  avgWin: number;
  avgLoss: number; // 負値
  expectancy: number; // 1取引あたり期待値
  maxDrawdown: number; // 金額
  maxDrawdownPct: number; // ピーク比%
  avgHoldingDays: number | null;
  maxWinStreak: number;
  maxLossStreak: number;
  equity: EquityPoint[];
  comments: string[];
}

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });

/** 取引リスト（フィルタ済み）からバックテスト結果を算出する。時系列は date→createdAt 昇順。 */
export function runBacktest(trades: Trade[]): BacktestResult {
  const sorted = trades.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.createdAt.localeCompare(b.createdAt);
  });

  const wins = sorted.filter((t) => t.realizedPnl > 0);
  const losses = sorted.filter((t) => t.realizedPnl < 0);
  const totalProfit = wins.reduce((a, t) => a + t.realizedPnl, 0);
  const totalLoss = losses.reduce((a, t) => a + t.realizedPnl, 0);
  const netPnl = totalProfit + totalLoss;
  const count = sorted.length;
  const winRate = count ? wins.length / count : 0;
  const avgWin = wins.length ? totalProfit / wins.length : 0;
  const avgLoss = losses.length ? totalLoss / losses.length : 0;
  const profitFactor = totalLoss !== 0 ? totalProfit / Math.abs(totalLoss) : null;
  const expectancy = count ? netPnl / count : 0;

  const days = sorted.map((t) => t.holdingDays).filter((d): d is number => d != null);
  const avgHoldingDays = days.length ? days.reduce((a, d) => a + d, 0) / days.length : null;

  // エクイティカーブ & 最大ドローダウン
  const equity: EquityPoint[] = [];
  let cum = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const t of sorted) {
    cum += t.realizedPnl;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (dd / peak) * 100);
    equity.push({ date: t.date, equity: cum, drawdown: dd });
  }

  // 連勝・連敗
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const t of sorted) {
    if (t.realizedPnl > 0) {
      curWin++;
      curLoss = 0;
    } else if (t.realizedPnl < 0) {
      curLoss++;
      curWin = 0;
    } else {
      curWin = 0;
      curLoss = 0;
    }
    maxWinStreak = Math.max(maxWinStreak, curWin);
    maxLossStreak = Math.max(maxLossStreak, curLoss);
  }

  // JARVIS 所見
  const comments: string[] = [];
  if (count === 0) {
    comments.push("対象期間・戦略に該当する取引がありません。条件を広げてください、ボス。");
  } else {
    comments.push(`取引${count}回、純損益 ¥${fmt(netPnl)}、期待値 ¥${fmt(expectancy)}/取引です。`);
    if (winRate < 0.5 && profitFactor != null && profitFactor > 1 && expectancy > 0)
      comments.push(`勝率${(winRate * 100).toFixed(0)}%ですが損益比${profitFactor.toFixed(1)}のため期待値はプラスです。`);
    else if (profitFactor != null)
      comments.push(`勝率${(winRate * 100).toFixed(0)}%、損益比${profitFactor.toFixed(1)}です。`);
    comments.push(`最大ドローダウンは ¥${fmt(maxDrawdown)}（${maxDrawdownPct.toFixed(1)}%）です。`);
    if (maxLossStreak <= 3) comments.push("連敗耐性は高い戦略です。");
    else comments.push(`最大連敗は${maxLossStreak}回。連敗耐性に注意が必要です。`);
    if (count < 10) comments.push("サンプルが少ないため、結果は参考程度に留めてください。");
  }

  return {
    tradeCount: count,
    totalProfit,
    totalLoss,
    netPnl,
    profitFactor,
    winRate,
    avgWin,
    avgLoss,
    expectancy,
    maxDrawdown,
    maxDrawdownPct,
    avgHoldingDays,
    maxWinStreak,
    maxLossStreak,
    equity,
    comments,
  };
}

/** 期間プリセット（月数）。任意期間は null。 */
export const PERIOD_OPTIONS: { key: string; label: string; months: number | null }[] = [
  { key: "1m", label: "1ヶ月", months: 1 },
  { key: "3m", label: "3ヶ月", months: 3 },
  { key: "6m", label: "6ヶ月", months: 6 },
  { key: "1y", label: "1年", months: 12 },
  { key: "all", label: "全期間", months: null },
  { key: "custom", label: "任意期間", months: null },
];
