/**
 * ポートフォリオ分析（完全ローカル・純関数）。
 * 保有株・銘柄・現金から配分／リスク集中／リバランス提案を算出する。
 * 既存の score.ts（scoreStock）・alerts.ts（pnl/holdingDangerLevel）を再利用し、
 * それらのロジックは変更しない。
 */
import type { Holding, Stock } from "@/lib/types";
import { scoreStock, type ScoreResult } from "@/lib/score";
import { holdingDangerLevel, pnl } from "@/lib/alerts";

const CASH_KEY = "jarvis-trade-log:cash-position";

export function getCashPosition(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(CASH_KEY);
  const n = raw == null ? 0 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function setCashPosition(value: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CASH_KEY, String(Math.max(0, value)));
}

export interface AllocationSlice {
  key: string;
  value: number;
  ratio: number; // 0〜1（保有評価額に対する比率）
}

export interface PortfolioAnalysis {
  totalValue: number; // 保有評価額
  totalCost: number;
  pnl: number;
  pnlPct: number;
  cash: number;
  totalAssets: number; // 評価額＋現金
  cashRatio: number; // 0〜1（総資産に対する現金比率）
  holdingCount: number;
  scoreAvg: number | null; // 評価額加重の Score 平均
  maxPosition: { name: string; code: string; ratio: number } | null;
  dangerCount: number;
  byStock: AllocationSlice[];
  byTheme: AllocationSlice[];
  byGrade: AllocationSlice[];
  byStatus: AllocationSlice[];
  warnings: { level: "danger" | "caution"; text: string }[];
  suggestions: string[];
  riskLevel: "safe" | "caution" | "danger";
}

interface Position {
  stock: Stock;
  shares: number;
  cost: number;
  value: number;
  grade: ScoreResult["grade"];
  score: number;
  pnlPct: number;
  danger: boolean;
}

const pctStr = (r: number) => (r * 100).toFixed(1);

function group(positions: Position[], keyFn: (p: Position) => string, total: number): AllocationSlice[] {
  const m = new Map<string, number>();
  for (const p of positions) m.set(keyFn(p), (m.get(keyFn(p)) ?? 0) + p.value);
  return Array.from(m.entries())
    .map(([key, value]) => ({ key, value, ratio: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

export function analyzePortfolio(stocks: Stock[], holdings: Holding[], cash: number): PortfolioAnalysis {
  const byId = new Map(stocks.map((s) => [s.id, s]));

  // 銘柄単位に集約（同一銘柄の複数保有をまとめる）
  const agg = new Map<string, { stock: Stock; shares: number; cost: number; value: number }>();
  for (const h of holdings) {
    const stock = byId.get(h.stock_id);
    if (!stock) continue;
    const cost = h.buy_price * h.shares;
    const value = stock.current_price != null ? stock.current_price * h.shares : cost; // 価格未入力は簿価
    const cur = agg.get(h.stock_id) ?? { stock, shares: 0, cost: 0, value: 0 };
    cur.shares += h.shares;
    cur.cost += cost;
    cur.value += value;
    agg.set(h.stock_id, cur);
  }

  const positions: Position[] = Array.from(agg.values()).map((p) => {
    const result = scoreStock(p.stock);
    const avg = p.shares > 0 ? p.cost / p.shares : 0;
    const synth: Holding = {
      id: "",
      stock_id: p.stock.id,
      buy_price: avg,
      shares: p.shares,
      stop_loss: null,
      take_profit: null,
    };
    const level = holdingDangerLevel(synth, p.stock);
    const pr = p.stock.current_price != null ? pnl(synth, p.stock.current_price) : null;
    return {
      stock: p.stock,
      shares: p.shares,
      cost: p.cost,
      value: p.value,
      grade: result.grade,
      score: result.score,
      pnlPct: pr ? pr.pct : 0,
      danger: level === "danger",
    };
  });

  const totalValue = positions.reduce((a, p) => a + p.value, 0);
  const totalCost = positions.reduce((a, p) => a + p.cost, 0);
  const pnlAbs = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? (pnlAbs / totalCost) * 100 : 0;
  const totalAssets = totalValue + cash;
  const cashRatio = totalAssets > 0 ? cash / totalAssets : 0;

  const byStock = group(positions, (p) => `${p.stock.name} (${p.stock.code})`, totalValue);
  const byTheme = group(positions, (p) => p.stock.theme || "未分類", totalValue);
  const byGrade = group(positions, (p) => p.grade, totalValue);
  const byStatus = group(positions, (p) => p.stock.status, totalValue);

  const scoreAvg =
    totalValue > 0 ? positions.reduce((a, p) => a + p.score * p.value, 0) / totalValue : null;

  const top = positions.slice().sort((a, b) => b.value - a.value)[0];
  const maxPosition =
    top && totalValue > 0
      ? { name: `${top.stock.name} (${top.stock.code})`, code: top.stock.code, ratio: top.value / totalValue }
      : null;

  const dangerCount = positions.filter((p) => p.danger).length;

  const topTheme = byTheme[0];
  const saRatio = byGrade.filter((g) => g.key === "S" || g.key === "A").reduce((a, g) => a + g.ratio, 0);
  const cdRatio = byGrade.filter((g) => g.key === "C" || g.key === "D").reduce((a, g) => a + g.ratio, 0);
  const lossNames = positions.filter((p) => p.pnlPct <= -5).map((p) => `${p.stock.name}(${p.stock.code})`);
  const overheatNames = positions
    .filter((p) => p.stock.rsi != null && p.stock.rsi >= 80)
    .map((p) => `${p.stock.name}(${p.stock.code})`);

  // リスク警告
  const warnings: PortfolioAnalysis["warnings"] = [];
  if (maxPosition && maxPosition.ratio >= 0.4)
    warnings.push({ level: "danger", text: `集中リスク: ${maxPosition.name} が ${pctStr(maxPosition.ratio)}%` });
  if (topTheme && topTheme.ratio >= 0.6)
    warnings.push({ level: "danger", text: `テーマ集中リスク: ${topTheme.key} が ${pctStr(topTheme.ratio)}%` });
  if (cdRatio >= 0.3) warnings.push({ level: "caution", text: `品質リスク: Grade C/D が ${pctStr(cdRatio)}%` });
  if (lossNames.length) warnings.push({ level: "danger", text: `損切確認: ${lossNames.join("、")}` });
  if (overheatNames.length) warnings.push({ level: "caution", text: `過熱注意: ${overheatNames.join("、")}（RSI≥80）` });
  if (totalValue > 0 && cashRatio < 0.1) warnings.push({ level: "caution", text: `現金比率が ${pctStr(cashRatio)}% と低め` });

  // リバランス提案
  const suggestions: string[] = [];
  if (maxPosition && maxPosition.ratio >= 0.4)
    suggestions.push(`${maxPosition.name} の比率が${pctStr(maxPosition.ratio)}%です。1銘柄集中リスクがあります。分散を検討してください。`);
  if (topTheme && topTheme.ratio >= 0.6)
    suggestions.push(`${topTheme.key}テーマが${pctStr(topTheme.ratio)}%を超えています。防衛・インフラ・半導体など他テーマへの分散を検討してください。`);
  if (saRatio >= 0.7) suggestions.push(`Grade A以上の比率が${pctStr(saRatio)}%です。ポートフォリオ品質は良好です。`);
  else if (cdRatio >= 0.3) suggestions.push(`低評価(Grade C/D)の比率が${pctStr(cdRatio)}%です。品質改善を検討してください。`);
  if (totalValue > 0 && cashRatio < 0.1) suggestions.push(`現金比率が${pctStr(cashRatio)}%未満です。押し目用資金が不足しています。`);
  if (lossNames.length) suggestions.push(`損益率が-5%を下回る銘柄があります（${lossNames.join("、")}）。損切りラインを確認してください、ボス。`);
  if (suggestions.length === 0)
    suggestions.push("現時点でポートフォリオに大きな偏りはありません。良好な状態です、ボス。");

  const riskLevel: PortfolioAnalysis["riskLevel"] = warnings.some((w) => w.level === "danger")
    ? "danger"
    : warnings.length > 0
      ? "caution"
      : "safe";

  return {
    totalValue,
    totalCost,
    pnl: pnlAbs,
    pnlPct,
    cash,
    totalAssets,
    cashRatio,
    holdingCount: positions.length,
    scoreAvg,
    maxPosition,
    dangerCount,
    byStock,
    byTheme,
    byGrade,
    byStatus,
    warnings,
    suggestions,
    riskLevel,
  };
}
