/**
 * Factor 分析（Phase 28・完全ローカル・純関数）。
 * 銘柄のファクタースコア（Value/Growth/Quality/Momentum）を算出し、
 * 取引損益との相関から各ファクターの寄与を評価する。
 * Risk / Discipline はポートフォリオ・行動レベルのファクターとして併記する。
 * score.ts は変更しない（本モジュール内で独自のファクター指標を定義）。
 */
import type { Stock, Strategy, Trade } from "@/lib/types";
import type { RiskReport } from "@/lib/risk/risk-engine";
import type { DisciplineReport } from "@/lib/discipline/rules";

export type FactorKey = "value" | "growth" | "quality" | "momentum";

export interface StockFactors {
  value: number;
  growth: number;
  quality: number;
  momentum: number;
}

export interface FactorStat {
  key: FactorKey;
  label: string;
  avgScore: number; // 取引銘柄の平均ファクタースコア
  count: number; // 高エクスポージャ取引数（>=60）
  winRate: number;
  pnl: number;
  avgPnl: number;
  contribution: number; // 損益との相関 −1〜1
}

export interface FactorAnalysis {
  factors: FactorStat[];
  bestFactor: FactorStat | null;
  worstFactor: FactorStat | null;
  perStock: { code: string; name: string; factors: StockFactors; dominant: FactorKey }[];
  riskFactor: { grade: string; dd95: number; concentration: string };
  disciplineFactor: { score: number; violations: number };
  comments: string[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

const perScore = (per: number | null) =>
  per == null ? 50 : per <= 10 ? 100 : per <= 20 ? 85 : per <= 35 ? 65 : per <= 50 ? 45 : per <= 80 ? 25 : 10;
const pbrScore = (pbr: number | null) =>
  pbr == null ? 50 : pbr <= 1 ? 100 : pbr <= 3 ? 85 : pbr <= 8 ? 65 : pbr <= 15 ? 40 : 20;
const roeScore = (roe: number | null) =>
  roe == null ? 50 : roe >= 30 ? 100 : roe >= 20 ? 85 : roe >= 15 ? 70 : roe >= 10 ? 55 : roe >= 5 ? 40 : 25;
const sgScore = (sg: number | null) =>
  sg == null ? 50 : sg >= 50 ? 100 : sg >= 30 ? 85 : sg >= 20 ? 70 : sg >= 10 ? 55 : sg >= 0 ? 40 : 20;
const omScore = (om: number | null) =>
  om == null ? 50 : om >= 30 ? 100 : om >= 20 ? 85 : om >= 15 ? 70 : om >= 10 ? 55 : om >= 5 ? 40 : 25;
const rsiScore = (rsi: number | null) =>
  rsi == null ? 50 : rsi >= 80 ? 20 : rsi >= 70 ? 60 : rsi >= 55 ? 90 : rsi >= 45 ? 70 : rsi >= 30 ? 45 : 30;
const macdScore = (m: string) =>
  m === "ゴールデンクロス" ? 100 : m === "上昇中" ? 75 : m === "横ばい" ? 50 : m === "下降中" ? 30 : m === "デッドクロス" ? 10 : 50;

/** 銘柄のファクタースコア（各 0〜100）。 */
export function stockFactors(s: Stock): StockFactors {
  return {
    value: clamp((perScore(s.per) + pbrScore(s.pbr)) / 2),
    growth: clamp((sgScore(s.sales_growth) + roeScore(s.roe)) / 2),
    quality: clamp((omScore(s.operating_margin) + roeScore(s.roe)) / 2),
    momentum: clamp((rsiScore(s.rsi) + macdScore(s.macd)) / 2),
  };
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

const FACTOR_LABELS: Record<FactorKey, string> = {
  value: "Value（割安）",
  growth: "Growth（成長）",
  quality: "Quality（収益質）",
  momentum: "Momentum（勢い）",
};
const KEYS: FactorKey[] = ["value", "growth", "quality", "momentum"];

export function analyzeFactors(
  stocks: Stock[],
  trades: Trade[],
  _strategies: Strategy[],
  risk: RiskReport | null,
  discipline: DisciplineReport
): FactorAnalysis {
  void _strategies;
  const byCode = new Map(stocks.map((s) => [s.code, s]));

  // 取引ごとにファクタースコア（現在の銘柄データ・近似）と損益を紐付け
  const rows = trades
    .map((t) => {
      const s = byCode.get(t.stockCode);
      return s ? { f: stockFactors(s), ret: t.realizedPnlRate, pnl: t.realizedPnl } : null;
    })
    .filter((r): r is { f: StockFactors; ret: number; pnl: number } => !!r);

  const factors: FactorStat[] = KEYS.map((key) => {
    const scores = rows.map((r) => r.f[key]);
    const rets = rows.map((r) => r.ret);
    const high = rows.filter((r) => r.f[key] >= 60);
    const wins = high.filter((r) => r.pnl > 0).length;
    const pnl = high.reduce((a, r) => a + r.pnl, 0);
    return {
      key,
      label: FACTOR_LABELS[key],
      avgScore: mean(rows.length ? scores : stocks.map((s) => stockFactors(s)[key])),
      count: high.length,
      winRate: high.length ? wins / high.length : 0,
      pnl,
      avgPnl: high.length ? pnl / high.length : 0,
      contribution: pearson(scores, rets),
    };
  });

  const ranked = factors.slice().sort((a, b) => b.contribution - a.contribution);
  const bestFactor = ranked.length && ranked[0].contribution > 0 ? ranked[0] : null;
  const worstFactor = ranked.length && ranked[ranked.length - 1].contribution < 0 ? ranked[ranked.length - 1] : null;

  const perStock = stocks.map((s) => {
    const f = stockFactors(s);
    const dominant = KEYS.reduce((a, k) => (f[k] > f[a] ? k : a), KEYS[0]);
    return { code: s.code, name: s.name, factors: f, dominant };
  });

  const riskFactor = {
    grade: risk?.riskGrade ?? "—",
    dd95: risk?.dd95 ?? 0,
    concentration: risk?.concentrationRisk.detail ?? "—",
  };
  const disciplineFactor = { score: discipline.score, violations: discipline.results.length };

  // JARVIS 所見
  const comments: string[] = [];
  if (rows.length < 3) {
    comments.push("取引件数が少なく、ファクター寄与の統計判断は限定的です。");
  } else {
    if (bestFactor)
      comments.push(
        `勝ち取引では${bestFactor.label}が効いています（相関 ${(bestFactor.contribution * 100).toFixed(0)}%）。この要因が成績に寄与しています。`
      );
    const value = factors.find((f) => f.key === "value");
    if (value && Math.abs(value.contribution) < 0.15)
      comments.push("Value Factorの寄与は限定的です。割安株より成長株の方が現在の運用と相性が良い可能性があります。");
    const mom = factors.find((f) => f.key === "momentum");
    if (mom && mom.contribution < -0.1)
      comments.push("Momentum Factorが高い銘柄で損失が出ています。過熱時のエントリーに注意してください。");
    if (worstFactor)
      comments.push(`${worstFactor.label}は現状マイナス寄与です。該当条件のエントリを見直す余地があります。`);
  }
  if (risk && (risk.riskGrade === "C" || risk.riskGrade === "D"))
    comments.push(`Risk Factor: 総合リスク Grade ${risk.riskGrade}。リスク側の管理も併せて確認してください。`);
  if (discipline.score < 70) comments.push("Discipline Factor: 規律スコアが低下しています。ルール遵守が成績の底上げに繋がります。");

  return { factors, bestFactor, worstFactor, perStock, riskFactor, disciplineFactor, comments };
}
