/**
 * Market Radar（Phase 34・完全ローカル・純関数）。
 * 個別銘柄ではなく、保有・分析結果から「市場ポスチャ（攻め/守り）」を診断する。
 * 既存データのみ使用（Portfolio/Risk/MC/Discipline/Mental/Factor/Score）。
 * ※ 将来ニュース分析を接続できるよう、外部シグナルを任意入力で受け取れる設計とする。
 */
import type { Stock } from "@/lib/types";
import type { PortfolioAnalysis } from "@/lib/analysis/portfolio";
import type { RiskReport } from "@/lib/risk/risk-engine";
import type { MonteCarloResult } from "@/lib/analytics/montecarlo";
import type { DisciplineReport } from "@/lib/discipline/rules";
import type { MentalAnalysis } from "@/lib/mental/mental-analysis";
import type { FactorAnalysis } from "@/lib/analytics/factor-analysis";
import { scoreStock } from "@/lib/score";
import { stockFactors } from "@/lib/analytics/factor-analysis";

export type MarketState = "Bull" | "Recovery" | "Neutral" | "Sideways" | "Bear" | "Panic";
export type RiskMode = "Risk On" | "Neutral" | "Risk Off";

export interface MarketRadarResult {
  marketState: MarketState;
  riskMode: RiskMode;
  fearGreed: number; // 0〜100（0=極端な恐怖 / 100=極端な強欲）
  breadth: number; // 0〜100（良好銘柄の広がり）
  momentum: number; // 0〜100
  cashRecommendation: number; // 0〜100 %
  heatScore: number; // 0〜100（過熱度）
  warning: string[];
  jarvisComment: string[];
}

export interface RadarInputs {
  stocks: Stock[];
  portfolio: PortfolioAnalysis;
  risk: RiskReport | null;
  mc: MonteCarloResult | null;
  discipline: DisciplineReport;
  mental: MentalAnalysis | null;
  factor: FactorAnalysis;
  /** 将来のニュース分析用の外部センチメント（-1〜1）。未接続時は未指定。 */
  newsSentiment?: number;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

const STATE_JP: Record<MarketState, string> = {
  Bull: "強気（Bull）",
  Recovery: "回復（Recovery）",
  Neutral: "中立（Neutral）",
  Sideways: "もみ合い（Sideways）",
  Bear: "弱気（Bear）",
  Panic: "パニック（Panic）",
};

export function computeMarketRadar(input: RadarInputs): MarketRadarResult {
  const { stocks, portfolio, risk, mc, discipline, mental, factor } = input;

  const rsis = stocks.map((s) => s.rsi).filter((r): r is number => r != null);
  const avgRSI = rsis.length ? mean(rsis) : 50;
  const overheatedShare = stocks.length ? stocks.filter((s) => s.rsi != null && s.rsi >= 80).length / stocks.length : 0;
  const momentum = stocks.length ? clamp(mean(stocks.map((s) => stockFactors(s).momentum))) : 50;
  const breadth = stocks.length ? clamp((stocks.filter((s) => scoreStock(s).score >= 65).length / stocks.length) * 100) : 50;

  // Fear & Greed
  let fg = 50;
  fg += (avgRSI - 50) * 0.8;
  fg += (momentum - 50) * 0.4;
  fg += overheatedShare * 25;
  if (mc) fg -= mc.dd95 * 0.3;
  if (mental) fg += (mental.mentalScore - 60) * 0.1;
  if (input.newsSentiment != null) fg += input.newsSentiment * 15; // 将来接続
  fg = clamp(fg);

  const heatScore = clamp(0.5 * fg + 0.3 * momentum + 0.2 * (overheatedShare * 100));

  // Risk Mode（健全度が低い/過熱で Risk Off）
  const dangerRisk = !!risk && (risk.ruinProbability >= 0.05 || risk.dd95 >= 30 || risk.riskScore < 50);
  let riskMode: RiskMode;
  if (dangerRisk || heatScore >= 78) riskMode = "Risk Off";
  else if (risk && risk.riskScore >= 80 && heatScore < 62) riskMode = "Risk On";
  else riskMode = "Neutral";

  // Market State
  const panic = (risk && risk.ruinProbability >= 0.1) || fg < 18;
  let marketState: MarketState;
  if (panic) marketState = "Panic";
  else if (fg < 35 || (momentum < 40 && breadth < 40)) marketState = "Bear";
  else if (fg >= 68 && momentum >= 60 && breadth >= 55) marketState = "Bull";
  else if (momentum >= 52 && fg >= 45 && breadth >= 45) marketState = "Recovery";
  else if (Math.abs(momentum - 50) < 10 && breadth < 55) marketState = "Sideways";
  else marketState = "Neutral";

  // 現金推奨比率
  let cash = 12 + heatScore * 0.35;
  if (riskMode === "Risk Off") cash += 15;
  if (risk && risk.ruinProbability >= 0.05) cash += 15;
  if (risk && risk.dd95 >= 30) cash += 10;
  if (mental && mental.mentalScore < 50) cash += 5;
  if (riskMode === "Risk On") cash -= 8;
  const cashRecommendation = clamp(Math.round(cash), 5, 60);

  // 警告
  const warning: string[] = [];
  const momFactor = factor.factors.find((f) => f.key === "momentum");
  if (momentum >= 72 || (momFactor && momFactor.avgScore >= 75))
    warning.push("Momentum Factor が過熱しています。");
  if (portfolio.maxPosition && portfolio.maxPosition.ratio >= 0.4)
    warning.push(`銘柄集中リスク（${portfolio.maxPosition.name} ${(portfolio.maxPosition.ratio * 100).toFixed(0)}%）。`);
  if (portfolio.byTheme[0] && portfolio.byTheme[0].ratio >= 0.6)
    warning.push(`セクター/テーマ集中（${portfolio.byTheme[0].key} ${(portfolio.byTheme[0].ratio * 100).toFixed(0)}%）。`);
  if (overheatedShare >= 0.3) warning.push("RSI80以上の過熱銘柄が多数あります。");
  const volSurgeShare = stocks.length ? stocks.filter((s) => s.relativeVolume != null && s.relativeVolume >= 1.5).length / stocks.length : 0;
  if (volSurgeShare >= 0.3) warning.push("出来高急増（相対出来高≥1.5倍）の銘柄が多く、資金流入が活発です。");
  if (discipline.score < 70) warning.push("規律スコアが低下しています。");

  // JARVIS 所見
  const jarvisComment: string[] = [];
  jarvisComment.push(`現在は${STATE_JP[marketState]}相場です。リスクは${riskMode}。`);
  if (factor.bestFactor) jarvisComment.push(`${factor.bestFactor.label}優位。`);
  jarvisComment.push(`現金比率 ${cashRecommendation}% 推奨（現在 ${(portfolio.cashRatio * 100).toFixed(0)}%）。`);
  if (warning.some((w) => w.includes("Momentum")))
    jarvisComment.push("Momentum Factorが過熱しています。大型株・低ボラ銘柄への分散を推奨します。");
  if (riskMode === "Risk Off") jarvisComment.push("防御局面です。新規は抑制し、損切りラインの再確認を推奨します。");
  else if (riskMode === "Risk On") jarvisComment.push("攻めやすい局面です。ただし集中は避け、規律を維持してください。");

  return { marketState, riskMode, fearGreed: Math.round(fg), breadth: Math.round(breadth), momentum: Math.round(momentum), cashRecommendation, heatScore: Math.round(heatScore), warning, jarvisComment };
}
