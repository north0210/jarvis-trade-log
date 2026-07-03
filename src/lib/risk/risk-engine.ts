/**
 * Risk Engine（Phase 27・完全ローカル・純関数）。
 * MonteCarlo / Portfolio / Discipline / Backtest の結果を統合し、
 * 総合リスクスコア・VaR/CVaR・DD許容度・集中/テーマ/規律/流動性リスクを一元評価する。
 * 各サブ結果を入力に取り、alerts.ts / score.ts は変更しない。
 */
import type { Trade } from "@/lib/types";
import type { PortfolioAnalysis } from "@/lib/analysis/portfolio";
import type { MonteCarloResult } from "@/lib/analytics/montecarlo";
import type { BacktestResult } from "@/lib/analysis/backtest";
import type { DisciplineReport } from "@/lib/discipline/rules";

export type RiskLevel = "info" | "warning" | "danger";
export type RiskGrade = "S" | "A" | "B" | "C" | "D";

export interface RiskCategory {
  level: RiskLevel;
  label: string;
  detail: string;
}

export interface RiskReport {
  riskScore: number; // 0〜100（高いほど低リスク＝健全）
  riskGrade: RiskGrade;
  var95: number; // 1取引の95% VaR（損失額・正値）
  cvar95: number; // 期待ショートフォール（損失額・正値）
  var95Pct: number;
  cvar95Pct: number;
  maxDrawdown: number; // 実現損益バックテストの最大DD(%)
  dd95: number; // MonteCarlo の最大DD 95%ile(%)
  ruinProbability: number;
  halfCapitalProbability: number;
  concentrationRisk: RiskCategory;
  themeRisk: RiskCategory;
  disciplineRisk: RiskCategory;
  liquidityRisk: RiskCategory;
  dangerCount: number;
  warningCount: number;
  overallComment: string[];
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function gradeOf(score: number): RiskGrade {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

/** 危険/警告判定に用いるしきい値（Phase 49）。省略時は従来の固定値。 */
export interface RiskDangerThresholds {
  /** 破産確率(%)。既定 5。 */
  ruinProbabilityDanger?: number;
  /** 資産半減確率(%)。既定 10。 */
  halfCapitalProbabilityDanger?: number;
  /** 最大DD(%)。既定 30。 */
  drawdownWarning?: number;
}

export function evaluateRisk(
  portfolio: PortfolioAnalysis,
  mc: MonteCarloResult,
  backtest: BacktestResult,
  discipline: DisciplineReport,
  trades: Trade[],
  thresholds?: RiskDangerThresholds
): RiskReport {
  const capital = portfolio.totalAssets > 0 ? portfolio.totalAssets : 1_000_000;
  const ruinDanger = (thresholds?.ruinProbabilityDanger ?? 5) / 100;
  const halfDanger = (thresholds?.halfCapitalProbabilityDanger ?? 10) / 100;
  const ddWarn = thresholds?.drawdownWarning ?? 30;

  // VaR / CVaR（1取引損益の歴史的分布）
  const pnls = trades.map((t) => t.realizedPnl).sort((a, b) => a - b);
  const q05 = quantile(pnls, 0.05);
  const var95 = Math.max(0, -q05);
  const tail = pnls.filter((p) => p <= q05);
  const cvar95 = tail.length ? Math.max(0, -(tail.reduce((a, b) => a + b, 0) / tail.length)) : var95;

  const ruin = mc.ruinProb;
  const half = mc.halveProb;
  const dd95 = mc.dd95;
  const maxDrawdown = backtest.maxDrawdownPct;
  const conc = portfolio.maxPosition?.ratio ?? 0;
  const theme = portfolio.byTheme[0]?.ratio ?? 0;
  const disc = discipline.score;
  const cashR = portfolio.cashRatio;

  // カテゴリ判定
  const concentrationRisk: RiskCategory =
    conc >= 0.4
      ? { level: "warning", label: "集中リスク", detail: `最大集中 ${(conc * 100).toFixed(1)}%（${portfolio.maxPosition?.name ?? "—"}）` }
      : conc >= 0.25
        ? { level: "info", label: "集中リスク", detail: `最大集中 ${(conc * 100).toFixed(1)}%（やや高め）` }
        : { level: "info", label: "集中リスク", detail: `最大集中 ${(conc * 100).toFixed(1)}%（分散良好）` };

  const themeRisk: RiskCategory =
    theme >= 0.6
      ? { level: "warning", label: "テーマリスク", detail: `${portfolio.byTheme[0]?.key ?? "—"} ${(theme * 100).toFixed(1)}%` }
      : theme >= 0.4
        ? { level: "info", label: "テーマリスク", detail: `${portfolio.byTheme[0]?.key ?? "—"} ${(theme * 100).toFixed(1)}%（注意）` }
        : { level: "info", label: "テーマリスク", detail: `最大テーマ ${(theme * 100).toFixed(1)}%（良好）` };

  const disciplineRisk: RiskCategory =
    disc < 50
      ? { level: "danger", label: "規律リスク", detail: `規律スコア ${disc}` }
      : disc < 70
        ? { level: "warning", label: "規律リスク", detail: `規律スコア ${disc}` }
        : { level: "info", label: "規律リスク", detail: `規律スコア ${disc}（良好）` };

  const liquidityRisk: RiskCategory =
    cashR < 0.05
      ? { level: "danger", label: "流動性リスク", detail: `現金比率 ${(cashR * 100).toFixed(1)}%（余力枯渇）` }
      : cashR < 0.1
        ? { level: "warning", label: "流動性リスク", detail: `現金比率 ${(cashR * 100).toFixed(1)}%（低め）` }
        : { level: "info", label: "流動性リスク", detail: `現金比率 ${(cashR * 100).toFixed(1)}%（良好）` };

  // 総合スコア（減点方式・高いほど健全）
  let score = 100;
  if (ruin >= 0.05) score -= 25;
  else if (ruin >= 0.02) score -= 10;
  if (half >= 0.1) score -= 20;
  else if (half >= 0.05) score -= 8;
  if (dd95 >= 30) score -= 12;
  else if (dd95 >= 20) score -= 6;
  if (conc >= 0.4) score -= 12;
  else if (conc >= 0.25) score -= 5;
  if (theme >= 0.6) score -= 12;
  else if (theme >= 0.4) score -= 5;
  if (disc < 70) score -= 12;
  if (disc < 50) score -= 8;
  if (cashR < 0.1) score -= 6;
  score = Math.max(0, Math.min(100, score));
  const riskGrade = gradeOf(score);

  const cats = [concentrationRisk, themeRisk, disciplineRisk, liquidityRisk];
  let dangerCount = cats.filter((c) => c.level === "danger").length;
  let warningCount = cats.filter((c) => c.level === "warning").length;
  if (ruin >= ruinDanger) dangerCount++;
  if (half >= halfDanger) dangerCount++;
  if (dd95 >= ddWarn) warningCount++;

  // JARVIS コメント
  const overallComment: string[] = [];
  if (theme >= 0.6)
    overallComment.push(`現在のポートフォリオは${portfolio.byTheme[0]?.key ?? "特定"}テーマへの集中が高く、テーマリスクが上昇しています。`);
  if (conc >= 0.4)
    overallComment.push(`1銘柄比率が${(conc * 100).toFixed(0)}%に達しており、集中リスクに注意が必要です。`);
  if (ruin < 0.05 && dd95 >= 20)
    overallComment.push(`破産確率は低いものの、DD95%が${dd95.toFixed(0)}%です。許容できるか確認してください。`);
  if (ruin >= 0.05) overallComment.push(`破産確率が${(ruin * 100).toFixed(1)}%と高めです。ポジションサイズの抑制を強く推奨します。`);
  if (disc < 70) overallComment.push("規律スコアが低下しています。損切りルールの遵守を優先してください。");
  if (cashR < 0.1) overallComment.push(`現金比率が${(cashR * 100).toFixed(1)}%と低く、下落時の対応余力が限られます。`);
  if (overallComment.length === 0)
    overallComment.push(`総合リスクは Grade ${riskGrade}。主要指標は許容範囲内です。良好な状態です、ボス。`);
  else overallComment.unshift(`総合リスクは Grade ${riskGrade}（スコア ${score}）です。`);

  return {
    riskScore: score,
    riskGrade,
    var95,
    cvar95,
    var95Pct: (var95 / capital) * 100,
    cvar95Pct: (cvar95 / capital) * 100,
    maxDrawdown,
    dd95,
    ruinProbability: ruin,
    halfCapitalProbability: half,
    concentrationRisk,
    themeRisk,
    disciplineRisk,
    liquidityRisk,
    dangerCount,
    warningCount,
    overallComment,
  };
}
