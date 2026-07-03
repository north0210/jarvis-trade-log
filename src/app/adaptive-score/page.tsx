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
import { analyzeFactors, type FactorAnalysis } from "@/lib/analytics/factor-analysis";
import {
  adaptiveScoreStock,
  getAdaptiveScoreSettings,
  setAdaptiveScoreSettings,
  type FactorWeights,
} from "@/lib/score/adaptive-score";
import type { Holding, Stock, Strategy, Trade } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const tradeRepo = getTradeRepository();

const gradeCls: Record<string, string> = {
  S: "text-profit",
  A: "text-arc",
  B: "text-arc",
  C: "text-caution",
  D: "text-danger",
};
const WEIGHT_KEYS: (keyof FactorWeights)[] = ["value", "growth", "quality", "momentum", "risk", "discipline"];
const WEIGHT_LABEL: Record<keyof FactorWeights, string> = {
  value: "Value",
  growth: "Growth",
  quality: "Quality",
  momentum: "Momentum",
  risk: "Risk",
  discipline: "Discipline",
};

export default function AdaptiveScorePage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [cash, setCash] = useState(0);
  const [weights, setWeights] = useState<FactorWeights>(getAdaptiveScoreSettings().factorWeights);

  useEffect(() => {
    (async () => {
      const [s, h, t, strats] = await Promise.all([stockRepo.list(), holdingRepo.list(), tradeRepo.list(), ensureSeeded()]);
      setStocks(s);
      setHoldings(h);
      setTrades(t);
      setStrategies(strats);
      setCash(getCashPosition());
      setWeights(getAdaptiveScoreSettings().factorWeights);
    })();
  }, []);

  const factor: FactorAnalysis = useMemo(() => {
    const portfolio = analyzePortfolio(stocks, holdings, cash);
    const mc = trades.length ? runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: getDashboardRuns() }) : null;
    const backtest = runBacktest(trades);
    const discipline = evaluateDiscipline(stocks, holdings, trades, cash);
    const risk = mc ? evaluateRisk(portfolio, mc, backtest, discipline, trades) : null;
    return analyzeFactors(stocks, trades, strategies, risk, discipline);
  }, [stocks, holdings, trades, strategies, cash]);

  const rows = useMemo(
    () =>
      stocks
        .map((s) => ({ stock: s, r: adaptiveScoreStock(s, factor, weights) }))
        .sort((a, b) => b.r.score - a.r.score),
    [stocks, factor, weights]
  );

  const comments = useMemo(() => {
    const out: string[] = [];
    if (trades.length < 5) out.push("Adaptive補正はまだ検証件数が少ないため、参考値として扱ってください。");
    const best = factor.bestFactor;
    if (best) out.push(`${best.label}の寄与が高いため、該当性の高い銘柄の配点をやや強めています。`);
    const mom = factor.factors.find((f) => f.key === "momentum");
    if (mom && mom.contribution < -0.1)
      out.push("Momentum Factorが損失に寄与しているため、RSI過熱銘柄への評価を抑制しています。");
    if (out.length === 0) out.push("現時点で顕著なファクター偏りはなく、補正は小幅です。");
    return out;
  }, [factor, trades.length]);

  const saveWeights = () => {
    setAdaptiveScoreSettings({ factorWeights: weights });
  };
  const setW = (k: keyof FactorWeights, v: number) => setWeights((w) => ({ ...w, [k]: Math.max(0, Math.min(100, v)) }));

  return (
    <div className="space-y-6">
      <PageIntro title="⚙◆ 適応スコア" description="相場環境に応じて重み付けを変えた発展スコアを確認します。" helpKey="adaptivescore" />
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3"><HelpTooltip termKey="adaptivescore" label="⚙◆ Adaptive Score（適応スコア）" /></h2>
        <p className="text-arcdim text-xs">
          既存 Score を基準に、Factor分析の寄与度に応じて ±15点 補正します（score.ts は不変）。
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
          {WEIGHT_KEYS.map((k) => (
            <label key={k} className="block">
              <span className="hud-label"><HelpTooltip termKey={`${k}factor`} label={`${WEIGHT_LABEL[k]} 重み`} /></span>
              <input className="hud-input mt-1" type="number" min="0" max="100" value={weights[k]} onChange={(e) => setW(k, Number(e.target.value))} />
            </label>
          ))}
        </div>
        <button className="hud-btn mt-3" onClick={saveWeights}>重みを保存</button>
      </section>

      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS Adaptive 所見</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {comments.map((c, i) => <li key={i}>・{c}</li>)}
        </ul>
      </section>

      <section className="hud-panel p-4 overflow-x-auto">
        <h2 className="hud-label mb-3">銘柄別 適応スコア</h2>
        {rows.length === 0 ? (
          <p className="text-arcdim text-sm">銘柄がありません。</p>
        ) : (
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {([
                  { h: "銘柄" }, { h: "通常Score" }, { h: "Adaptive", t: "adaptivescore" }, { h: "差分" }, { h: "推奨Grade" }, { h: "補正理由" },
                ] as { h: string; t?: string }[]).map((c) => (
                  <th key={c.h} className="pb-2 pr-3 font-normal">{c.t ? <HelpTooltip termKey={c.t} label={c.h} /> : c.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ stock, r }) => {
                const adaptiveReasons = r.reasons.filter((x) => x.startsWith("Adaptive:"));
                return (
                  <tr key={stock.id} className="border-t border-line/60 align-top">
                    <td className="py-2 pr-3">{stock.name} <span className="opacity-60">({stock.code})</span></td>
                    <td className="py-2 pr-3">{r.baseScore}</td>
                    <td className={`py-2 pr-3 ${gradeCls[r.grade]}`}>{r.score}</td>
                    <td className={`py-2 pr-3 ${r.adjustment > 0 ? "text-profit" : r.adjustment < 0 ? "text-danger" : "text-arcdim"}`}>
                      {r.adjustment > 0 ? "+" : ""}{r.adjustment}
                    </td>
                    <td className={`py-2 pr-3 ${gradeCls[r.grade]}`}>{r.grade}</td>
                    <td className="py-2 pr-3 whitespace-normal text-xs text-arcdim">
                      {adaptiveReasons.length ? adaptiveReasons.map((x) => x.replace("Adaptive: ", "")).join(" / ") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
