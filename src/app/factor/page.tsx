"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import { getCashPosition, analyzePortfolio } from "@/lib/analysis/portfolio";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { getDashboardRuns } from "@/lib/settings/performance";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateDiscipline } from "@/lib/discipline/rules";
import { evaluateRisk } from "@/lib/risk/risk-engine";
import { analyzeFactors, type FactorKey } from "@/lib/analytics/factor-analysis";
import type { Holding, Stock, Strategy, Trade } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const tradeRepo = getTradeRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const factorLabel: Record<FactorKey, string> = {
  value: "Value",
  growth: "Growth",
  quality: "Quality",
  momentum: "Momentum",
};

function contribBar(v: number) {
  // −1〜1 を中央0のバーで表現
  const pctMag = Math.min(100, Math.abs(v) * 100);
  const pos = v >= 0;
  return (
    <div className="h-2 rounded bg-void/70 border border-line overflow-hidden flex">
      <div className="w-1/2 flex justify-end">
        {!pos && <div className="h-full bg-danger/60" style={{ width: `${pctMag}%` }} />}
      </div>
      <div className="w-1/2">
        {pos && <div className="h-full bg-arc/60" style={{ width: `${pctMag}%` }} />}
      </div>
    </div>
  );
}

export default function FactorPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [cash, setCash] = useState(0);

  useEffect(() => {
    (async () => {
      const [s, h, t, strats] = await Promise.all([stockRepo.list(), holdingRepo.list(), tradeRepo.list(), ensureSeeded()]);
      setStocks(s);
      setHoldings(h);
      setTrades(t);
      setStrategies(strats);
      setCash(getCashPosition());
    })();
  }, []);

  const analysis = useMemo(() => {
    const portfolio = analyzePortfolio(stocks, holdings, cash);
    const mc = trades.length ? runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: getDashboardRuns() }) : null;
    const backtest = runBacktest(trades);
    const discipline = evaluateDiscipline(stocks, holdings, trades, cash);
    const risk = mc ? evaluateRisk(portfolio, mc, backtest, discipline, trades) : null;
    return analyzeFactors(stocks, trades, strategies, risk, discipline);
  }, [stocks, holdings, trades, strategies, cash]);

  return (
    <div className="space-y-6">
      <PageIntro title="◆ ファクター分析" description="リターンの源泉（Value/Growth/Quality/Momentum等）を分解して確認します。" helpKey="factorcontribution" />
      <section className="hud-panel p-4">
        <h2 className="hud-label"><HelpTooltip termKey="factorcontribution" label="◆ ファクター分析コンソール" /></h2>
      </section>

      {/* Factor カード */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {analysis.factors.map((f) => (
          <div
            key={f.key}
            className={`hud-panel p-4 ${analysis.bestFactor?.key === f.key ? "border-arc/60 shadow-arc" : analysis.worstFactor?.key === f.key ? "border-danger/50" : ""}`}
          >
            <div className="flex items-center justify-between">
              <p className="font-display text-arc">{f.label}</p>
              <span className={`font-mono text-sm ${f.contribution >= 0 ? "text-arc" : "text-danger"}`}>
                {f.contribution >= 0 ? "+" : ""}{(f.contribution * 100).toFixed(0)}%
              </span>
            </div>
            <div className="mt-2">{contribBar(f.contribution)}</div>
            <p className="text-arcdim text-xs mt-2 font-mono">
              平均Score {f.avgScore.toFixed(0)} / 高エクスポージャ勝率 {f.count > 0 ? `${(f.winRate * 100).toFixed(0)}%` : "—"}
            </p>
          </div>
        ))}
      </div>

      {/* Risk / Discipline Factor */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="hud-panel p-3">
          <p className="hud-label"><HelpTooltip termKey="riskfactor" label="Risk Factor" /></p>
          <p className="font-mono text-sm mt-1 text-[#cfeaff]">Grade {analysis.riskFactor.grade} / DD95 {analysis.riskFactor.dd95.toFixed(1)}% / {analysis.riskFactor.concentration}</p>
        </div>
        <div className="hud-panel p-3">
          <p className="hud-label"><HelpTooltip termKey="disciplinefactor" label="Discipline Factor" /></p>
          <p className="font-mono text-sm mt-1 text-[#cfeaff]">規律スコア {analysis.disciplineFactor.score} / 違反 {analysis.disciplineFactor.violations} 件</p>
        </div>
      </div>

      {/* JARVIS 所見 */}
      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS ファクター所見</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {analysis.comments.map((c, i) => <li key={i}>・{c}</li>)}
        </ul>
      </section>

      {/* Factor 別 勝率/損益 */}
      <section className="hud-panel p-4 overflow-x-auto">
        <h2 className="hud-label mb-3">ファクター別 成績（高エクスポージャ ≥60）</h2>
        <table className="w-full text-sm font-mono">
          <thead>
            <tr className="hud-label text-left">
              {([
                { h: "ファクター" }, { h: "平均Score" }, { h: "取引" }, { h: "勝率" }, { h: "実現損益" }, { h: "平均損益" }, { h: "寄与", t: "factorcontribution" },
              ] as { h: string; t?: string }[]).map((c) => (
                <th key={c.h} className="pb-2 pr-3 font-normal">{c.t ? <HelpTooltip termKey={c.t} label={c.h} /> : c.h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analysis.factors.map((f) => (
              <tr key={f.key} className="border-t border-line/60">
                <td className="py-2 pr-3 text-arc">{f.label}</td>
                <td className="py-2 pr-3">{f.avgScore.toFixed(0)}</td>
                <td className="py-2 pr-3">{f.count}</td>
                <td className="py-2 pr-3">{f.count > 0 ? `${(f.winRate * 100).toFixed(0)}%` : "—"}</td>
                <td className={`py-2 pr-3 ${f.pnl >= 0 ? "text-profit" : "text-danger"}`}>{f.count > 0 ? `${f.pnl >= 0 ? "+" : ""}¥${fmt(f.pnl)}` : "—"}</td>
                <td className={`py-2 pr-3 ${f.avgPnl >= 0 ? "text-profit" : "text-danger"}`}>{f.count > 0 ? `${f.avgPnl >= 0 ? "+" : ""}¥${fmt(f.avgPnl)}` : "—"}</td>
                <td className={`py-2 pr-3 ${f.contribution >= 0 ? "text-arc" : "text-danger"}`}>{(f.contribution * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 銘柄別 Factor 分解 */}
      <section className="hud-panel p-4 overflow-x-auto">
        <h2 className="hud-label mb-3">銘柄別 ファクター分解</h2>
        {analysis.perStock.length === 0 ? (
          <p className="text-arcdim text-sm">銘柄がありません。</p>
        ) : (
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {([
                  { h: "銘柄" }, { h: "Value", t: "valuefactor" }, { h: "Growth", t: "growthfactor" }, { h: "Quality", t: "qualityfactor" }, { h: "Momentum", t: "momentumfactor" }, { h: "主要" },
                ] as { h: string; t?: string }[]).map((c) => (
                  <th key={c.h} className="pb-2 pr-3 font-normal">{c.t ? <HelpTooltip termKey={c.t} label={c.h} /> : c.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.perStock.map((r) => (
                <tr key={r.code} className="border-t border-line/60">
                  <td className="py-2 pr-3">{r.name} <span className="opacity-60">({r.code})</span></td>
                  <td className="py-2 pr-3">{r.factors.value.toFixed(0)}</td>
                  <td className="py-2 pr-3">{r.factors.growth.toFixed(0)}</td>
                  <td className="py-2 pr-3">{r.factors.quality.toFixed(0)}</td>
                  <td className="py-2 pr-3">{r.factors.momentum.toFixed(0)}</td>
                  <td className="py-2 pr-3 text-arc">{factorLabel[r.dominant]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
