/**
 * Phase 51 (v1.1精緻化): JARVIS Advisor エンジン（完全ローカル・純関数）。
 * 既存の分析出力を読み取り専用で統合し、加重合成スコアで売買候補を提示する。
 * score.ts / alerts.ts / risk / strategy / provider は一切変更しない。
 * 自動売買・証券口座連携・断定表現は行わない。投資助言ではない。
 */
import type { Holding, Stock, Strategy } from "@/lib/types";
import { scoreStock } from "@/lib/score";
import { stockAlerts } from "@/lib/alerts";
import { matchStrategy } from "@/lib/strategy/match";
import type { PortfolioAnalysis } from "@/lib/analysis/portfolio";
import type { RiskReport } from "@/lib/risk/risk-engine";
import type { DisciplineReport } from "@/lib/discipline/rules";
import type { BacktestSummary } from "@/lib/analytics/backtest-engine";
import { getThresholds, type ThresholdSettings } from "@/lib/settings/thresholds";
import { getAdvisorWeights } from "@/lib/settings/advisor-settings";
import type { PerStockBacktestMap } from "./perStockBacktest";
import { decide, type GlobalSignals, type StockSignals, type Thresholds } from "./advisorRules";
import {
  CATEGORY_ORDER,
  type AdvisorItem,
  type AdvisorReport,
  type AdvisorCategory,
  type AdvisorCounts,
  type AdvisorWeights,
} from "./advisorTypes";

const DISCLAIMER = "本機能は投資助言ではなく判断補助です。自動売買は行いません。最終判断はご自身で。";

export interface AdvisorInput {
  stocks: Stock[];
  holdings: Holding[];
  portfolio: PortfolioAnalysis;
  risk: RiskReport | null;
  discipline: DisciplineReport;
  btSummaries: BacktestSummary[];
  primaryStrategy: Strategy | null;
  thresholds?: ThresholdSettings;
  /** 判定重み（任意・未指定時はユーザー設定を参照）。 */
  weights?: AdvisorWeights;
  /** 銘柄コード → Adaptive Score（任意）。 */
  adaptiveByCode?: Record<string, number>;
  /** 将来接続口：銘柄別バックテスト指標（v1.2 は未使用・v1.3 で活用予定）。 */
  perStock?: PerStockBacktestMap;
}

function emptyByCategory(): Record<AdvisorCategory, AdvisorItem[]> {
  const rec = {} as Record<AdvisorCategory, AdvisorItem[]>;
  for (const c of CATEGORY_ORDER) rec[c] = [];
  return rec;
}

function positionOf(stock: Stock, holdings: Holding[]) {
  const hs = holdings.filter((h) => h.stock_id === stock.id);
  if (hs.length === 0) return null;
  const shares = hs.reduce((a, x) => a + x.shares, 0);
  const cost = hs.reduce((a, x) => a + x.buy_price * x.shares, 0);
  const avg = shares > 0 ? cost / shares : 0;
  const value = stock.current_price != null ? stock.current_price * shares : cost;
  const pnlRatePct = avg > 0 && stock.current_price != null ? ((stock.current_price - avg) / avg) * 100 : null;
  const hasStopLoss = hs.some((x) => x.stop_loss != null) || stock.stop_loss != null;
  return { shares, avg, value, pnlRatePct, hasStopLoss };
}

export function buildAdvisorReport(input: AdvisorInput): AdvisorReport {
  const weights = input.weights ?? getAdvisorWeights();
  const t0 = input.thresholds ?? getThresholds();
  const t: Thresholds = {
    relativeVolumeWarning: t0.relativeVolumeWarning,
    relativeVolumeDanger: t0.relativeVolumeDanger,
    rsiOverheat: t0.rsiOverheat,
    oneStockWeightWarning: t0.oneStockWeightWarning,
  };

  if (input.stocks.length === 0) {
    return {
      hasData: false,
      items: [],
      byCategory: emptyByCategory(),
      counts: zeroCounts(),
      comments: ["銘柄データが不足しています。銘柄・価格・保有株を登録後に再解析します、ボス。"],
      disclaimer: DISCLAIMER,
    };
  }

  const totalValue = input.portfolio.totalValue > 0 ? input.portfolio.totalValue : 0;
  const cagrs = input.btSummaries.map((s) => s.cagr).filter((n) => Number.isFinite(n));
  const dds = input.btSummaries.map((s) => s.maxDrawdownPct).filter((n) => Number.isFinite(n));
  const g: GlobalSignals = {
    riskGrade: input.risk?.riskGrade ?? "B",
    disciplineDanger: input.discipline.dangerCount,
    btAvgCagr: cagrs.length ? cagrs.reduce((a, b) => a + b, 0) / cagrs.length : null,
    btAvgMaxDD: dds.length ? dds.reduce((a, b) => a + b, 0) / dds.length : null,
    ruinProbability: input.risk?.ruinProbability ?? 0,
  };

  const items: AdvisorItem[] = input.stocks.map((stock) => {
    const score = scoreStock(stock);
    const alerts = stockAlerts(stock);
    const pos = positionOf(stock, input.holdings);
    const held = pos !== null;
    const kinds = new Set(alerts.map((a) => a.kind));
    const positionRatioPct = held && totalValue > 0 && pos ? (pos.value / totalValue) * 100 : held ? 0 : null;
    const strategyFit = input.primaryStrategy
      ? matchStrategy(input.primaryStrategy, stock, score, { positionRatio: positionRatioPct != null ? positionRatioPct / 100 : null, hasStopLoss: pos?.hasStopLoss ?? false }).violations.length === 0
      : null;

    const signals: StockSignals = {
      code: stock.code,
      name: stock.name,
      baseGrade: score.grade,
      score: score.score,
      adaptiveScore: input.adaptiveByCode?.[stock.code] ?? null,
      rsi: stock.rsi ?? null,
      per: stock.per ?? null,
      roe: stock.roe ?? null,
      relativeVolume: stock.relativeVolume ?? null,
      volumeTrend: stock.volumeTrend ?? "unknown",
      held,
      positionRatioPct,
      pnlRatePct: pos?.pnlRatePct ?? null,
      stopHit: kinds.has("STOP_HIT"),
      stopNear: kinds.has("STOP_NEAR"),
      rsiHot: kinds.has("RSI_HOT"),
      takeProfitFlag: kinds.has("TAKE_PROFIT"),
      lossDanger: kinds.has("LOSS_DANGER"),
      strategyFit,
      stockBt: input.perStock?.[stock.code]
        ? {
            pf: input.perStock[stock.code].pf,
            maxDD: input.perStock[stock.code].maxDD,
            winRate: input.perStock[stock.code].winRate,
            cagr: input.perStock[stock.code].cagr,
            ruinProbability: input.perStock[stock.code].ruinProbability,
            expectedValue: input.perStock[stock.code].expectedValue,
          }
        : null,
    };

    const d = decide(signals, g, t, weights);
    const ps = input.perStock?.[stock.code];
    return {
      code: stock.code,
      name: stock.name,
      category: d.category,
      grade: d.grade,
      composite: Math.round(d.composite),
      score: score.score,
      held,
      reasons: d.reasons,
      action: d.action,
      btGrade: d.btGrade,
      btScore: d.btScore != null ? Math.round(d.btScore) : null,
      bt: ps
        ? { pf: ps.pf, maxDD: ps.maxDD, winRate: ps.winRate, cagr: ps.cagr, ruin: ps.ruinProbability, expectedValue: ps.expectedValue, tradeCount: ps.tradeCount, savedAt: ps.savedAt }
        : null,
    };
  });

  // カテゴリ別（買い寄りは composite 降順、リスク寄りは composite 昇順で危険度を上に）
  const byCategory = emptyByCategory();
  for (const it of items) byCategory[it.category].push(it);
  for (const c of CATEGORY_ORDER) {
    const dangerSide = c === "sellCandidate" || c === "danger" || c === "reduce";
    byCategory[c].sort((a, b) => (dangerSide ? a.composite - b.composite : b.composite - a.composite));
  }

  const counts: AdvisorCounts = {
    strongBuy: byCategory.strongBuy.length,
    buy: byCategory.buy.length,
    watch: byCategory.watch.length,
    hold: byCategory.hold.length,
    partialTP: byCategory.partialTP.length,
    reduce: byCategory.reduce.length,
    sellCandidate: byCategory.sellCandidate.length,
    danger: byCategory.danger.length,
    avoid: byCategory.avoid.length,
  };

  const comments: string[] = [];
  if (counts.strongBuy + counts.buy > 0) comments.push("優位性はあります。確実性はありません。");
  if (counts.watch > 0) comments.push("観測対象は増加しています。");
  if (counts.hold > 0) comments.push("保有は才能ではなく規律です。");
  if (counts.partialTP > 0 || counts.reduce > 0) comments.push("利益は市場が与えます。規律は我々が守ります。");
  if (counts.sellCandidate > 0 || counts.danger > 0) comments.push("感情ではなく規律です。");
  // v1.4: 個別銘柄BTに基づく所見
  const btItems = items.filter((i) => i.btScore != null);
  if (btItems.length > 0) {
    const strong = btItems.filter((i) => (i.btScore ?? 0) >= 80).length;
    if (strong > 0) comments.push("この銘柄は過去検証で優位性があります。期待値はプラスです。");
    comments.push("利益は保証できません。過去の優位性は未来を保証しません。規律を優先してください。");
  }
  if (comments.length === 0) comments.push("際立った売買候補はありません。静観が妥当です、ボス。");
  comments.push("推奨は判断補助です。");

  return { hasData: true, items, byCategory, counts, comments, disclaimer: DISCLAIMER };
}

function zeroCounts(): AdvisorCounts {
  return { strongBuy: 0, buy: 0, watch: 0, hold: 0, partialTP: 0, reduce: 0, sellCandidate: 0, danger: 0, avoid: 0 };
}
