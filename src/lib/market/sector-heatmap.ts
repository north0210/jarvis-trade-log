/**
 * セクター/テーマ ヒートマップ（Phase 35・完全ローカル・純関数）。
 * 登録銘柄を theme（セクター/テーマ）別に集計し、強さ・過熱・保有偏りを算出する。
 * 既存 stocks / holdings / scoreStock を再利用（変更しない）。
 * ※ 銘柄マスタに独立した業種フィールドが無いため theme をセクター/テーマとして扱う。
 */
import type { Holding, Stock } from "@/lib/types";
import { scoreStock } from "@/lib/score";
import type { MarketRadarResult } from "./market-radar";

export type SectorRiskLevel = "strong" | "neutral" | "caution" | "danger";

export interface SectorCell {
  sectorName: string;
  stockCount: number;
  holdingCount: number;
  totalMarketValue: number;
  portfolioWeight: number; // 0〜1
  averageScore: number;
  averageRsi: number | null;
  averageRoe: number | null;
  averageGrowth: number | null;
  averagePbr: number | null;
  averagePer: number | null;
  averageRelVolume: number | null; // 平均相対出来高（Phase 42）
  heatScore: number; // 0〜100（強さ・魅力度）
  riskLevel: SectorRiskLevel;
  jarvisComment: string;
}

export interface SectorHeatmap {
  sectors: SectorCell[];
  strongest: SectorCell | null;
  hottest: SectorCell | null; // 最も過熱（RSI/比率）
  maxHoldingSector: SectorCell | null;
  comments: string[];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const avgOf = (arr: (number | null)[]) => {
  const v = arr.filter((x): x is number => x != null);
  return v.length ? mean(v) : null;
};

const rsiHealth = (rsi: number | null) =>
  rsi == null ? 50 : rsi >= 80 ? 25 : rsi >= 72 ? 55 : rsi >= 45 ? 90 : rsi >= 35 ? 60 : 45;
const growthComp = (g: number | null) => (g == null ? 50 : g >= 30 ? 90 : g >= 15 ? 70 : g >= 5 ? 50 : 30);

export function computeSectorHeatmap(
  stocks: Stock[],
  holdings: Holding[],
  _marketRadar?: MarketRadarResult
): SectorHeatmap {
  void _marketRadar;
  const byId = new Map(stocks.map((s) => [s.id, s]));
  const valueByStock = new Map<string, number>();
  let totalValue = 0;
  for (const h of holdings) {
    const st = byId.get(h.stock_id);
    if (!st) continue;
    const v = st.current_price != null ? st.current_price * h.shares : h.buy_price * h.shares;
    valueByStock.set(h.stock_id, (valueByStock.get(h.stock_id) ?? 0) + v);
    totalValue += v;
  }

  const groups = new Map<string, Stock[]>();
  for (const s of stocks) {
    const k = s.theme || "未分類";
    const arr = groups.get(k) ?? [];
    arr.push(s);
    groups.set(k, arr);
  }

  const sectors: SectorCell[] = Array.from(groups.entries()).map(([sectorName, secStocks]) => {
    const held = secStocks.filter((s) => valueByStock.has(s.id));
    const totalMarketValue = secStocks.reduce((a, s) => a + (valueByStock.get(s.id) ?? 0), 0);
    const portfolioWeight = totalValue > 0 ? totalMarketValue / totalValue : 0;
    const averageScore = mean(secStocks.map((s) => scoreStock(s).score));
    const averageRsi = avgOf(secStocks.map((s) => s.rsi));
    const averageRoe = avgOf(secStocks.map((s) => s.roe));
    const averageGrowth = avgOf(secStocks.map((s) => s.sales_growth));
    const averagePbr = avgOf(secStocks.map((s) => s.pbr));
    const averagePer = avgOf(secStocks.map((s) => s.per));
    const averageRelVolume = avgOf(secStocks.map((s) => s.relativeVolume ?? null));

    const heatScore = clamp(0.45 * averageScore + 0.25 * rsiHealth(averageRsi) + 0.3 * growthComp(averageGrowth));

    let riskLevel: SectorRiskLevel;
    if ((averageRsi != null && averageRsi >= 80) || portfolioWeight >= 0.6) riskLevel = "danger";
    else if ((averageRsi != null && averageRsi >= 72) || portfolioWeight >= 0.4) riskLevel = "caution";
    else if (heatScore >= 70) riskLevel = "strong";
    else riskLevel = "neutral";

    // セル別コメント
    let jarvisComment = "";
    if (averageRsi != null && averageRsi >= 80)
      jarvisComment = `Scoreは${averageScore.toFixed(0)}と高いですが、RSI平均が${averageRsi.toFixed(0)}です。短期過熱に注意してください。`;
    else if (portfolioWeight >= 0.6)
      jarvisComment = `平均Scoreは良好ですが、ポートフォリオ比率が${(portfolioWeight * 100).toFixed(0)}%を超えています。集中しすぎです。`;
    else if (heatScore >= 70 && held.length === 0)
      jarvisComment = "スコアが高い一方、保有していません。分散候補として検討余地があります。";
    else if (held.length === 0)
      jarvisComment = "保有比率が低く、分散候補として検討余地があります。";
    else jarvisComment = `平均Score ${averageScore.toFixed(0)} / RSI ${averageRsi != null ? averageRsi.toFixed(0) : "—"}。`;

    return {
      sectorName,
      stockCount: secStocks.length,
      holdingCount: held.length,
      totalMarketValue,
      portfolioWeight,
      averageScore,
      averageRsi,
      averageRoe,
      averageGrowth,
      averagePbr,
      averagePer,
      averageRelVolume,
      heatScore,
      riskLevel,
      jarvisComment,
    };
  });

  sectors.sort((a, b) => b.heatScore - a.heatScore);

  const strongest = sectors.length ? sectors[0] : null;
  const hottest = sectors.length
    ? sectors.slice().sort((a, b) => (b.averageRsi ?? 0) - (a.averageRsi ?? 0))[0]
    : null;
  const maxHoldingSector = sectors.length
    ? sectors.slice().sort((a, b) => b.portfolioWeight - a.portfolioWeight)[0]
    : null;

  const comments: string[] = [];
  if (sectors.length === 0) {
    comments.push("銘柄が登録されていません。銘柄管理から追加してください、ボス。");
  } else {
    if (strongest) comments.push(`最強セクターは「${strongest.sectorName}」（Heat ${strongest.heatScore.toFixed(0)}・平均Score ${strongest.averageScore.toFixed(0)}）です。`);
    if (hottest && hottest.averageRsi != null && hottest.averageRsi >= 72)
      comments.push(`「${hottest.sectorName}」は平均RSI ${hottest.averageRsi.toFixed(0)} と過熱気味です。短期の押し目を待つ判断も有効です。`);
    if (maxHoldingSector && maxHoldingSector.portfolioWeight >= 0.5)
      comments.push(`「${maxHoldingSector.sectorName}」の保有比率が ${(maxHoldingSector.portfolioWeight * 100).toFixed(0)}% と高く、集中リスクがあります。`);
    const lowHeld = sectors.find((s) => s.heatScore >= 65 && s.holdingCount === 0);
    if (lowHeld) comments.push(`「${lowHeld.sectorName}」はスコアが高いのに未保有です。分散候補として検討余地があります。`);
  }

  return { sectors, strongest, hottest, maxHoldingSector, comments };
}
