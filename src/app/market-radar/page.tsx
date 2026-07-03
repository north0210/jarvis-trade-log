"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getJournalRepository } from "@/lib/storage/journalRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import { analyzePortfolio, getCashPosition } from "@/lib/analysis/portfolio";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { getDashboardRuns } from "@/lib/settings/performance";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateDiscipline } from "@/lib/discipline/rules";
import { evaluateRisk } from "@/lib/risk/risk-engine";
import { analyzeFactors } from "@/lib/analytics/factor-analysis";
import { analyzeMental } from "@/lib/mental/mental-analysis";
import { computeMarketRadar, type MarketState, type RiskMode } from "@/lib/market/market-radar";
import { summarizeVolumeAlerts } from "@/lib/alerts/volume-alerts";
import type { Holding, Journal, Stock, Strategy, Trade } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const journalRepo = getJournalRepository();
const tradeRepo = getTradeRepository();

const stateTone: Record<MarketState, string> = {
  Bull: "text-profit",
  Recovery: "text-arc",
  Neutral: "text-[#cfeaff]",
  Sideways: "text-arcdim",
  Bear: "text-caution",
  Panic: "text-danger",
};
const riskModeTone: Record<RiskMode, string> = { "Risk On": "text-profit", Neutral: "text-arc", "Risk Off": "text-danger" };

/** 0-100 の水平ゲージ（色は値に応じ変化）。 */
function Gauge({ value, label, hueLow }: { value: number; label: string; hueLow?: boolean }) {
  // hueLow=true: 低い方が良い（緑→赤）。false: 高い＝強欲/過熱（緑→赤 反転）
  const color = value >= 70 ? "bg-danger/70" : value >= 40 ? "bg-caution/70" : "bg-profit/70";
  return (
    <div>
      <div className="flex justify-between text-sm font-mono mb-0.5">
        <span className="text-arcdim">{label}</span>
        <span className="text-arc">{value}</span>
      </div>
      <div className="h-3 rounded bg-void/70 border border-line overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      {hueLow && null}
    </div>
  );
}

function Donut({ value }: { value: number }) {
  // 現金推奨比率のドーナツ
  const r = 42;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  return (
    <svg viewBox="0 0 100 100" className="w-28 h-28">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#12203a" strokeWidth="10" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="#6fe3ff" strokeWidth="10" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 50 50)" strokeLinecap="round" />
      <text x="50" y="48" textAnchor="middle" className="fill-arc" style={{ fontSize: 18, fontFamily: "monospace" }}>{value}%</text>
      <text x="50" y="62" textAnchor="middle" className="fill-[#2b7ea8]" style={{ fontSize: 7 }}>現金推奨</text>
    </svg>
  );
}

export default function MarketRadarPage() {
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

  const radar = useMemo(() => {
    const portfolio = analyzePortfolio(stocks, holdings, cash);
    const mc = trades.length ? runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: getDashboardRuns() }) : null;
    const backtest = runBacktest(trades);
    const discipline = evaluateDiscipline(stocks, holdings, trades, cash);
    const risk = mc ? evaluateRisk(portfolio, mc, backtest, discipline, trades) : null;
    const factor = analyzeFactors(stocks, trades, strategies, risk, discipline);
    const mental = trades.length ? analyzeMental(journals, trades) : null;
    return { r: computeMarketRadar({ stocks, portfolio, risk, mc, discipline, mental, factor }), cashRatio: portfolio.cashRatio };
  }, [stocks, holdings, journals, trades, strategies, cash]);

  const r = radar.r;
  const cashDiff = r.cashRecommendation - radar.cashRatio * 100;
  const volSummary = useMemo(() => summarizeVolumeAlerts(stocks), [stocks]);

  return (
    <div className="space-y-6">
      <PageIntro title="📡 マーケットレーダー" description="地合い・過熱・資金流入など市況の全体感を把握します。" />
      <section className="hud-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="hud-label">🛰 マーケットレーダー</h2>
          <span className={`font-display text-2xl ${riskModeTone[r.riskMode]}`}>{r.riskMode}</span>
        </div>
        <p className={`font-mono text-4xl mt-2 ${stateTone[r.marketState]}`}>{r.marketState}</p>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="hud-panel p-4 space-y-4">
          <h2 className="hud-label">市場メーター</h2>
          <Gauge value={r.heatScore} label="Heat Score（過熱度）" />
          <Gauge value={r.fearGreed} label="Fear & Greed（恐怖⇄強欲）" />
          <Gauge value={r.momentum} label="Momentum" />
          <Gauge value={r.breadth} label="Breadth（広がり）" />
        </section>

        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">現金ポジション推奨</h2>
          <div className="flex items-center gap-6">
            <Donut value={r.cashRecommendation} />
            <div className="font-mono text-sm space-y-1">
              <p className="text-arcdim">推奨: <span className="text-arc">{r.cashRecommendation}%</span></p>
              <p className="text-arcdim">現在: <span className="text-[#cfeaff]">{(radar.cashRatio * 100).toFixed(0)}%</span></p>
              <p className="text-arcdim">
                差分:{" "}
                <span className={Math.abs(cashDiff) < 3 ? "text-arcdim" : cashDiff > 0 ? "text-caution" : "text-profit"}>
                  {cashDiff >= 0 ? "+" : ""}{cashDiff.toFixed(0)}pt {cashDiff > 3 ? "（現金を増やす余地）" : cashDiff < -3 ? "（余力あり）" : ""}
                </span>
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* 過熱警告 */}
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">⚠ 過熱・リスク警告</h2>
        {r.warning.length === 0 ? (
          <p className="text-arcdim text-sm">顕著な過熱・集中は検出されていません。</p>
        ) : (
          <ul className="space-y-2">
            {r.warning.map((w, i) => (
              <li key={i} className="text-sm font-mono px-3 py-2 rounded border border-caution/50 text-caution bg-caution/5">{w}</li>
            ))}
          </ul>
        )}
      </section>

      {/* 出来高アラート */}
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">📊 出来高アラート（急増 {volSummary.spikeCount} / 過熱 {volSummary.overheatCount} / 低下 {volSummary.dropCount}）</h2>
        {volSummary.alerts.length === 0 ? (
          <p className="text-arcdim text-sm">出来高アラートはありません。</p>
        ) : (
          <ul className="space-y-1 text-sm font-mono">
            {volSummary.alerts.slice(0, 6).map((a) => (
              <li key={a.id} className={a.level === "danger" ? "text-danger" : a.level === "warning" ? "text-caution" : "text-arc"}>
                ▪ {a.stockName}（{a.stockCode}）: {a.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* JARVIS 所見 */}
      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS 市況所見</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {r.jarvisComment.map((c, i) => <li key={i}>・{c}</li>)}
        </ul>
      </section>
    </div>
  );
}
