/**
 * シグナル戦略の共通インターフェースと純関数ヘルパー（Phase 1 / Task 1）。
 *
 * alerts.ts と同様の「副作用なし純関数」方針。日足終値系列（古い→新しい順）から
 * エントリー/イグジットの売買シグナルを算出する。実際の発注・約定・資金管理は行わない
 * （約定はペーパーブローカー=Task 2、期間比較はバックテスト=Task 3 が担う）。
 *
 * ※ 既存 types.ts の `Strategy`（しきい値フィルタ構造体）とは別物。こちらは
 *    entryRule/exitRule を持つ「振る舞い」インターフェース。名前衝突を避け TradingStrategy とする。
 */
import { calculateRSI } from "@/lib/indicators/rsi";
import { computeMacdState } from "@/lib/indicators/macd";

/** 戦略が参照する 1 日足（調整後終値・古い→新しい順で配列化）。 */
export interface StrategyBar {
  date: string; // YYYY-MM-DD
  close: number; // 調整後終値（有限値）
}

export type SignalAction = "enter" | "exit" | "hold";

/** ルール評価の結果。reason は UI/ログ向けの根拠（hold 時は空文字）。 */
export interface Signal {
  action: SignalAction;
  reason: string;
}

/** 保有中ポジション（イグジット判定に必要な最小情報）。 */
export interface StrategyPosition {
  entryDate: string; // YYYY-MM-DD
  entryPrice: number; // 建玉価格（実運用は翌営業日始値・検証は建玉時終値でも可）
  barsHeld: number; // 建玉からの経過営業日数（建玉当日=0）
}

/**
 * シグナル戦略インターフェース。
 * - entryRule: 与えられた系列の「最新バー」で新規建てすべきか（enter / hold）。
 * - exitRule : 保有中に「最新バー」で手仕舞いすべきか（exit / hold）。
 * - params   : 期間・しきい値などの調整可能な定数（設定画面で変更可能にする前提で数値のみ）。
 */
export interface TradingStrategy {
  id: string;
  name: string;
  description: string;
  /** UI 明記用: 初期パラメータは比較検証用であり推奨値ではない旨。 */
  disclaimer: string;
  /** 調整可能な数値パラメータ（設定 UI で列挙・変更するため数値のみに限定）。 */
  params: Readonly<Record<string, number>>;
  entryRule(series: StrategyBar[]): Signal;
  exitRule(position: StrategyPosition, series: StrategyBar[]): Signal;
}

/** A/B/C 共通の免責文言（推奨値ではない旨を UI に明記するため）。 */
export const PARAM_DISCLAIMER =
  "パラメータ初期値は戦略比較の検証用であり、推奨値ではありません。バックテストで妥当性を確認してください。";

// ---- 純関数ヘルパー（テスト対象） ----

const holdSignal = (): Signal => ({ action: "hold", reason: "" });

/** 系列を終値配列（古い→新しい）に変換。 */
export function toCloses(series: StrategyBar[]): number[] {
  return series.map((b) => b.close);
}

/** 最新バーの終値。空系列や非有限値は null。 */
export function lastClose(series: StrategyBar[]): number | null {
  if (series.length === 0) return null;
  const c = series[series.length - 1].close;
  return Number.isFinite(c) ? c : null;
}

/** 直近 period 本の終値の単純移動平均（最新値）。データ不足は null。 */
export function sma(closes: number[], period: number): number | null {
  if (period <= 0 || closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

/**
 * 最新バーを除いた直前 period 本の終値の最大値（＝直近高値）。データ不足は null。
 * 「終値が直近 period 日高値を更新」の判定に使う（最新終値 > priorHigh なら更新）。
 */
export function priorHigh(closes: number[], period: number): number | null {
  if (period <= 0 || closes.length < period + 1) return null;
  let hi = -Infinity;
  for (let i = closes.length - 1 - period; i < closes.length - 1; i++) {
    if (closes[i] > hi) hi = closes[i];
  }
  return hi;
}

/** lookback 本前の終値と比較した騰落率（%）。データ不足・ゼロ除算は null。 */
export function momentumPct(closes: number[], lookback: number): number | null {
  if (lookback <= 0 || closes.length < lookback + 1) return null;
  const past = closes[closes.length - 1 - lookback];
  const cur = closes[closes.length - 1];
  if (!Number.isFinite(past) || past === 0) return null;
  return ((cur - past) / past) * 100;
}

/** 建玉価格に対する現在（最新終値）の損益率（%）。算出不能は null。 */
export function currentGainPct(entryPrice: number, series: StrategyBar[]): number | null {
  const cur = lastClose(series);
  if (cur == null || !Number.isFinite(entryPrice) || entryPrice === 0) return null;
  return ((cur - entryPrice) / entryPrice) * 100;
}

/** 最新バーで MACD ゴールデンクロスが発生したか（データ不足時 false）。 */
export function isGoldenCross(closes: number[]): boolean {
  return computeMacdState(closes) === "ゴールデンクロス";
}

/** RSI(period) の最新値（データ不足は null）。indicators/rsi を委譲。 */
export function rsiLast(closes: number[], period: number): number | null {
  return calculateRSI(closes, period);
}

export { holdSignal };
