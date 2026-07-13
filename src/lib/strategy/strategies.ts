/**
 * 3 戦略候補の純関数実装（Phase 1 / Task 1）。
 *
 * すべて副作用なし。同一インターフェース TradingStrategy に統一し、バックテスト（Task 3）で
 * 同条件比較できるようにする。数値パラメータはファクトリ引数で上書き可能（設定画面で変更する前提）。
 *
 * A トレンドフォロー: エントリー=ゴールデンクロス かつ 終値が直近60日高値更新。
 *                    イグジット=25日線を終値が下回る、または損切り -8%。
 * B 押し目逆張り    : エントリー=終値>200日線（長期上昇）かつ RSI(14)≤30。
 *                    イグジット=RSI≥55 で利確、損切り -6%、最大保有15営業日。
 * C 相対力モメンタム: エントリー=終値>75日線 かつ 相対力（騰落率）が閾値以上。
 *                    イグジット=75日線割れ、損切り -8%、最大保有60営業日。
 *
 * ※ C の「技術スコア上位」は銘柄選定（スクリーナー上位＝候補ユニバース）側で担保する前提。
 *    本ルールは 1 銘柄系列で評価できる代理として「終値>75日線 ＋ 騰落率(相対力)」を用いる。
 * ※ すべての初期数値は比較検証用であり推奨値ではない（PARAM_DISCLAIMER を UI に明記）。
 */
import {
  type StrategyBar,
  type StrategyPosition,
  type Signal,
  type TradingStrategy,
  PARAM_DISCLAIMER,
  toCloses,
  lastClose,
  sma,
  priorHigh,
  momentumPct,
  currentGainPct,
  isGoldenCross,
  rsiLast,
  holdSignal,
} from "./signalStrategy";

// ---- A: トレンドフォロー ----

export interface TrendFollowParams {
  /** 高値更新の参照期間（営業日）。 */
  highLookbackDays: number;
  /** イグジット判定に使う移動平均期間（営業日）。 */
  exitMaPeriod: number;
  /** 損切り幅（%・正の値）。 */
  stopLossPct: number;
}

export const DEFAULT_TREND_FOLLOW: Readonly<TrendFollowParams> = {
  highLookbackDays: 60,
  exitMaPeriod: 25,
  stopLossPct: 8,
};

export function createTrendFollow(overrides: Partial<TrendFollowParams> = {}): TradingStrategy {
  const p: TrendFollowParams = { ...DEFAULT_TREND_FOLLOW, ...overrides };
  return {
    id: "trend-follow",
    name: "A トレンドフォロー",
    description: `ゴールデンクロス かつ 終値が直近${p.highLookbackDays}日高値を更新で建て、${p.exitMaPeriod}日線割れ または 損切り -${p.stopLossPct}% で手仕舞い。`,
    disclaimer: PARAM_DISCLAIMER,
    params: { ...p },
    entryRule(series: StrategyBar[]): Signal {
      const closes = toCloses(series);
      const cur = lastClose(series);
      const hi = priorHigh(closes, p.highLookbackDays);
      if (cur == null || hi == null) return holdSignal();
      if (isGoldenCross(closes) && cur > hi) {
        return { action: "enter", reason: `ゴールデンクロス＋${p.highLookbackDays}日終値高値更新` };
      }
      return holdSignal();
    },
    exitRule(position: StrategyPosition, series: StrategyBar[]): Signal {
      const closes = toCloses(series);
      const cur = lastClose(series);
      const gain = currentGainPct(position.entryPrice, series);
      // 損切り優先（リスク先取り）。
      if (gain != null && gain <= -p.stopLossPct) {
        return { action: "exit", reason: `損切り -${p.stopLossPct}%` };
      }
      const ma = sma(closes, p.exitMaPeriod);
      if (cur != null && ma != null && cur < ma) {
        return { action: "exit", reason: `${p.exitMaPeriod}日移動平均を終値が下回り` };
      }
      return holdSignal();
    },
  };
}

// ---- B: 押し目逆張り ----

export interface PullbackParams {
  /** 長期上昇の判定に使う移動平均期間（営業日）。 */
  longMaPeriod: number;
  /** RSI 期間。 */
  rsiPeriod: number;
  /** エントリーする RSI 上限（この値以下で建てる）。 */
  rsiEntryMax: number;
  /** 利確する RSI 下限（この値以上で手仕舞い）。 */
  rsiExit: number;
  /** 損切り幅（%・正の値）。 */
  stopLossPct: number;
  /** 最大保有期間（営業日）。 */
  maxHoldBars: number;
}

export const DEFAULT_PULLBACK: Readonly<PullbackParams> = {
  longMaPeriod: 200,
  rsiPeriod: 14,
  rsiEntryMax: 30,
  rsiExit: 55,
  stopLossPct: 6,
  maxHoldBars: 15,
};

export function createPullback(overrides: Partial<PullbackParams> = {}): TradingStrategy {
  const p: PullbackParams = { ...DEFAULT_PULLBACK, ...overrides };
  return {
    id: "pullback",
    name: "B 押し目逆張り",
    description: `終値>${p.longMaPeriod}日線 かつ RSI(${p.rsiPeriod})≤${p.rsiEntryMax} で建て、RSI≥${p.rsiExit} 利確・損切り -${p.stopLossPct}%・最大${p.maxHoldBars}営業日で手仕舞い。`,
    disclaimer: PARAM_DISCLAIMER,
    params: { ...p },
    entryRule(series: StrategyBar[]): Signal {
      const closes = toCloses(series);
      const cur = lastClose(series);
      const ma = sma(closes, p.longMaPeriod);
      const rsi = rsiLast(closes, p.rsiPeriod);
      if (cur == null || ma == null || rsi == null) return holdSignal();
      if (cur > ma && rsi <= p.rsiEntryMax) {
        return { action: "enter", reason: `長期上昇（終値>${p.longMaPeriod}日線）＋RSI(${p.rsiPeriod})=${rsi}≤${p.rsiEntryMax}` };
      }
      return holdSignal();
    },
    exitRule(position: StrategyPosition, series: StrategyBar[]): Signal {
      const closes = toCloses(series);
      const gain = currentGainPct(position.entryPrice, series);
      // 損切り優先。
      if (gain != null && gain <= -p.stopLossPct) {
        return { action: "exit", reason: `損切り -${p.stopLossPct}%` };
      }
      const rsi = rsiLast(closes, p.rsiPeriod);
      if (rsi != null && rsi >= p.rsiExit) {
        return { action: "exit", reason: `RSI(${p.rsiPeriod})=${rsi}≥${p.rsiExit} で利確` };
      }
      if (position.barsHeld >= p.maxHoldBars) {
        return { action: "exit", reason: `最大保有${p.maxHoldBars}営業日に到達` };
      }
      return holdSignal();
    },
  };
}

// ---- C: 相対力モメンタム ----

export interface RelativeMomentumParams {
  /** トレンド判定に使う移動平均期間（営業日）。 */
  maPeriod: number;
  /** 相対力（騰落率）の参照期間（営業日）。 */
  momentumLookback: number;
  /** エントリーに要する最小騰落率（%）。相対力の代理指標。 */
  minMomentumPct: number;
  /** 損切り幅（%・正の値）。 */
  stopLossPct: number;
  /** 最大保有期間（営業日）。 */
  maxHoldBars: number;
}

export const DEFAULT_RELATIVE_MOMENTUM: Readonly<RelativeMomentumParams> = {
  maPeriod: 75,
  momentumLookback: 75,
  minMomentumPct: 0,
  stopLossPct: 8,
  maxHoldBars: 60,
};

export function createRelativeMomentum(overrides: Partial<RelativeMomentumParams> = {}): TradingStrategy {
  const p: RelativeMomentumParams = { ...DEFAULT_RELATIVE_MOMENTUM, ...overrides };
  return {
    id: "relative-momentum",
    name: "C 相対力モメンタム",
    description: `終値>${p.maPeriod}日線 かつ ${p.momentumLookback}日騰落率≥${p.minMomentumPct}% で建て、${p.maPeriod}日線割れ・損切り -${p.stopLossPct}%・最大${p.maxHoldBars}営業日で手仕舞い。技術スコア上位は候補選定側で担保。`,
    disclaimer: PARAM_DISCLAIMER,
    params: { ...p },
    entryRule(series: StrategyBar[]): Signal {
      const closes = toCloses(series);
      const cur = lastClose(series);
      const ma = sma(closes, p.maPeriod);
      const mom = momentumPct(closes, p.momentumLookback);
      if (cur == null || ma == null || mom == null) return holdSignal();
      if (cur > ma && mom >= p.minMomentumPct) {
        return { action: "enter", reason: `終値>${p.maPeriod}日線＋${p.momentumLookback}日騰落率${mom.toFixed(1)}%≥${p.minMomentumPct}%` };
      }
      return holdSignal();
    },
    exitRule(position: StrategyPosition, series: StrategyBar[]): Signal {
      const closes = toCloses(series);
      const cur = lastClose(series);
      const gain = currentGainPct(position.entryPrice, series);
      // 損切り優先。
      if (gain != null && gain <= -p.stopLossPct) {
        return { action: "exit", reason: `損切り -${p.stopLossPct}%` };
      }
      const ma = sma(closes, p.maPeriod);
      if (cur != null && ma != null && cur < ma) {
        return { action: "exit", reason: `${p.maPeriod}日移動平均を終値が下回り` };
      }
      if (position.barsHeld >= p.maxHoldBars) {
        return { action: "exit", reason: `最大保有${p.maxHoldBars}営業日に到達` };
      }
      return holdSignal();
    },
  };
}

/** 3 戦略の既定インスタンス（比較検証・シグナル生成の一覧）。 */
export const STRATEGIES: readonly TradingStrategy[] = Object.freeze([
  createTrendFollow(),
  createPullback(),
  createRelativeMomentum(),
]);

/** id から戦略を引く（未知は undefined）。 */
export function getStrategyById(id: string): TradingStrategy | undefined {
  return STRATEGIES.find((s) => s.id === id);
}
