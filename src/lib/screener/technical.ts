/**
 * スクリーナー: テクニカル指標＋スコア/ランク（純関数）。
 *
 * - 既存 indicators（rsi/macd/volume）を **再利用**（再実装しない）。
 * - 調整後系列から合成 Stock（ファンダ null）を組み立て、既存 scoreStock で技術スコアを得る。
 *   scoreStock はファンダ null を 0 寄与として扱うため、技術寄与のみで破綻しない。
 * - 上位N抽出は同点時に code 昇順で決定的（deterministic）。
 *
 * ファンダ（PER/PBR/ROE 等）は Stage 4b で技術上位のみ付与し、フルスコアで再ランクする。
 */
import type { MacdState, Stock } from "@/lib/types";
import { scoreStock, type ScoreResult } from "@/lib/score";
import { calculateRSI } from "@/lib/indicators/rsi";
import { computeMacdState } from "@/lib/indicators/macd";
import { computeVolumeMetrics } from "@/lib/indicators/volume";
import type { UniverseEntry, AdjBar } from "./universe";

export interface ScreenerRow {
  code: string;
  name: string;
  sector: string;
  market: string;
  price: number | null;
  rsi: number | null;
  macd: MacdState;
  relativeVolume: number | null;
  score: number;
  grade: ScoreResult["grade"];
}

const nums = (xs: (number | null)[]): number[] => xs.filter((v): v is number => v != null);

/**
 * 調整後系列から合成 Stock を組み立てる（技術指標のみ・ファンダは null）。
 * current_price は最新の調整後終値。indicators は既存関数で算出する。
 */
export function toSyntheticStock(entry: UniverseEntry, series: AdjBar[]): Stock {
  const closes = nums(series.map((b) => b.adjClose));
  const volumes = nums(series.map((b) => b.adjVolume));
  const rsi = calculateRSI(closes);
  const macd = computeMacdState(closes);
  const vm = computeVolumeMetrics(volumes);
  const price = closes.length ? closes[closes.length - 1] : null;
  return {
    id: entry.code,
    code: entry.code,
    name: entry.name,
    market: entry.market || null,
    theme: null,
    per: null,
    pbr: null,
    roe: null,
    sales_growth: null,
    operating_margin: null,
    rsi: rsi ?? null,
    macd,
    current_price: price,
    stop_loss: null,
    take_profit: null,
    rank: "C",
    status: "見送り",
    memo: null,
    price_updated_at: null,
    volume: vm.volume ?? undefined,
    relativeVolume: vm.relativeVolume ?? undefined,
    volumeTrend: vm.volume != null ? vm.volumeTrend : undefined,
  } as Stock;
}

/** 銘柄1件のスクリーナー行（技術スコア）を作る。 */
export function screenRow(entry: UniverseEntry, series: AdjBar[]): ScreenerRow {
  const stock = toSyntheticStock(entry, series);
  const result = scoreStock(stock);
  return {
    code: entry.code,
    name: entry.name,
    sector: entry.sector33 || entry.sector17,
    market: entry.market,
    price: stock.current_price,
    rsi: stock.rsi,
    macd: stock.macd,
    relativeVolume: stock.relativeVolume ?? null,
    score: result.score,
    grade: result.grade,
  };
}

/**
 * ユニバース × 系列マップ → スクリーナー行の配列。
 * 系列が無い/空の銘柄はスキップ（データ不足の行をランクに混ぜない）。
 */
export function buildScreenerRows(
  universe: UniverseEntry[],
  seriesByCode: Map<string, AdjBar[]>
): ScreenerRow[] {
  const rows: ScreenerRow[] = [];
  for (const entry of universe) {
    const series = seriesByCode.get(entry.code);
    if (!series || series.length === 0) continue;
    rows.push(screenRow(entry, series));
  }
  return rows;
}

/** スコア降順に並べる。同点は code 昇順で決定的に安定化する。 */
export function rankRows(rows: ScreenerRow[]): ScreenerRow[] {
  return rows.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.code.localeCompare(b.code);
  });
}

/** 上位 N を返す（ランク後に切り出し・N<=0 は空）。 */
export function selectTopN(rows: ScreenerRow[], n: number): ScreenerRow[] {
  return rankRows(rows).slice(0, Math.max(0, n));
}
