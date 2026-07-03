/**
 * 出来高指標（Phase 42・純関数）。
 * 日足 volume 系列から相対出来高・トレンドを算出する。
 */
import type { Stock } from "@/lib/types";

export type VolumeTrend = "increasing" | "decreasing" | "flat" | "unknown";

export interface VolumeMetrics {
  volume: number | null;
  relativeVolume: number | null; // 直近 ÷ 20日平均
  volumeTrend: VolumeTrend;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** 出来高系列（古い→新しい順）から指標を算出。 */
export function computeVolumeMetrics(volumes: number[]): VolumeMetrics {
  const v = volumes.filter((x) => typeof x === "number" && Number.isFinite(x) && x >= 0);
  if (v.length === 0) return { volume: null, relativeVolume: null, volumeTrend: "unknown" };
  const latest = v[v.length - 1];
  const avg20 = mean(v.slice(-20));
  const avg5 = mean(v.slice(-5));
  const relativeVolume = avg20 > 0 ? Math.round((latest / avg20) * 100) / 100 : null;
  let volumeTrend: VolumeTrend = "unknown";
  if (v.length >= 5 && avg20 > 0) {
    const r = avg5 / avg20;
    volumeTrend = r >= 1.15 ? "increasing" : r <= 0.85 ? "decreasing" : "flat";
  }
  return { volume: latest, relativeVolume, volumeTrend };
}

export const VOLUME_TREND_LABEL: Record<VolumeTrend, string> = {
  increasing: "増加",
  decreasing: "減少",
  flat: "横ばい",
  unknown: "—",
};

/** 出来高に関する JARVIS コメント（該当なしは null）。 */
export function volumeComment(stock: Stock): string | null {
  const rv = stock.relativeVolume;
  if (rv == null) return null;
  if (stock.rsi != null && stock.rsi >= 80 && rv >= 1.5)
    return `RSIが高く、出来高も${rv}倍と急増しています。短期過熱に注意してください。`;
  if (rv >= 1.5) return `出来高が20日平均の${rv}倍です。資金流入の可能性があります。`;
  if (rv < 0.5) return `出来高が低下しています（${rv}倍）。上昇の持続性には確認が必要です。`;
  return null;
}
