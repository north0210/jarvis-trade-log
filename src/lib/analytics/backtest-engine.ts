/**
 * 価格系列バックテストエンジン（Phase 25）。
 *
 * 戦略のファンダ条件で銘柄ユニバースを選定（現在値）し、
 * 日足系列上で RSI ベースのエントリ＋利確/損切りイグジットの仮想売買を実行、
 * 損益系列と各種指標（CAGR/Sharpe/Sortino/DD/PF 等）を算出する。
 * MonteCarlo の母集団（trade returns）も生成する。
 *
 * ※ 過去のファンダ指標は取得できないため、ファンダ条件は現在値で銘柄を選別する近似。
 *    時系列で変動する条件は RSI（日足から算出）のみを動的評価する。
 */
import type { Stock, Strategy } from "@/lib/types";
import { scoreStock } from "@/lib/score";
import { calculateRSI } from "@/lib/indicators/rsi";
import { computeVolumeMetrics } from "@/lib/indicators/volume";
import { daysBetween } from "@/lib/analysis/trades";
import type { SeriesPoint } from "./priceCache";
import { K } from "@/lib/storage/keys";

export interface EngineTrade {
  code: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  holdingDays: number | null;
  outcome: "win" | "loss";
}

export interface EngineResult {
  strategyId: string;
  strategyName: string;
  universe: number;
  from: string;
  to: string;
  years: number;
  trades: EngineTrade[];
  tradeCount: number;
  winRate: number;
  profitFactor: number | null;
  totalReturnPct: number;
  cagr: number;
  annualReturnPct: number;
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number;
  recoveryFactor: number | null;
  benchmarkCagr: number;
  alphaPct: number;
  equity: { date: string; equity: number }[];
  yearly: { year: string; returnPct: number }[];
  bestYear: { year: string; returnPct: number } | null;
  worstYear: { year: string; returnPct: number } | null;
  tradeReturns: number[]; // MonteCarlo 母集団（%）
  comments: string[];
}

/** 時間変動しないファンダ条件で銘柄を選別（現在値・近似）。 */
export function passesFundamentals(strategy: Strategy, stock: Stock): boolean {
  const sc = scoreStock(stock).score;
  const g = scoreStock(stock).grade;
  if (strategy.minScore != null && sc < strategy.minScore) return false;
  if (strategy.allowedGrades.length > 0 && !strategy.allowedGrades.includes(g)) return false;
  if (strategy.minRoe != null && stock.roe != null && stock.roe < strategy.minRoe) return false;
  if (strategy.minOperatingMargin != null && stock.operating_margin != null && stock.operating_margin < strategy.minOperatingMargin) return false;
  if (strategy.minSalesGrowth != null && stock.sales_growth != null && stock.sales_growth < strategy.minSalesGrowth) return false;
  if (strategy.maxPer != null && stock.per != null && stock.per > strategy.maxPer) return false;
  if (strategy.maxPbr != null && stock.pbr != null && stock.pbr > strategy.maxPbr) return false;
  return true;
}

export function selectUniverse(stocks: Stock[], strategy: Strategy): Stock[] {
  return stocks.filter((s) => passesFundamentals(strategy, s));
}

/** 単一銘柄の日足系列に戦略を適用して仮想売買を行う。 */
export function simulateStrategy(series: SeriesPoint[], strategy: Strategy, code: string): EngineTrade[] {
  const pts = series.filter((p) => p.close != null);
  const closes = pts.map((p) => p.close as number);
  const volSeries = pts.map((p) => (typeof p.volume === "number" ? p.volume : 0));
  const hasVolCond =
    strategy.minRelativeVolume != null || strategy.requiredVolumeTrend != null || strategy.avoidVolumeSpikeWithHighRsi === true;
  const out: EngineTrade[] = [];
  const period = 14;
  let inPos = false;
  let entryPrice = 0;
  let entryIdx = 0;

  const pushTrade = (i: number, exitPrice: number) => {
    const gain = ((exitPrice - entryPrice) / entryPrice) * 100;
    out.push({
      code,
      entryDate: pts[entryIdx].date,
      exitDate: pts[i].date,
      entryPrice,
      exitPrice,
      returnPct: gain,
      holdingDays: daysBetween(pts[entryIdx].date, pts[i].date),
      outcome: gain >= 0 ? "win" : "loss",
    });
  };

  for (let i = period; i < pts.length; i++) {
    const price = closes[i];
    if (!inPos) {
      const rsi = calculateRSI(closes.slice(0, i + 1), period);
      const rsiOk = strategy.maxRsi == null || (rsi != null && rsi <= strategy.maxRsi);
      // 出来高エントリー条件（設定時のみ）
      let volOk = true;
      if (hasVolCond) {
        const vm = computeVolumeMetrics(volSeries.slice(0, i + 1));
        if (strategy.minRelativeVolume != null && (vm.relativeVolume == null || vm.relativeVolume < strategy.minRelativeVolume)) volOk = false;
        if (strategy.requiredVolumeTrend != null && vm.volumeTrend !== strategy.requiredVolumeTrend) volOk = false;
        if (strategy.avoidVolumeSpikeWithHighRsi && rsi != null && rsi >= 80 && vm.relativeVolume != null && vm.relativeVolume >= 1.5) volOk = false;
      }
      if (rsiOk && volOk) {
        inPos = true;
        entryPrice = price;
        entryIdx = i;
      }
    } else {
      const gain = ((price - entryPrice) / entryPrice) * 100;
      if (strategy.targetProfitRate != null && gain >= strategy.targetProfitRate) {
        pushTrade(i, price);
        inPos = false;
      } else if (strategy.maxLossRate != null && gain <= -strategy.maxLossRate) {
        pushTrade(i, price);
        inPos = false;
      }
    }
  }
  if (inPos && pts.length > 0) pushTrade(pts.length - 1, closes[closes.length - 1]);
  return out;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

/** ユニバース全体の系列からバックテスト結果を算出する。 */
export function runEngineBacktest(
  perCode: { code: string; series: SeriesPoint[] }[],
  strategy: Strategy,
  from: string,
  to: string
): EngineResult {
  const trades = perCode.flatMap((c) => simulateStrategy(c.series, strategy, c.code));
  trades.sort((a, b) => a.exitDate.localeCompare(b.exitDate));

  const returns = trades.map((t) => t.returnPct / 100);
  const wins = trades.filter((t) => t.returnPct > 0);
  const losses = trades.filter((t) => t.returnPct < 0);
  const grossProfit = wins.reduce((a, t) => a + t.returnPct, 0);
  const grossLoss = losses.reduce((a, t) => a + t.returnPct, 0);
  const profitFactor = grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : null;

  // エクイティ（1口を逐次複利）
  const equity: { date: string; equity: number }[] = [];
  let eq = 1;
  let peak = 1;
  let maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.returnPct / 100;
    if (eq > peak) peak = eq;
    const dd = ((peak - eq) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
    equity.push({ date: t.exitDate, equity: eq });
  }
  const totalReturnPct = (eq - 1) * 100;

  // 期間（年）
  const dates = trades.length ? [trades[0].entryDate, trades[trades.length - 1].exitDate] : [from, to];
  const spanMs = new Date(dates[1]).getTime() - new Date(dates[0]).getTime();
  const years = Math.max(spanMs / (365.25 * 24 * 60 * 60 * 1000), 0.1);
  const cagr = eq > 0 ? (Math.pow(eq, 1 / years) - 1) * 100 : -100;
  const annualReturnPct = totalReturnPct / years;

  const tradesPerYear = trades.length / years;
  const rMean = mean(returns);
  const rStd = std(returns);
  const downside = Math.sqrt(mean(returns.map((r) => (r < 0 ? r * r : 0))));
  const ann = Math.sqrt(Math.max(tradesPerYear, 1));
  const sharpe = rStd > 0 ? (rMean / rStd) * ann : 0;
  const sortino = downside > 0 ? (rMean / downside) * ann : 0;
  const recoveryFactor = maxDD > 0 ? totalReturnPct / maxDD : null;

  // ベンチマーク（ユニバース買い持ち平均）
  const bhReturns = perCode
    .map((c) => {
      const pts = c.series.filter((p) => p.close != null);
      if (pts.length < 2) return null;
      const first = pts[0].close as number;
      const last = pts[pts.length - 1].close as number;
      return (last - first) / first;
    })
    .filter((v): v is number => v != null);
  const bhTotal = mean(bhReturns);
  const benchmarkCagr = (Math.pow(1 + bhTotal, 1 / years) - 1) * 100;
  const alphaPct = cagr - benchmarkCagr;

  // 年別
  const byYear = new Map<string, number>();
  for (const t of trades) {
    const y = t.exitDate.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 1) * (1 + t.returnPct / 100));
  }
  const yearly = Array.from(byYear.entries())
    .map(([year, factor]) => ({ year, returnPct: (factor - 1) * 100 }))
    .sort((a, b) => a.year.localeCompare(b.year));
  const bestYear = yearly.length ? yearly.slice().sort((a, b) => b.returnPct - a.returnPct)[0] : null;
  const worstYear = yearly.length ? yearly.slice().sort((a, b) => a.returnPct - b.returnPct)[0] : null;

  // JARVIS 所見
  const comments: string[] = [];
  if (trades.length === 0) {
    comments.push("この戦略・期間ではエントリ条件を満たす場面がありませんでした。条件を緩めるか期間を広げてください、ボス。");
  } else {
    comments.push(`この戦略は ${dates[0].slice(0, 4)}〜${dates[1].slice(0, 4)} で CAGR ${cagr.toFixed(1)}% でした。`);
    comments.push(`最大DDは ${maxDD.toFixed(1)}%、勝率 ${((wins.length / trades.length) * 100).toFixed(0)}%、PF ${profitFactor != null ? profitFactor.toFixed(2) : "—"} です。`);
    comments.push(`市場平均（買い持ち）を ${alphaPct >= 0 ? "+" : ""}${alphaPct.toFixed(1)}% ${alphaPct >= 0 ? "上回りました" : "下回りました"}。`);
    if (rStd < 0.05 && trades.length >= 5) comments.push("低ボラティリティで安定しています。");
    if (trades.length < 10) comments.push("取引数が少なく、結果は参考程度に留めてください。");
  }

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    universe: perCode.length,
    from,
    to,
    years,
    trades,
    tradeCount: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor,
    totalReturnPct,
    cagr,
    annualReturnPct,
    sharpe,
    sortino,
    maxDrawdownPct: maxDD,
    recoveryFactor,
    benchmarkCagr,
    alphaPct,
    equity,
    yearly,
    bestYear,
    worstYear,
    tradeReturns: trades.map((t) => t.returnPct),
    comments,
  };
}

// ---- Dashboard 用 結果サマリー永続化 ----
const RESULT_KEY = K.backtestV2;

export interface BacktestSummary {
  strategyId: string;
  strategyName: string;
  cagr: number;
  maxDrawdownPct: number;
  alphaPct: number;
  bestYear: { year: string; returnPct: number } | null;
  worstYear: { year: string; returnPct: number } | null;
  savedAt: string;
}

export function getBacktestSummaries(): BacktestSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RESULT_KEY);
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? (p as BacktestSummary[]) : [];
  } catch {
    return [];
  }
}

export function saveBacktestSummary(r: EngineResult): void {
  if (typeof window === "undefined") return;
  const list = getBacktestSummaries().filter((x) => x.strategyId !== r.strategyId);
  list.push({
    strategyId: r.strategyId,
    strategyName: r.strategyName,
    cagr: r.cagr,
    maxDrawdownPct: r.maxDrawdownPct,
    alphaPct: r.alphaPct,
    bestYear: r.bestYear,
    worstYear: r.worstYear,
    savedAt: new Date().toISOString(),
  });
  window.localStorage.setItem(RESULT_KEY, JSON.stringify(list));
}
