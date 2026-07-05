/**
 * Phase 59 (v1.7候補): MACD 状態の自動判定（完全ローカル・純関数）。
 * 終値系列から MACD(12,26) とシグナル(9) を計算し、MacdState を返す。
 * データ不足時は "不明" を返す（安全fallback）。
 */
import type { MacdState } from "@/lib/types";

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

/** 終値系列から MACD 状態を判定。最低35点程度必要。 */
export function computeMacdState(closes: number[]): MacdState {
  if (!Array.isArray(closes) || closes.length < 35) return "不明";
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = closes.map((_, i) => ema12[i] - ema26[i]);
  const signal = ema(macd, 9);
  const n = closes.length;
  const curDiff = macd[n - 1] - signal[n - 1];
  const prevDiff = macd[n - 2] - signal[n - 2];

  if (prevDiff <= 0 && curDiff > 0) return "ゴールデンクロス";
  if (prevDiff >= 0 && curDiff < 0) return "デッドクロス";
  if (curDiff > 0) return "上昇中";
  if (curDiff < 0) return "下降中";
  return "横ばい";
}
