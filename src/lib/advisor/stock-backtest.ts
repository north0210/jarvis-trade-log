/**
 * Phase 55 (v1.3): 銘柄別バックテスト（軽量版・完全ローカル）。
 * 既存の価格系列BTエンジン（backtest-engine）を単一銘柄で再利用する薄いラッパー。
 * 価格系列は J-Quants（既存クライアント・キャッシュ優先）を再利用。データ不足時は安全に fallback。
 * 大量一括BTは対象外。結果は Advisor 反映準備として保存する。
 */
import type { SeriesPoint } from "@/lib/analytics/priceCache";
import type { Strategy } from "@/lib/types";
import { runEngineBacktest } from "@/lib/analytics/backtest-engine";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { getDashboardRuns } from "@/lib/settings/performance";

const KEY = "jarvis-trade-log:stock-bt-results";

export interface StockBtResult {
  code: string;
  name: string;
  strategyId: string;
  strategyName: string;
  from: string;
  to: string;
  tradeCount: number;
  winRate: number; // 0-1
  profitFactor: number | null;
  maxDrawdownPct: number;
  cagr: number;
  avgHoldingDays: number | null;
  // v1.4: Advisor 本接続用
  avgWinPct: number | null;
  avgLossPct: number | null;
  expectedValuePct: number | null; // 1取引あたり期待リターン(%)
  mcRuin: number | null; // 簡易MC破産確率(0-1)
  savedAt: string;
}

/** 単一銘柄・単一戦略の簡易バックテスト。series が空なら null（データ不足）。 */
export function runStockBacktest(
  code: string,
  name: string,
  strategy: Strategy,
  series: SeriesPoint[],
  from: string,
  to: string,
  at: string
): StockBtResult | null {
  if (!series || series.length < 20) return null; // データ不足の安全fallback
  const r = runEngineBacktest([{ code, series }], strategy, from, to);
  const days = r.trades.map((t) => t.holdingDays).filter((d): d is number => d != null);
  const avgHoldingDays = days.length ? days.reduce((a, d) => a + d, 0) / days.length : null;
  const rets = r.trades.map((t) => t.returnPct);
  const wins = rets.filter((x) => x > 0);
  const losses = rets.filter((x) => x < 0);
  const avgWinPct = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null;
  const avgLossPct = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null;
  const expectedValuePct = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
  // 簡易MC：1取引損益(%)を資本100に対する変化として破産確率を推定
  const mc = rets.length ? runMonteCarlo({ pnls: rets, capital: 100, runs: getDashboardRuns() }) : null;
  return {
    code,
    name,
    strategyId: strategy.id,
    strategyName: strategy.name,
    from,
    to,
    tradeCount: r.tradeCount,
    winRate: r.winRate,
    profitFactor: r.profitFactor,
    maxDrawdownPct: r.maxDrawdownPct,
    cagr: r.cagr,
    avgHoldingDays,
    avgWinPct,
    avgLossPct,
    expectedValuePct,
    mcRuin: mc ? mc.ruinProb : null,
    savedAt: at,
  };
}

// ---- 結果保存（Advisor/Dashboard/Report 反映準備） ----
function read(): StockBtResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? (p as StockBtResult[]) : [];
  } catch {
    return [];
  }
}
function write(list: StockBtResult[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
}

export function listStockBtResults(): StockBtResult[] {
  return read().slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
/** 同一銘柄×戦略は最新で置換して保存。 */
export function saveStockBtResult(r: StockBtResult): void {
  const rest = read().filter((x) => !(x.code === r.code && x.strategyId === r.strategyId));
  write([r, ...rest]);
}
export function removeStockBtResult(code: string, strategyId: string): void {
  write(read().filter((x) => !(x.code === code && x.strategyId === strategyId)));
}
export function latestStockBtResult(): StockBtResult | null {
  return listStockBtResults()[0] ?? null;
}
