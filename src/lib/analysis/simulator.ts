/**
 * 売買シミュレーション（完全ローカル・純関数）。
 * 現在の保有・現金に仮想トレードを重ね、analyzePortfolio() で Before/After を算出する。
 * 既存の analyzePortfolio / pnl / scoreStock を再利用し、それらは変更しない。
 */
import type { Holding, Stock } from "@/lib/types";
import { analyzePortfolio, type PortfolioAnalysis } from "./portfolio";

export type SimAction = "buy" | "add" | "sellPartial" | "sellAll";

export interface SimTrade {
  stockId: string;
  action: SimAction;
  shares: number;
  price: number;
  cashDelta: number; // 任意の入金/出金（自動計算とは別枠）
}

/** 仮想トレードを holdings/cash に適用した結果を返す（永続化しない）。 */
export function applyTrade(
  holdings: Holding[],
  cash: number,
  trade: SimTrade
): { holdings: Holding[]; cash: number } {
  const { stockId, action, shares, price } = trade;
  const stockHoldings = holdings.filter((h) => h.stock_id === stockId);
  const totalShares = stockHoldings.reduce((a, h) => a + h.shares, 0);
  const totalCost = stockHoldings.reduce((a, h) => a + h.buy_price * h.shares, 0);
  const avg = totalShares > 0 ? totalCost / totalShares : 0;

  let next = holdings.slice();
  let nextCash = cash + (trade.cashDelta || 0);

  const mk = (buy_price: number, sh: number): Holding => ({
    id: "sim",
    stock_id: stockId,
    buy_price,
    shares: sh,
    stop_loss: null,
    take_profit: null,
  });

  switch (action) {
    case "buy":
    case "add":
      next = [...next, mk(price, shares)];
      nextCash -= price * shares;
      break;
    case "sellPartial": {
      const remain = Math.max(0, totalShares - shares);
      next = next.filter((h) => h.stock_id !== stockId);
      if (remain > 0) next.push(mk(avg, remain));
      nextCash += price * Math.min(shares, totalShares);
      break;
    }
    case "sellAll":
      next = next.filter((h) => h.stock_id !== stockId);
      nextCash += price * totalShares;
      break;
  }
  return { holdings: next, cash: Math.max(0, nextCash) };
}

/** Before/After のポートフォリオ分析を返す。 */
export function simulate(
  stocks: Stock[],
  holdings: Holding[],
  cash: number,
  trade: SimTrade
): { before: PortfolioAnalysis; after: PortfolioAnalysis } {
  const before = analyzePortfolio(stocks, holdings, cash);
  const applied = applyTrade(holdings, cash, trade);
  const after = analyzePortfolio(stocks, applied.holdings, applied.cash);
  return { before, after };
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

/** Before/After から JARVIS 判定コメントを生成する。 */
export function simulationComment(
  before: PortfolioAnalysis,
  after: PortfolioAnalysis
): string[] {
  const lines: string[] = [];

  const topTheme = after.byTheme[0];
  if (topTheme && topTheme.ratio >= 0.6)
    lines.push(`この操作で${topTheme.key}テーマ比率が${pct(topTheme.ratio)}になります。テーマ集中リスクがあります。`);

  if (after.cashRatio < 0.1)
    lines.push(`現金比率が${pct(after.cashRatio)}まで低下します。押し目用資金が不足します。`);

  if (before.scoreAvg != null && after.scoreAvg != null) {
    const d = after.scoreAvg - before.scoreAvg;
    if (d >= 1)
      lines.push(`平均Scoreが${before.scoreAvg.toFixed(0)}から${after.scoreAvg.toFixed(0)}へ改善します。構成品質は向上しています。`);
    else if (d <= -1)
      lines.push(`平均Scoreが${before.scoreAvg.toFixed(0)}から${after.scoreAvg.toFixed(0)}へ低下します。構成品質に注意してください。`);
  }

  if (after.maxPosition && after.maxPosition.ratio >= 0.4)
    lines.push(`1銘柄比率が${pct(after.maxPosition.ratio)}を超えます（${after.maxPosition.name}）。買付額を抑えることを検討してください。`);

  if (after.warnings.length > before.warnings.length)
    lines.push(`リスク警告が${before.warnings.length}件から${after.warnings.length}件へ増加します。`);
  else if (after.warnings.length < before.warnings.length)
    lines.push(`リスク警告が${before.warnings.length}件から${after.warnings.length}件へ減少します。改善傾向です。`);

  if (lines.length === 0)
    lines.push("この操作による重大なリスク変化は検出されません。妥当な構成です、ボス。");

  return lines;
}

// ---- シミュレーション履歴（localStorage） ----
const KEY = "jarvis-trade-log:simulations";
const MAX = 30;

export interface SimSummary {
  totalValue: number;
  cashRatio: number;
  pnlPct: number;
  scoreAvg: number | null;
  maxRatio: number;
  warnings: number;
}

export interface SimulationRecord {
  id: string;
  date: string;
  stockCode: string;
  stockName: string;
  action: SimAction;
  shares: number;
  price: number;
  beforeSummary: SimSummary;
  afterSummary: SimSummary;
  jarvisComment: string;
  createdAt: string;
}

export function summarize(a: PortfolioAnalysis): SimSummary {
  return {
    totalValue: a.totalValue,
    cashRatio: a.cashRatio,
    pnlPct: a.pnlPct,
    scoreAvg: a.scoreAvg,
    maxRatio: a.maxPosition?.ratio ?? 0,
    warnings: a.warnings.length,
  };
}

export function getSimulations(): SimulationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SimulationRecord[]) : [];
  } catch {
    return [];
  }
}

export function appendSimulation(record: SimulationRecord): void {
  if (typeof window === "undefined") return;
  const log = getSimulations();
  log.unshift(record);
  while (log.length > MAX) log.pop();
  window.localStorage.setItem(KEY, JSON.stringify(log));
}
