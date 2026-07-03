/**
 * リバランス提案エンジン（Phase 36・完全ローカル・純関数）。
 * Portfolio / Risk / MarketRadar / SectorHeatmap / Score を統合し、
 * 現在の保有構成に対する具体的な売買提案を生成する（提案のみ・自動売買はしない）。
 */
import type { Holding, Stock } from "@/lib/types";
import type { PortfolioAnalysis } from "@/lib/analysis/portfolio";
import type { RiskReport } from "@/lib/risk/risk-engine";
import type { MarketRadarResult } from "@/lib/market/market-radar";
import type { SectorHeatmap } from "@/lib/market/sector-heatmap";
import { scoreStock } from "@/lib/score";

export type RebalanceType =
  | "reduce"
  | "increase"
  | "buy_candidate"
  | "sell_candidate"
  | "cash_adjustment"
  | "sector_adjustment";
export type Priority = "low" | "medium" | "high";
export type RebalanceAction = "buy" | "sell" | "hold" | "reduce" | "increase_cash";
export type SimAction = "buy" | "add" | "sellPartial" | "sellAll";

export interface RebalanceSuggestion {
  id: string;
  type: RebalanceType;
  priority: Priority;
  stockCode: string;
  stockName: string;
  action: RebalanceAction;
  reason: string;
  currentWeight: number; // 0〜1
  targetWeight: number; // 0〜1
  suggestedAmount: number; // 円（概算）
  expectedImpact: string;
  riskImpact: string;
  createdAt: string;
  // Simulator 連携用
  simStockId?: string;
  simAction?: SimAction;
  simShares?: number;
  simPrice?: number;
}

export interface RebalanceInputs {
  portfolio: PortfolioAnalysis;
  risk: RiskReport | null;
  marketRadar: MarketRadarResult | null;
  sector: SectorHeatmap | null;
  holdings: Holding[];
  stocks: Stock[];
  cash: number;
  now: string;
}

const round = (n: number) => Math.round(n);

export function generateRebalance(input: RebalanceInputs): RebalanceSuggestion[] {
  const { portfolio, risk, marketRadar, sector, holdings, stocks, cash, now } = input;
  const byId = new Map(stocks.map((s) => [s.id, s]));

  // 保有集約
  const agg = new Map<string, { stock: Stock; shares: number; cost: number; value: number }>();
  for (const h of holdings) {
    const stock = byId.get(h.stock_id);
    if (!stock) continue;
    const v = stock.current_price != null ? stock.current_price * h.shares : h.buy_price * h.shares;
    const cur = agg.get(h.stock_id) ?? { stock, shares: 0, cost: 0, value: 0 };
    cur.shares += h.shares;
    cur.cost += h.buy_price * h.shares;
    cur.value += v;
    agg.set(h.stock_id, cur);
  }
  const positions = Array.from(agg.values());
  const totalValue = positions.reduce((a, p) => a + p.value, 0);
  const totalAssets = totalValue + cash;
  const weight = (v: number) => (totalValue > 0 ? v / totalValue : 0);
  const priceOf = (p: { stock: Stock; shares: number; cost: number }) =>
    p.stock.current_price != null ? p.stock.current_price : p.shares > 0 ? p.cost / p.shares : 0;

  const out: RebalanceSuggestion[] = [];
  const push = (s: Omit<RebalanceSuggestion, "createdAt">) => out.push({ ...s, createdAt: now });

  // 1. 1銘柄集中40%以上 → 一部売却
  for (const p of positions) {
    const w = weight(p.value);
    if (w >= 0.4) {
      const price = priceOf(p);
      const target = 0.3;
      const sellValue = (w - target) * totalValue;
      const sellShares = w > 0 ? Math.max(1, round((p.shares * (w - target)) / w)) : 0;
      push({
        id: `conc-${p.stock.code}`,
        type: "reduce",
        priority: "high",
        stockCode: p.stock.code,
        stockName: p.stock.name,
        action: "reduce",
        reason: `${p.stock.name}の比率が${(w * 100).toFixed(0)}%です。期待値は高くても単一銘柄依存が強すぎます。`,
        currentWeight: w,
        targetWeight: target,
        suggestedAmount: round(sellValue),
        expectedImpact: `集中度 ${(w * 100).toFixed(0)}% → ${(target * 100).toFixed(0)}%`,
        riskImpact: "単一銘柄リスクの低減",
        simStockId: p.stock.id,
        simAction: "sellPartial",
        simShares: sellShares,
        simPrice: price || undefined,
      });
    }
  }

  // 6. RSI80以上保有 → 利確・一部売却
  for (const p of positions) {
    if (p.stock.rsi != null && p.stock.rsi >= 80) {
      const price = priceOf(p);
      const sellShares = Math.max(1, round(p.shares * 0.5));
      push({
        id: `rsi-${p.stock.code}`,
        type: "reduce",
        priority: "high",
        stockCode: p.stock.code,
        stockName: p.stock.name,
        action: "sell",
        reason: `${p.stock.name}はRSI ${p.stock.rsi}と過熱圏です。半分利確し利益確定を検討してください。`,
        currentWeight: weight(p.value),
        targetWeight: weight(p.value) / 2,
        suggestedAmount: round(price * sellShares),
        expectedImpact: "過熱局面での利益確定",
        riskImpact: "高値掴み・反落リスクの低減",
        simStockId: p.stock.id,
        simAction: "sellPartial",
        simShares: sellShares,
        simPrice: price || undefined,
      });
    }
  }

  // 5. Grade C/D 保有 → 売却検討
  for (const p of positions) {
    const g = scoreStock(p.stock).grade;
    if (g === "C" || g === "D") {
      const price = priceOf(p);
      push({
        id: `lowgrade-${p.stock.code}`,
        type: "sell_candidate",
        priority: "medium",
        stockCode: p.stock.code,
        stockName: p.stock.name,
        action: "reduce",
        reason: `${p.stock.name}は Grade ${g} です。品質の低い保有はポートフォリオ全体の足を引っ張ります。`,
        currentWeight: weight(p.value),
        targetWeight: 0,
        suggestedAmount: round(p.value),
        expectedImpact: "低評価銘柄の整理",
        riskImpact: "ポートフォリオ品質の向上",
        simStockId: p.stock.id,
        simAction: "sellAll",
        simShares: p.shares,
        simPrice: price || undefined,
      });
    }
  }

  // 2. セクター集中60%以上 → セクター分散
  if (sector && sector.maxHoldingSector && sector.maxHoldingSector.portfolioWeight >= 0.6) {
    const sec = sector.maxHoldingSector;
    // 当該セクターの最大保有銘柄を圧縮対象に
    const inSector = positions.filter((p) => (p.stock.theme || "未分類") === sec.sectorName).sort((a, b) => b.value - a.value)[0];
    push({
      id: `sector-${sec.sectorName}`,
      type: "sector_adjustment",
      priority: "high",
      stockCode: inSector?.stock.code ?? "—",
      stockName: inSector ? inSector.stock.name : sec.sectorName,
      action: "reduce",
      reason: `${sec.sectorName}への集中が${(sec.portfolioWeight * 100).toFixed(0)}%です。防衛・インフラ等の他セクターへ分散する提案です。`,
      currentWeight: sec.portfolioWeight,
      targetWeight: 0.4,
      suggestedAmount: round((sec.portfolioWeight - 0.4) * totalValue),
      expectedImpact: `セクター比率 ${(sec.portfolioWeight * 100).toFixed(0)}% → 40%`,
      riskImpact: "セクター集中リスクの低減",
      simStockId: inSector?.stock.id,
      simAction: inSector ? "sellPartial" : undefined,
      simShares: inSector ? Math.max(1, round(inSector.shares * 0.3)) : undefined,
      simPrice: inSector ? priceOf(inSector) || undefined : undefined,
    });
  }

  // 3. 現金比率が推奨より低い → 現金確保
  const cashRatio = totalAssets > 0 ? cash / totalAssets : 0;
  const recCash = marketRadar ? marketRadar.cashRecommendation / 100 : 0.15;
  if (cashRatio < recCash - 0.05) {
    push({
      id: "cash",
      type: "cash_adjustment",
      priority: cashRatio < recCash - 0.15 ? "high" : "medium",
      stockCode: "—",
      stockName: "現金ポジション",
      action: "increase_cash",
      reason: `現金比率が${(cashRatio * 100).toFixed(0)}%で推奨${(recCash * 100).toFixed(0)}%を下回っています。押し目用資金を確保してください。`,
      currentWeight: cashRatio,
      targetWeight: recCash,
      suggestedAmount: round((recCash - cashRatio) * totalAssets),
      expectedImpact: `現金比率 ${(cashRatio * 100).toFixed(0)}% → ${(recCash * 100).toFixed(0)}%`,
      riskImpact: "下落時の対応余力を確保",
    });
  }

  // 7. Risk Grade C/D → 防御的配分
  if (risk && (risk.riskGrade === "C" || risk.riskGrade === "D")) {
    push({
      id: "defensive",
      type: "cash_adjustment",
      priority: "high",
      stockCode: "—",
      stockName: "全体（防御）",
      action: "increase_cash",
      reason: `総合リスクが Grade ${risk.riskGrade} です。攻めより守りを優先し、リスク資産を圧縮してください。`,
      currentWeight: cashRatio,
      targetWeight: Math.max(recCash, 0.3),
      suggestedAmount: round(Math.max(0, (Math.max(recCash, 0.3) - cashRatio) * totalAssets)),
      expectedImpact: "防御的なポジションへの移行",
      riskImpact: "破産確率・DDの抑制",
    });
  }

  // 4. 高Score未保有 → 買い候補
  const heldIds = new Set(positions.map((p) => p.stock.id));
  for (const s of stocks) {
    if (heldIds.has(s.id)) continue;
    if (scoreStock(s).score >= 80) {
      const price = s.current_price ?? 0;
      const targetW = 0.05;
      const buyValue = targetW * (totalAssets || 1_000_000);
      const buyShares = price > 0 ? Math.max(1, round(buyValue / price)) : 0;
      push({
        id: `buy-${s.code}`,
        type: "buy_candidate",
        priority: "medium",
        stockCode: s.code,
        stockName: s.name,
        action: "buy",
        reason: `${s.name}は Score ${scoreStock(s).score} と高評価ですが未保有です。分散候補として検討余地があります。`,
        currentWeight: 0,
        targetWeight: targetW,
        suggestedAmount: round(buyValue),
        expectedImpact: "高評価銘柄の組入れ",
        riskImpact: "分散によるリスク低減",
        simStockId: s.id,
        simAction: "buy",
        simShares: buyShares || undefined,
        simPrice: price || undefined,
      });
    }
  }

  const order: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.priority] - order[b.priority]);
}
