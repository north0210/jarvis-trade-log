"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import Link from "next/link";
import HelpTooltip from "@/components/HelpTooltip";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { getJournalRepository } from "@/lib/storage/journalRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import { analyzePortfolio, getCashPosition } from "@/lib/analysis/portfolio";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { getDashboardRuns } from "@/lib/settings/performance";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateDiscipline } from "@/lib/discipline/rules";
import { evaluateRisk } from "@/lib/risk/risk-engine";
import { analyzeFactors } from "@/lib/analytics/factor-analysis";
import { analyzeMental } from "@/lib/mental/mental-analysis";
import { computeMarketRadar } from "@/lib/market/market-radar";
import { computeSectorHeatmap } from "@/lib/market/sector-heatmap";
import { generateRebalance, type Priority, type RebalanceSuggestion } from "@/lib/portfolio/rebalance-engine";
import type { Holding, Journal, Stock, Strategy, Trade } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const tradeRepo = getTradeRepository();
const journalRepo = getJournalRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const prioTone: Record<Priority, string> = { high: "border-danger/50 bg-danger/5", medium: "border-caution/50 bg-caution/5", low: "border-line" };
const prioLabel: Record<Priority, string> = { high: "高", medium: "中", low: "低" };
const actionLabel: Record<string, string> = { buy: "買い", sell: "売却", hold: "維持", reduce: "一部圧縮", increase_cash: "現金確保" };

export default function RebalancePage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [cash, setCash] = useState(0);

  useEffect(() => {
    (async () => {
      const [s, h, j, t, strats] = await Promise.all([stockRepo.list(), holdingRepo.list(), journalRepo.list(), tradeRepo.list(), ensureSeeded()]);
      setStocks(s);
      setHoldings(h);
      setJournals(j);
      setTrades(t);
      setStrategies(strats);
      setCash(getCashPosition());
    })();
  }, []);

  const suggestions = useMemo(() => {
    const portfolio = analyzePortfolio(stocks, holdings, cash);
    const mc = trades.length ? runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: getDashboardRuns() }) : null;
    const backtest = runBacktest(trades);
    const discipline = evaluateDiscipline(stocks, holdings, trades, cash);
    const risk = mc ? evaluateRisk(portfolio, mc, backtest, discipline, trades) : null;
    const factor = analyzeFactors(stocks, trades, strategies, risk, discipline);
    const mental = trades.length ? analyzeMental(journals, trades) : null;
    const marketRadar = stocks.length ? computeMarketRadar({ stocks, portfolio, risk, mc, discipline, mental, factor }) : null;
    const sector = stocks.length ? computeSectorHeatmap(stocks, holdings) : null;
    return generateRebalance({ portfolio, risk, marketRadar, sector, holdings, stocks, cash, now: "—" });
  }, [stocks, holdings, journals, trades, strategies, cash]);

  const simHref = (s: RebalanceSuggestion) => {
    if (!s.simStockId || !s.simAction) return null;
    const params = new URLSearchParams({ stockId: s.simStockId, action: s.simAction });
    if (s.simShares) params.set("shares", String(s.simShares));
    if (s.simPrice) params.set("price", String(s.simPrice));
    return `/simulator?${params.toString()}`;
  };

  const highCount = suggestions.filter((s) => s.priority === "high").length;

  return (
    <div className="space-y-6">
      <PageIntro title="♻ リバランス提案" description="偏った保有比率を調整する売買提案を確認します（提案のみ）。" helpKey="rebalance" />
      <section className="hud-panel p-4">
        <h2 className="hud-label"><HelpTooltip termKey="rebalance" label="♻ 自動リバランス提案" /></h2>
        <p className="text-arcdim text-xs mt-1">
          Market Radar / Risk / Sector / Portfolio を統合した売買提案です（提案のみ・自動売買はしません）。高優先 {highCount} 件。
        </p>
      </section>

      {suggestions.length === 0 ? (
        <section className="hud-panel p-4">
          <p className="text-arcdim text-sm">現在のポートフォリオに大きな偏りはありません。リバランスの必要性は低いです、ボス。</p>
        </section>
      ) : (
        suggestions.map((s) => {
          const href = simHref(s);
          return (
            <article key={s.id} className={`hud-panel p-4 border ${prioTone[s.priority]}`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-display text-arc">
                  [{prioLabel[s.priority]}] {actionLabel[s.action] ?? s.action} — {s.stockName}
                  {s.stockCode !== "—" && <span className="text-arcdim"> ({s.stockCode})</span>}
                </h3>
                <span className="hud-label">{s.type}</span>
              </div>
              <p className="text-sm text-[#cfeaff] mb-3">{s.reason}</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1 text-sm font-mono">
                <p><span className="hud-label"><HelpTooltip termKey="currentweight" label="現在比率" /></span> {(s.currentWeight * 100).toFixed(1)}%</p>
                <p><span className="hud-label"><HelpTooltip termKey="targetweight" label="目標比率" /></span> {(s.targetWeight * 100).toFixed(1)}%</p>
                <p><span className="hud-label">概算額</span> ¥{fmt(s.suggestedAmount)}</p>
                <p><span className="hud-label"><HelpTooltip termKey="expectedimpact" label="想定影響" /></span> <span className="text-profit">{s.expectedImpact}</span></p>
              </div>
              <p className="text-xs font-mono mt-1 text-arcdim"><HelpTooltip termKey="riskimpact" label="リスク影響" />: {s.riskImpact}</p>
              {href && (
                <Link href={href} className="hud-btn text-xs px-3 py-1 mt-3 inline-block">シミュレーションで確認 →</Link>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}
