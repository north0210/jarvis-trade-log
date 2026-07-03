/**
 * Phase 54: 出来高レポート統合（完全ローカル・純関数）。
 * Phase42〜44の出来高指標と ThresholdSettings（Phase49相当）を束ね、
 * Report / PDF / Dashboard 用の総括データを生成する。
 * alerts.ts / score.ts / types.ts は変更しない。既存 volume-alerts の思想を踏襲。
 */
import type { Stock } from "@/lib/types";
import { getThresholds } from "@/lib/settings/thresholds";

export interface VolumeThresholds {
  relativeVolumeWarning: number;
  relativeVolumeDanger: number;
  rsiOverheat: number;
}

export interface VolumeRow {
  code: string;
  name: string;
  relativeVolume: number | null;
  volumeTrend: string;
  rsi: number | null;
}

export interface VolumeTrendDist {
  increasing: number;
  flat: number;
  decreasing: number;
  unknown: number;
}

export interface VolumeReport {
  hasData: boolean; // 相対出来高を持つ銘柄が1件以上あるか
  thresholds: VolumeThresholds;
  surge: VolumeRow[]; // 出来高急増（rv >= warning、danger優先降順）
  drop: VolumeRow[]; // 出来高急減/低下（rv <= 0.5 もしくは trend decreasing）
  overheat: VolumeRow[]; // RSI高値 + 出来高急増
  ranking: VolumeRow[]; // 相対出来高ランキング（降順）
  trendDist: VolumeTrendDist;
  maxRelVol: VolumeRow | null;
  surgeCount: number;
  overheatCount: number;
  dropCount: number;
  dangerSurgeCount: number;
  comments: string[];
}

function resolveThresholds(t?: VolumeThresholds): VolumeThresholds {
  if (t) return t;
  const s = getThresholds();
  return { relativeVolumeWarning: s.relativeVolumeWarning, relativeVolumeDanger: s.relativeVolumeDanger, rsiOverheat: s.rsiOverheat };
}

const toRow = (s: Stock): VolumeRow => ({
  code: s.code,
  name: s.name,
  relativeVolume: s.relativeVolume ?? null,
  volumeTrend: s.volumeTrend ?? "unknown",
  rsi: s.rsi ?? null,
});

/** 出来高総括を生成。しきい値は未指定時 ThresholdSettings を参照。 */
export function buildVolumeReport(stocks: Stock[], thresholds?: VolumeThresholds): VolumeReport {
  const t = resolveThresholds(thresholds);
  const withRv = stocks.filter((s) => s.relativeVolume != null);
  const hasData = withRv.length > 0;

  const rvOf = (s: Stock) => s.relativeVolume ?? 0;

  const surge = withRv
    .filter((s) => rvOf(s) >= t.relativeVolumeWarning)
    .sort((a, b) => rvOf(b) - rvOf(a))
    .map(toRow);

  const drop = withRv
    .filter((s) => rvOf(s) <= 0.5 || (s.volumeTrend ?? "unknown") === "decreasing")
    .sort((a, b) => rvOf(a) - rvOf(b))
    .map(toRow);

  const overheat = withRv
    .filter((s) => s.rsi != null && s.rsi >= t.rsiOverheat && rvOf(s) >= t.relativeVolumeWarning)
    .sort((a, b) => (b.rsi ?? 0) - (a.rsi ?? 0))
    .map(toRow);

  const ranking = withRv.slice().sort((a, b) => rvOf(b) - rvOf(a)).map(toRow);

  const trendDist: VolumeTrendDist = { increasing: 0, flat: 0, decreasing: 0, unknown: 0 };
  for (const s of stocks) {
    const tr = (s.volumeTrend ?? "unknown") as keyof VolumeTrendDist;
    if (tr in trendDist) trendDist[tr]++;
    else trendDist.unknown++;
  }

  const dangerSurgeCount = surge.filter((r) => (r.relativeVolume ?? 0) >= t.relativeVolumeDanger).length;
  const maxRelVol = ranking[0] ?? null;

  const comments: string[] = [];
  if (!hasData) {
    comments.push("出来高データが不足しています。価格更新後に再解析します、ボス。");
  } else {
    if (surge.length > 0)
      comments.push(`出来高急増銘柄が ${surge.length} 件あります。資金流入の兆候として確認してください。`);
    if (overheat.length > 0)
      comments.push(`RSI高値圏で出来高が増えている銘柄が ${overheat.length} 件あります。短期過熱の可能性があります。`);
    if (drop.length > 0)
      comments.push(`出来高低下が ${drop.length} 件目立ちます。上昇の持続力には注意が必要です。`);
    if (surge.length === 0 && overheat.length === 0 && drop.length === 0)
      comments.push("出来高面で特筆すべき変化はありません。平穏な地合いです、ボス。");
  }

  return {
    hasData,
    thresholds: t,
    surge,
    drop,
    overheat,
    ranking,
    trendDist,
    maxRelVol,
    surgeCount: surge.length,
    overheatCount: overheat.length,
    dropCount: drop.length,
    dangerSurgeCount,
    comments,
  };
}
