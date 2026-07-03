/**
 * 出来高アラート（Phase 44・完全ローカル）。
 * 既存 alerts.ts は変更せず、出来高指標に基づくアラートを別レイヤーで生成する。
 * Phase 49: 発火倍率・RSI過熱値はユーザーの ThresholdSettings を参照（未指定時は設定値）。
 */
import type { Stock } from "@/lib/types";
import { getThresholds } from "@/lib/settings/thresholds";

export interface VolumeThresholds {
  relativeVolumeWarning: number;
  relativeVolumeDanger: number;
  rsiOverheat: number;
}

function resolveThresholds(t?: VolumeThresholds): VolumeThresholds {
  if (t) return t;
  const s = getThresholds();
  return { relativeVolumeWarning: s.relativeVolumeWarning, relativeVolumeDanger: s.relativeVolumeDanger, rsiOverheat: s.rsiOverheat };
}

export type VolumeAlertLevel = "info" | "warning" | "danger";
export type VolumeAlertType = "volume_spike" | "volume_drop" | "overheat" | "low_liquidity";

export interface VolumeAlert {
  id: string;
  stockCode: string;
  stockName: string;
  level: VolumeAlertLevel;
  type: VolumeAlertType;
  message: string;
  relativeVolume: number | null;
  volumeTrend: string;
  rsi: number | null;
  createdAt: string;
}

/** 単一銘柄の出来高アラート。しきい値は ThresholdSettings（未指定時）を参照。 */
export function stockVolumeAlerts(stock: Stock, thresholds?: VolumeThresholds): VolumeAlert[] {
  const rv = stock.relativeVolume;
  if (rv == null) return [];
  const t = resolveThresholds(thresholds);
  const now = new Date().toISOString();
  const trend = stock.volumeTrend ?? "unknown";
  const base = { stockCode: stock.code, stockName: stock.name, relativeVolume: rv, volumeTrend: trend, rsi: stock.rsi ?? null, createdAt: now };
  const out: VolumeAlert[] = [];

  // 急増
  if (rv >= t.relativeVolumeDanger)
    out.push({ ...base, id: `volume_spike-${stock.code}`, type: "volume_spike", level: "danger", message: `出来高が20日平均の${rv}倍と急増しています（危険水準）。資金流入または仕手的な動きに注意してください。` });
  else if (rv >= t.relativeVolumeWarning)
    out.push({ ...base, id: `volume_spike-${stock.code}`, type: "volume_spike", level: "warning", message: `出来高が20日平均の${rv}倍です。資金流入の可能性があります。` });

  // 過熱（RSI高値×出来高急増）
  if (stock.rsi != null && stock.rsi >= t.rsiOverheat && rv >= t.relativeVolumeWarning)
    out.push({ ...base, id: `overheat-${stock.code}`, type: "overheat", level: "danger", message: `RSI ${stock.rsi} の高値圏で出来高が急増しています。短期過熱に注意してください。` });

  // 急減
  if (rv <= 0.5)
    out.push({ ...base, id: `volume_drop-${stock.code}`, type: "volume_drop", level: "warning", message: `出来高が20日平均の${rv}倍に低下しています。上昇の持続性には確認が必要です。` });

  // 低流動性（トレンド減少）
  if (trend === "decreasing")
    out.push({ ...base, id: `low_liquidity-${stock.code}`, type: "low_liquidity", level: "info", message: `出来高トレンドが減少しています。流動性・関心の低下に留意してください。` });

  return out;
}

const LEVEL_ORDER: Record<VolumeAlertLevel, number> = { danger: 0, warning: 1, info: 2 };

/** 全銘柄の出来高アラート（レベル降順）。 */
export function allVolumeAlerts(stocks: Stock[], thresholds?: VolumeThresholds): VolumeAlert[] {
  const t = resolveThresholds(thresholds);
  return stocks.flatMap((s) => stockVolumeAlerts(s, t)).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

export interface VolumeAlertSummary {
  spikeCount: number; // 出来高急増銘柄数
  overheatCount: number; // 過熱出来高銘柄数
  dropCount: number; // 出来高低下銘柄数（急減＋トレンド減少）
  alerts: VolumeAlert[];
}

export function summarizeVolumeAlerts(stocks: Stock[], thresholds?: VolumeThresholds): VolumeAlertSummary {
  const alerts = allVolumeAlerts(stocks, thresholds);
  const uniq = (t: VolumeAlertType) => new Set(alerts.filter((a) => a.type === t).map((a) => a.stockCode)).size;
  const dropCodes = new Set(alerts.filter((a) => a.type === "volume_drop" || a.type === "low_liquidity").map((a) => a.stockCode));
  return {
    spikeCount: uniq("volume_spike"),
    overheatCount: uniq("overheat"),
    dropCount: dropCodes.size,
    alerts,
  };
}
