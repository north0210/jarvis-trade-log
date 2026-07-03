/**
 * 戦略適合判定（完全ローカル・純関数）。
 * 銘柄と戦略テンプレートを照合し、適合/一部適合/不適合と違反項目を返す。
 * scoreStock の結果と保有コンテキスト（比率・損切り有無）を入力にする。
 */
import type { Stock, Strategy } from "@/lib/types";
import type { ScoreResult } from "@/lib/score";

export type MatchStatus = "match" | "partial" | "nomatch";

export interface MatchContext {
  positionRatio?: number | null; // 保有時の1銘柄比率（0〜1）。未保有は null
  hasStopLoss?: boolean; // 損切りライン設定有無
}

export interface MatchResult {
  status: MatchStatus;
  passed: string[];
  violations: string[];
  applicable: number;
}

export function matchStrategy(
  strategy: Strategy,
  stock: Stock,
  score: ScoreResult,
  ctx: MatchContext = {}
): MatchResult {
  const passed: string[] = [];
  const violations: string[] = [];
  const ok = (label: string) => passed.push(label);
  const ng = (label: string) => violations.push(label);

  if (strategy.minScore != null) {
    if (score.score >= strategy.minScore) ok(`Score ${score.score}（条件${strategy.minScore}以上）`);
    else ng(`Scoreが${score.score}で条件${strategy.minScore}に届いていません`);
  }
  if (strategy.allowedGrades.length > 0) {
    if (strategy.allowedGrades.includes(score.grade)) ok(`Grade ${score.grade}`);
    else ng(`Grade ${score.grade} は対象(${strategy.allowedGrades.join("/")})外です`);
  }
  if (strategy.maxRsi != null && stock.rsi != null) {
    if (stock.rsi <= strategy.maxRsi) ok(`RSI ${stock.rsi}（上限${strategy.maxRsi}）`);
    else ng(`RSIが${stock.rsi}で上限${strategy.maxRsi}を超えています`);
  }
  if (strategy.minRoe != null && stock.roe != null) {
    if (stock.roe >= strategy.minRoe) ok(`ROE ${stock.roe}%`);
    else ng(`ROEが${stock.roe}%で条件${strategy.minRoe}%未満です`);
  }
  if (strategy.minOperatingMargin != null && stock.operating_margin != null) {
    if (stock.operating_margin >= strategy.minOperatingMargin) ok(`営業利益率 ${stock.operating_margin}%`);
    else ng(`営業利益率が${stock.operating_margin}%で条件${strategy.minOperatingMargin}%未満です`);
  }
  if (strategy.minSalesGrowth != null && stock.sales_growth != null) {
    if (stock.sales_growth >= strategy.minSalesGrowth) ok(`売上成長率 ${stock.sales_growth}%`);
    else ng(`売上成長率が${stock.sales_growth}%で条件${strategy.minSalesGrowth}%未満です`);
  }
  if (strategy.maxPer != null && stock.per != null) {
    if (stock.per <= strategy.maxPer) ok(`PER ${stock.per}（上限${strategy.maxPer}）`);
    else ng(`PERが${stock.per}で上限${strategy.maxPer}を超えています`);
  }
  if (strategy.maxPbr != null && stock.pbr != null) {
    if (stock.pbr <= strategy.maxPbr) ok(`PBR ${stock.pbr}（上限${strategy.maxPbr}）`);
    else ng(`PBRが${stock.pbr}で上限${strategy.maxPbr}を超えています`);
  }
  if (strategy.requiresStopLoss) {
    const has = ctx.hasStopLoss ?? stock.stop_loss != null;
    if (has) ok("損切りライン設定済み");
    else ng("損切りラインが未設定です");
  }
  if (strategy.maxPositionRate != null && ctx.positionRatio != null) {
    const ratePct = ctx.positionRatio * 100;
    if (ratePct <= strategy.maxPositionRate) ok(`1銘柄比率 ${ratePct.toFixed(1)}%`);
    else ng(`1銘柄比率が${ratePct.toFixed(1)}%で上限${strategy.maxPositionRate}%を超えています`);
  }

  const applicable = passed.length + violations.length;
  let status: MatchStatus;
  if (applicable === 0) status = "nomatch";
  else if (violations.length === 0) status = "match";
  else if (passed.length >= violations.length) status = "partial";
  else status = "nomatch";

  return { status, passed, violations, applicable };
}
