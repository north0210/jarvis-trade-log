/**
 * シグナル戦略バックテスト・シミュレータ（Phase 1 / Task 3・Stage B）。
 *
 * 既存 backtest-engine.ts（しきい値 Strategy・RSI固定ロジック）は迂回も改造もしない。
 * 本モジュールは TradingStrategy（entryRule/exitRule）を SeriesPoint 系列で駆動する
 * **非破壊の新シミュレータ**。純関数（副作用なし・時刻は注入）。
 *
 * 執行モデル（ペーパーブローカーと同一）:
 * - シグナルは当日終値（**調整後終値 adjClose**）で判定 → 約定は翌営業日（翌データバー）。
 * - 約定価格の優先順位: 翌バーの調整後始値(adjOpen) → 無ければ翌バーの adjClose（**代用約定**・フラグ記録）
 *   → それも無ければ失効（lapse・スキップ）。手数料 0・端数の概念は返り値（%指標）に影響しない。
 * - 系列末尾で建玉が残れば最終バーで強制手仕舞い（指標完結のため）。
 *
 * 指標は既存エンジンと同一定義（等ウェイトのトレード%系列）で算出し比較可能性を担保する。
 * ポジションサイズ・円建て損益はペーパーブローカー（Task 2/4 のライブ）の責務であり本比較では扱わない。
 */
import { daysBetween } from "@/lib/analysis/trades";
import type { SeriesPoint } from "@/lib/analytics/priceCache";
import type { StrategyBar, StrategyPosition, TradingStrategy } from "@/lib/strategy/signalStrategy";

/** 約定に使う内部バー（adjClose=シグナル基準 / fill=約定価格 / substitute=始値欠落で終値代用）。 */
interface SimBar {
  date: string;
  close: number; // adjClose（シグナル基準）
  fill: number | null; // adjOpen ?? adjClose
  substitute: boolean; // adjOpen 欠落で adjClose を代用した
}

export interface SimTrade {
  code: string;
  strategyId: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  returnPct: number;
  holdingDays: number | null;
  outcome: "win" | "loss";
  entrySubstitute: boolean;
  exitSubstitute: boolean;
  entryReason: string;
  exitReason: string;
}

export interface SimRun {
  trades: SimTrade[];
  substituteFills: number; // 代用約定（始値欠落→終値約定）件数
  lapses: number; // 失効（約定価格取得不可）件数
}

/** SeriesPoint → 内部バー（adjClose 必須・adjOpen 欠落は終値代用・昇順）。 */
function toSimBars(series: SeriesPoint[]): SimBar[] {
  const out: SimBar[] = [];
  for (const p of series) {
    if (p.adjClose == null || !Number.isFinite(p.adjClose)) continue;
    const hasOpen = typeof p.adjOpen === "number" && Number.isFinite(p.adjOpen);
    out.push({
      date: p.date,
      close: p.adjClose,
      fill: hasOpen ? (p.adjOpen as number) : p.adjClose,
      substitute: !hasOpen,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function makeTrade(
  code: string,
  strategyId: string,
  entry: { date: string; price: number; substitute: boolean },
  exitBar: SimBar,
  exitReason: string,
  entryReason: string
): SimTrade {
  const exitPrice = exitBar.fill as number;
  const returnPct = ((exitPrice - entry.price) / entry.price) * 100;
  return {
    code,
    strategyId,
    entryDate: entry.date,
    entryPrice: entry.price,
    exitDate: exitBar.date,
    exitPrice,
    returnPct,
    holdingDays: daysBetween(entry.date, exitBar.date),
    outcome: returnPct >= 0 ? "win" : "loss",
    entrySubstitute: entry.substitute,
    exitSubstitute: exitBar.substitute,
    entryReason,
    exitReason,
  };
}

/**
 * 単一銘柄の系列に戦略を適用して仮想売買する。
 * シグナルはバー i の adjClose で判定し、約定はバー i+1 の fill 価格。
 */
export function simulateSignalStrategy(strategy: TradingStrategy, series: SeriesPoint[], code: string): SimRun {
  const bars = toSimBars(series);
  const stratBars: StrategyBar[] = bars.map((b) => ({ date: b.date, close: b.close }));
  const trades: SimTrade[] = [];
  let substituteFills = 0;
  let lapses = 0;

  let inPos = false;
  let entryIdx = -1;
  let entry = { date: "", price: 0, substitute: false, reason: "" };

  for (let i = 0; i < bars.length - 1; i++) {
    if (!inPos) {
      const sig = strategy.entryRule(stratBars.slice(0, i + 1));
      if (sig.action !== "enter") continue;
      const fb = bars[i + 1];
      if (fb.fill == null) {
        lapses++;
        continue;
      }
      inPos = true;
      entryIdx = i + 1;
      entry = { date: fb.date, price: fb.fill, substitute: fb.substitute, reason: sig.reason };
      if (fb.substitute) substituteFills++;
    } else {
      const pos: StrategyPosition = { entryDate: entry.date, entryPrice: entry.price, barsHeld: i - entryIdx };
      const sig = strategy.exitRule(pos, stratBars.slice(0, i + 1));
      if (sig.action !== "exit") continue;
      const fb = bars[i + 1];
      if (fb.fill == null) {
        lapses++;
        continue; // 失効 → 持ち越し（次バーで再判定）
      }
      trades.push(makeTrade(code, strategy.id, entry, fb, sig.reason, entry.reason));
      if (fb.substitute) substituteFills++;
      inPos = false;
    }
  }

  // 系列末尾で建玉が残れば最終バーで強制手仕舞い。
  if (inPos && bars.length > 0) {
    const last = bars[bars.length - 1];
    if (last.fill != null && last.date !== entry.date) {
      trades.push(makeTrade(code, strategy.id, entry, last, "系列末尾で強制手仕舞い", entry.reason));
      if (last.substitute) substituteFills++;
    }
  }

  return { trades, substituteFills, lapses };
}

// ---- 指標（既存エンジンと同一定義・等ウェイト %） ----

export interface SimMetrics {
  tradeCount: number;
  winRate: number; // 0〜1
  profitFactor: number | null; // 総利益% / |総損失%|
  maxDrawdownPct: number; // 複利エクイティのピークトラフ
  expectancyPct: number; // 期待値 = 1トレード平均リターン%
  avgHoldingDays: number | null; // 平均保有日数
}

export function computeSimMetrics(trades: SimTrade[]): SimMetrics {
  const n = trades.length;
  if (n === 0) {
    return { tradeCount: 0, winRate: 0, profitFactor: null, maxDrawdownPct: 0, expectancyPct: 0, avgHoldingDays: null };
  }
  const wins = trades.filter((t) => t.returnPct >= 0);
  const grossWin = wins.reduce((a, t) => a + t.returnPct, 0);
  const grossLoss = trades.filter((t) => t.returnPct < 0).reduce((a, t) => a + t.returnPct, 0);
  const profitFactor = grossLoss !== 0 ? grossWin / Math.abs(grossLoss) : null;

  // 最大DD: exitDate 昇順に複利したエクイティのピークトラフ。
  const sorted = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate));
  let eq = 1;
  let peak = 1;
  let maxDD = 0;
  for (const t of sorted) {
    eq *= 1 + t.returnPct / 100;
    if (eq > peak) peak = eq;
    const dd = ((peak - eq) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const expectancyPct = trades.reduce((a, t) => a + t.returnPct, 0) / n;
  const held = trades.map((t) => t.holdingDays).filter((d): d is number => d != null);
  const avgHoldingDays = held.length ? held.reduce((a, b) => a + b, 0) / held.length : null;

  return { tradeCount: n, winRate: wins.length / n, profitFactor, maxDrawdownPct: maxDD, expectancyPct, avgHoldingDays };
}

// ---- 一括比較（全期間＋前半/後半アウトオブサンプル） ----

export interface StrategyComparisonEntry {
  strategyId: string;
  strategyName: string;
  disclaimer: string;
  full: SimMetrics;
  firstHalf: SimMetrics;
  secondHalf: SimMetrics;
  substituteFills: number;
  lapses: number;
}

export interface StrategyComparisonResult {
  generatedAt: string; // ISO（注入）
  /** 実効比較期間（プラン取得可能範囲・実データに合わせてクランプ後）。 */
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  mid: string; // 前半/後半の分割日
  universeCount: number;
  entries: StrategyComparisonEntry[];
  /** ユーザーが要求した期間（クランプ発生の注記表示用・省略可）。 */
  requestedFrom?: string;
  requestedTo?: string;
}

/** 期間の中点日（アウトオブサンプル分割用）。 */
export function midpointDate(from: string, to: string): string {
  const mid = (Date.parse(from) + Date.parse(to)) / 2;
  return new Date(mid).toISOString().slice(0, 10);
}

/**
 * 3戦略 × ユニバースを一括比較する（純関数・時刻は注入）。
 * トレードは entryDate が [from,to] のものを集計し、mid で前半/後半に分割する。
 */
export function runStrategyComparison(
  strategies: readonly TradingStrategy[],
  perCode: { code: string; series: SeriesPoint[] }[],
  from: string,
  to: string,
  generatedAt: string
): StrategyComparisonResult {
  const mid = midpointDate(from, to);
  const entries = strategies.map((strat) => {
    const all: SimTrade[] = [];
    let substituteFills = 0;
    let lapses = 0;
    for (const { code, series } of perCode) {
      const run = simulateSignalStrategy(strat, series, code);
      for (const t of run.trades) {
        if (t.entryDate >= from && t.entryDate <= to) all.push(t);
      }
      substituteFills += run.substituteFills;
      lapses += run.lapses;
    }
    const first = all.filter((t) => t.entryDate < mid);
    const second = all.filter((t) => t.entryDate >= mid);
    return {
      strategyId: strat.id,
      strategyName: strat.name,
      disclaimer: strat.disclaimer,
      full: computeSimMetrics(all),
      firstHalf: computeSimMetrics(first),
      secondHalf: computeSimMetrics(second),
      substituteFills,
      lapses,
    };
  });
  return { generatedAt, from, to, mid, universeCount: perCode.length, entries };
}
