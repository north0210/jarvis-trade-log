"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import AiComment from "@/components/AiComment";
import { getThresholds } from "@/lib/settings/thresholds";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { getCashPosition, analyzePortfolio } from "@/lib/analysis/portfolio";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { getAnalysisRuns } from "@/lib/settings/performance";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateDiscipline } from "@/lib/discipline/rules";
import { evaluateRisk, type RiskCategory, type RiskGrade } from "@/lib/risk/risk-engine";
import type { Holding, Stock, Trade } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const tradeRepo = getTradeRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const gradeCls: Record<RiskGrade, string> = {
  S: "text-arc",
  A: "text-arc",
  B: "text-[#cfeaff]",
  C: "text-caution",
  D: "text-danger",
};
const lvlCls: Record<RiskCategory["level"], string> = {
  danger: "border-danger/50 text-danger bg-danger/5",
  warning: "border-caution/50 text-caution bg-caution/5",
  info: "border-line text-arcdim",
};

function Metric({ label, value, tone = "neutral" }: { label: ReactNode; value: string; tone?: "neutral" | "profit" | "danger" | "caution" }) {
  const color = tone === "profit" ? "text-profit" : tone === "danger" ? "text-danger" : tone === "caution" ? "text-caution" : "text-arc";
  return (
    <div className="hud-panel p-3">
      <p className="hud-label">{label}</p>
      <p className={`font-mono text-xl mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function CatCard({ c }: { c: RiskCategory }) {
  return (
    <div className={`rounded border px-3 py-2 text-sm ${lvlCls[c.level]}`}>
      <p className="font-display tracking-wider">{c.label}</p>
      <p className="font-mono mt-1">{c.detail}</p>
    </div>
  );
}

export default function RiskPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [cash, setCash] = useState(0);

  useEffect(() => {
    (async () => {
      const [s, h, t] = await Promise.all([stockRepo.list(), holdingRepo.list(), tradeRepo.list()]);
      setStocks(s);
      setHoldings(h);
      setTrades(t);
      setCash(getCashPosition());
    })();
  }, []);

  const risk = useMemo(() => {
    const portfolio = analyzePortfolio(stocks, holdings, cash);
    const mc = runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: getAnalysisRuns() });
    const backtest = runBacktest(trades);
    const discipline = evaluateDiscipline(stocks, holdings, trades, cash);
    return evaluateRisk(portfolio, mc, backtest, discipline, trades, getThresholds());
  }, [stocks, holdings, trades, cash]);

  const scoreTone = risk.riskScore >= 80 ? "profit" : risk.riskScore >= 65 ? "neutral" : risk.riskScore >= 50 ? "caution" : "danger";
  const noData = stocks.length === 0 && holdings.length === 0 && trades.length === 0;

  return (
    <div className="space-y-6">
      <PageIntro title="🛡 リスク" description="現在の危険度・破産確率・集中リスクを確認します。" helpKey="riskgrade" />
      {noData && (
        <section className="hud-panel p-4 border-caution/50 bg-caution/5">
          <p className="text-sm font-mono text-caution">・データが不足しています。銘柄・保有株・取引を登録後に再解析します、ボス。</p>
        </section>
      )}
      <section className="hud-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="hud-label"><HelpTooltip termKey="riskgrade" label="🛡 リスクエンジン — Risk Console" /></h2>
          <span className={`font-display text-3xl ${gradeCls[risk.riskGrade]}`}>Grade {risk.riskGrade}</span>
        </div>
        <p className={`font-mono text-4xl mt-2 ${scoreTone === "profit" ? "text-profit" : scoreTone === "caution" ? "text-caution" : scoreTone === "danger" ? "text-danger" : "text-arc"}`}>
          Risk Score {risk.riskScore}
        </p>
        <p className="text-arcdim text-xs mt-1">スコアは高いほど低リスク（健全）です。</p>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <Metric label={<HelpTooltip termKey="var" label="VaR95（1取引）" />} value={`¥${fmt(risk.var95)}（${risk.var95Pct.toFixed(1)}%）`} tone="danger" />
        <Metric label="CVaR95" value={`¥${fmt(risk.cvar95)}（${risk.cvar95Pct.toFixed(1)}%）`} tone="danger" />
        <Metric label={<HelpTooltip termKey="dd" label="最大DD（実績）" />} value={`${risk.maxDrawdown.toFixed(1)}%`} tone="danger" />
        <Metric label="DD95（MC）" value={`${risk.dd95.toFixed(1)}%`} tone="caution" />
        <Metric label={<HelpTooltip termKey="montecarlo" label="破産確率" />} value={`${(risk.ruinProbability * 100).toFixed(1)}%`} tone={risk.ruinProbability > 0.05 ? "danger" : "neutral"} />
        <Metric label="資産半減確率" value={`${(risk.halfCapitalProbability * 100).toFixed(1)}%`} tone={risk.halfCapitalProbability > 0.1 ? "danger" : "neutral"} />
        <Metric label="重大リスク" value={`${risk.dangerCount}`} tone={risk.dangerCount > 0 ? "danger" : "neutral"} />
        <Metric label="警告リスク" value={`${risk.warningCount}`} tone={risk.warningCount > 0 ? "caution" : "neutral"} />
      </div>

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">リスクカテゴリ</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <CatCard c={risk.concentrationRisk} />
          <CatCard c={risk.themeRisk} />
          <CatCard c={risk.disciplineRisk} />
          <CatCard c={risk.liquidityRisk} />
        </div>
      </section>

      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS リスク所見</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {risk.overallComment.map((c, i) => <li key={i}>・{c}</li>)}
        </ul>
      </section>

      <AiComment
        ctx={{
          title: "Risk",
          facts: [
            `Risk Grade ${risk.riskGrade} / Score ${risk.riskScore}`,
            `VaR95 ${risk.var95Pct.toFixed(1)}% / CVaR95 ${risk.cvar95Pct.toFixed(1)}%`,
            `破産確率 ${(risk.ruinProbability * 100).toFixed(1)}% / 資産半減 ${(risk.halfCapitalProbability * 100).toFixed(1)}%`,
            `最大DD ${risk.maxDrawdown.toFixed(1)}% / 重大リスク ${risk.dangerCount}件`,
          ],
        }}
      />
    </div>
  );
}
