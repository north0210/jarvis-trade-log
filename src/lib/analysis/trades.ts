/**
 * 取引履歴分析（完全ローカル・純関数）。
 * Trade[] から実現損益・勝率・平均利益/損失・保有期間・各種内訳・所見を算出する。
 */
import type { Trade } from "@/lib/types";

/** Score → Grade（score.ts と同一しきい値。score.ts は変更しないためここで判定）。 */
export function gradeOf(score: number | null): string {
  if (score == null) return "不明";
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

/** 2つの ISO 日時間の日数（切り捨て）。 */
export function daysBetween(fromISO: string | null | undefined, toISO: string): number | null {
  if (!fromISO) return null;
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.floor((to - from) / (24 * 60 * 60 * 1000)));
}

export function computeRealized(buyPrice: number, sellPrice: number, shares: number) {
  const pnl = (sellPrice - buyPrice) * shares;
  const rate = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;
  return { pnl, rate };
}

export interface GroupStat {
  key: string;
  count: number;
  pnl: number;
  wins: number;
  winRate: number;
  avgPnl: number;
}

export interface TradeAnalysis {
  count: number;
  totalRealizedPnl: number;
  wins: number;
  losses: number;
  winRate: number; // 0〜1
  avgWin: number;
  avgLoss: number; // 負値
  profitFactor: number | null; // 平均利益 / |平均損失|
  avgHoldingDays: number | null;
  maxWin: Trade | null;
  maxLoss: Trade | null;
  byStock: GroupStat[];
  byTheme: GroupStat[];
  byMonth: GroupStat[];
  byScoreGrade: GroupStat[];
  comments: string[];
}

function groupStats(trades: Trade[], keyFn: (t: Trade) => string): GroupStat[] {
  const m = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = keyFn(t);
    const arr = m.get(k) ?? [];
    arr.push(t);
    m.set(k, arr);
  }
  return Array.from(m.entries())
    .map(([key, ts]) => {
      const pnl = ts.reduce((a, t) => a + t.realizedPnl, 0);
      const wins = ts.filter((t) => t.realizedPnl > 0).length;
      return { key, count: ts.length, pnl, wins, winRate: ts.length ? wins / ts.length : 0, avgPnl: ts.length ? pnl / ts.length : 0 };
    })
    .sort((a, b) => b.pnl - a.pnl);
}

export function analyzeTrades(trades: Trade[]): TradeAnalysis {
  const count = trades.length;
  const winTrades = trades.filter((t) => t.realizedPnl > 0);
  const lossTrades = trades.filter((t) => t.realizedPnl < 0);
  const totalRealizedPnl = trades.reduce((a, t) => a + t.realizedPnl, 0);
  const avgWin = winTrades.length ? winTrades.reduce((a, t) => a + t.realizedPnl, 0) / winTrades.length : 0;
  const avgLoss = lossTrades.length ? lossTrades.reduce((a, t) => a + t.realizedPnl, 0) / lossTrades.length : 0;
  const profitFactor = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null;

  const daysList = trades.map((t) => t.holdingDays).filter((d): d is number => d != null);
  const avgHoldingDays = daysList.length ? daysList.reduce((a, d) => a + d, 0) / daysList.length : null;

  const sortedByPnl = trades.slice().sort((a, b) => b.realizedPnl - a.realizedPnl);
  const maxWin = sortedByPnl.length && sortedByPnl[0].realizedPnl > 0 ? sortedByPnl[0] : null;
  const maxLoss =
    sortedByPnl.length && sortedByPnl[sortedByPnl.length - 1].realizedPnl < 0
      ? sortedByPnl[sortedByPnl.length - 1]
      : null;

  const byStock = groupStats(trades, (t) => `${t.stockName} (${t.stockCode})`);
  const byTheme = groupStats(trades, (t) => t.theme || "未分類");
  const byMonth = groupStats(trades, (t) => t.date.slice(0, 7)).sort((a, b) => b.key.localeCompare(a.key));
  const byScoreGrade = groupStats(trades, (t) => gradeOf(t.scoreAtEntry));

  // JARVIS 所見
  const comments: string[] = [];
  if (count < 5) {
    comments.push("取引件数が少ないため、統計的判断はまだ限定的です。");
  }
  if (count > 0) {
    const bestTheme = byTheme.slice().sort((a, b) => b.winRate - a.winRate)[0];
    const worstTheme = byTheme.slice().sort((a, b) => a.avgPnl - b.avgPnl)[0];
    if (bestTheme && worstTheme && bestTheme.key !== worstTheme.key && worstTheme.avgPnl < 0) {
      comments.push(
        `${bestTheme.key}テーマの勝率が高い一方、${worstTheme.key}テーマでは平均損失が大きい傾向があります。`
      );
    }
    const highGrade = byScoreGrade.filter((g) => g.key === "S" || g.key === "A");
    const hgPnl = highGrade.reduce((a, g) => a + g.pnl, 0);
    if (highGrade.length && hgPnl > 0) {
      comments.push("Score A以上で入った取引の成績が良好です。");
    }
    if (avgWin > 0 && avgLoss < 0 && Math.abs(avgLoss) > avgWin) {
      comments.push("平均損失が平均利益を上回っています。利確が早く、損切りが遅い可能性があります。");
    }
    if (comments.length === 0 || (count >= 5 && (profitFactor ?? 0) >= 1.5)) {
      comments.push(`損益比は${profitFactor != null ? profitFactor.toFixed(2) : "—"}。全体として規律ある取引ができています、ボス。`);
    }
  }
  if (comments.length === 0) comments.push("取引履歴がありません。売却時に記録されます。");

  return {
    count,
    totalRealizedPnl,
    wins: winTrades.length,
    losses: lossTrades.length,
    winRate: count ? winTrades.length / count : 0,
    avgWin,
    avgLoss,
    profitFactor,
    avgHoldingDays,
    maxWin,
    maxLoss,
    byStock,
    byTheme,
    byMonth,
    byScoreGrade,
    comments,
  };
}
