/**
 * Phase 62 (v1.7): Advisor 算出の共有ヘルパー（保守性改善）。
 * 各画面（ランキング/Dashboard等）が同一手順で AdvisorReport を得るための集約関数。
 * 完全ローカル・外部API不使用・投資助言ではない。
 */
import type { Stock } from "@/lib/types";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded, getPrimaryStrategyId } from "@/lib/storage/strategyRepository";
import { analyzePortfolio, getCashPosition } from "@/lib/analysis/portfolio";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { getDashboardRuns } from "@/lib/settings/performance";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateDiscipline } from "@/lib/discipline/rules";
import { evaluateRisk } from "@/lib/risk/risk-engine";
import { analyzeFactors } from "@/lib/analytics/factor-analysis";
import { adaptiveScoreStock, getAdaptiveScoreSettings } from "@/lib/score/adaptive-score";
import { getBacktestSummaries } from "@/lib/analytics/backtest-engine";
import { getThresholds } from "@/lib/settings/thresholds";
import { buildAdvisorReport } from "@/lib/advisor/advisor-engine";
import { getPerStockBacktestMap } from "@/lib/advisor/advisor-provider";
import type { AdvisorReport } from "@/lib/advisor/advisorTypes";

export interface AdvisorContext {
  report: AdvisorReport;
  stocksByCode: Record<string, Stock>;
}

/** 全登録データから AdvisorReport を算出して返す（読み取り専用・非破壊）。 */
export async function computeAdvisorContext(): Promise<AdvisorContext> {
  const [stocks, holdings, trades, strategies] = await Promise.all([
    getStockRepository().list(),
    getHoldingRepository().list(),
    getTradeRepository().list(),
    ensureSeeded(),
  ]);
  const cash = getCashPosition();
  const th = getThresholds();
  const portfolio = analyzePortfolio(stocks, holdings, cash);
  const mc = trades.length ? runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: getDashboardRuns() }) : null;
  const discipline = evaluateDiscipline(stocks, holdings, trades, cash);
  const risk = mc ? evaluateRisk(portfolio, mc, runBacktest(trades), discipline, trades, th) : null;
  const factor = analyzeFactors(stocks, trades, strategies, risk, discipline);
  const weights = getAdaptiveScoreSettings().factorWeights;
  const adaptiveByCode: Record<string, number> = {};
  for (const s of stocks) adaptiveByCode[s.code] = adaptiveScoreStock(s, factor, weights).score;
  const primary = strategies.find((x) => x.id === getPrimaryStrategyId()) ?? strategies[0] ?? null;
  const report = buildAdvisorReport({
    stocks,
    holdings,
    portfolio,
    risk,
    discipline,
    btSummaries: getBacktestSummaries(),
    primaryStrategy: primary,
    thresholds: th,
    adaptiveByCode,
    perStock: getPerStockBacktestMap(),
  });
  const stocksByCode: Record<string, Stock> = {};
  for (const s of stocks) stocksByCode[s.code] = s;
  return { report, stocksByCode };
}
