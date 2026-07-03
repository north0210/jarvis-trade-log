"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import AiComment from "@/components/AiComment";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import { getCashPosition, analyzePortfolio } from "@/lib/analysis/portfolio";
import { estimateStrategyId } from "@/lib/analysis/strategyPerf";
import { runMonteCarlo, blockSampler, RUN_OPTIONS, type FanPoint, type DDBucket } from "@/lib/analytics/montecarlo";
import { getAnalysisRuns } from "@/lib/settings/performance";
import {
  buildStrategyGroups,
  compareResampling,
  runCompositeMonteCarlo,
  type ResampleMode,
} from "@/lib/analytics/montecarlo-advanced";
import type { Holding, Stock, Strategy, Trade } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const tradeRepo = getTradeRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const yen = (n: number) => `${n >= 0 ? "+" : ""}¥${fmt(n)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function FanChart({ fan, capital, height = 160 }: { fan: FanPoint[]; capital: number; height?: number }) {
  if (fan.length < 2) return <p className="text-arcdim text-sm">データ不足（2取引以上で描画）</p>;
  const w = 600;
  const all = fan.flatMap((p) => [p.p5, p.p50, p.p95, capital]);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const X = (i: number) => (i / (fan.length - 1)) * w;
  const Y = (v: number) => height - ((v - min) / range) * height;
  const line = (sel: (p: FanPoint) => number) => fan.map((p, i) => `${X(i).toFixed(1)},${Y(sel(p)).toFixed(1)}`).join(" ");
  const area =
    fan.map((p, i) => `${X(i).toFixed(1)},${Y(p.p95).toFixed(1)}`).join(" ") +
    " " +
    fan.map((p, i) => `${X(fan.length - 1 - i).toFixed(1)},${Y(fan[fan.length - 1 - i].p5).toFixed(1)}`).join(" ");
  const capY = Y(capital);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <polygon points={area} fill="rgba(111,227,255,0.12)" />
      <line x1={0} x2={w} y1={capY} y2={capY} stroke="#12203a" strokeWidth={1} />
      <polyline points={line((p) => p.p95)} fill="none" stroke="#2b7ea8" strokeWidth={1} />
      <polyline points={line((p) => p.p5)} fill="none" stroke="#2b7ea8" strokeWidth={1} />
      <polyline points={line((p) => p.p50)} fill="none" stroke="#6fe3ff" strokeWidth={2} />
    </svg>
  );
}

function DDHist({ hist }: { hist: DDBucket[] }) {
  const maxC = Math.max(1, ...hist.map((b) => b.count));
  return (
    <div className="space-y-1.5">
      {hist.map((b) => (
        <div key={b.bucket}>
          <div className="flex justify-between text-xs font-mono mb-0.5">
            <span className="text-arcdim">{b.bucket}</span>
            <span className="text-arc">{b.count}</span>
          </div>
          <div className="h-2 rounded bg-void/70 border border-line overflow-hidden">
            <div className="h-full bg-danger/50" style={{ width: `${(b.count / maxC) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: ReactNode; value: string; tone?: "neutral" | "profit" | "danger" }) {
  const color = tone === "profit" ? "text-profit" : tone === "danger" ? "text-danger" : "text-arc";
  return (
    <div className="hud-panel p-3">
      <p className="hud-label">{label}</p>
      <p className={`font-mono text-xl mt-1 ${color}`}>{value}</p>
    </div>
  );
}

export default function MonteCarloPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [runs, setRuns] = useState(1000);
  const [strategySel, setStrategySel] = useState("all");
  const [capital, setCapital] = useState("");
  const [mode, setMode] = useState<ResampleMode>("iid");
  const [blockSize, setBlockSize] = useState(5);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setRuns(getAnalysisRuns()); // クライアントで実モードを反映（ハイドレーション不整合回避）
    (async () => {
      const [s, h, t, strats] = await Promise.all([stockRepo.list(), holdingRepo.list(), tradeRepo.list(), ensureSeeded()]);
      setStocks(s);
      setHoldings(h);
      setTrades(t);
      setStrategies(strats);
      const port = analyzePortfolio(s, h, getCashPosition());
      setCapital(String(Math.round(port.totalAssets) || 1000000));
    })();
  }, []);

  const pnls = useMemo(
    () =>
      trades
        .filter((t) => strategySel === "all" || estimateStrategyId(t, stocks, strategies) === strategySel)
        .map((t) => t.realizedPnl),
    [trades, stocks, strategies, strategySel]
  );

  const cap = useMemo(() => {
    const n = Number(capital);
    return Number.isFinite(n) && n > 0 ? n : 1000000;
  }, [capital]);

  const result = useMemo(
    () => runMonteCarlo({ pnls, capital: cap, runs, sampler: mode === "block" ? blockSampler(blockSize) : undefined }),
    // nonce で「再実行」に対応（Math.random により毎回わずかに変化）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pnls, cap, runs, mode, blockSize, nonce]
  );

  const comparison = useMemo(
    () => compareResampling(pnls, cap, runs, blockSize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pnls, cap, runs, blockSize, nonce]
  );

  const groups = useMemo(() => buildStrategyGroups(trades, stocks, strategies), [trades, stocks, strategies]);
  const composite = useMemo(
    () => runCompositeMonteCarlo(groups, { capital: cap, runs, mode, blockSize }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, cap, runs, mode, blockSize, nonce]
  );

  return (
    <div className="space-y-6">
      <PageIntro title="🎲 モンテカルロ" description="多数の将来シナリオから破産確率・資産分布を推定します。" helpKey="montecarlo" />
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">🎲 モンテカルロ分析（ブートストラップ）</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="hud-label">シミュレーション回数</span>
            <select className="hud-input mt-1 w-32" value={runs} onChange={(e) => setRuns(Number(e.target.value))}>
              {RUN_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}回</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="hud-label">対象戦略</span>
            <select className="hud-input mt-1 w-44" value={strategySel} onChange={(e) => setStrategySel(e.target.value)}>
              <option value="all">全戦略（推定含む）</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="hud-label">基準資産</span>
            <input className="hud-input mt-1 w-36" type="number" step="10000" value={capital} onChange={(e) => setCapital(e.target.value)} />
          </label>
          <label className="block">
            <span className="hud-label">リサンプリング</span>
            <select className="hud-input mt-1 w-40" value={mode} onChange={(e) => setMode(e.target.value as ResampleMode)}>
              <option value="iid">通常（IID）</option>
              <option value="block">ブロックブートストラップ</option>
            </select>
          </label>
          {mode === "block" && (
            <label className="block">
              <span className="hud-label">ブロック長</span>
              <input className="hud-input mt-1 w-24" type="number" min="2" step="1" value={blockSize} onChange={(e) => setBlockSize(Math.max(2, Number(e.target.value) || 2))} />
            </label>
          )}
          <button className="hud-btn" onClick={() => setNonce((n) => n + 1)}>再実行</button>
        </div>
        <p className="text-arcdim text-xs mt-2">
          対象取引 {pnls.length} 件を復元抽出で {runs} 回サンプリング（1パス={pnls.length}取引）。
        </p>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <Metric label="期待収益" value={`${yen(result.expectedPnl)}（${result.expectedReturnPct >= 0 ? "+" : ""}${result.expectedReturnPct.toFixed(1)}%）`} tone={result.expectedPnl >= 0 ? "profit" : "danger"} />
        <Metric label="中央値" value={yen(result.medianPnl)} tone={result.medianPnl >= 0 ? "profit" : "danger"} />
        <Metric label="95%信頼区間(下限)" value={`${result.ci5Pct >= 0 ? "+" : ""}${result.ci5Pct.toFixed(1)}%`} tone={result.ci5Pnl >= 0 ? "profit" : "danger"} />
        <Metric label="95%信頼区間(上限)" value={`+${result.ci95Pct.toFixed(1)}%`} tone="profit" />
        <Metric label={<HelpTooltip termKey="montecarlo" label="破産確率" />} value={pct(result.ruinProb)} tone={result.ruinProb > 0.05 ? "danger" : "neutral"} />
        <Metric label="資産半減確率" value={pct(result.halveProb)} tone={result.halveProb > 0.1 ? "danger" : "neutral"} />
        <Metric label={<HelpTooltip termKey="dd" label="最大DD (95%ile)" />} value={`${result.dd95.toFixed(1)}%`} tone="danger" />
        <Metric label="DD>30%確率" value={pct(result.probDDover30)} tone={result.probDDover30 > 0.2 ? "danger" : "neutral"} />
        <Metric label="平均最大連敗" value={`${result.maxLossStreakMean.toFixed(1)}回`} />
        <Metric label="5連敗以上確率" value={pct(result.probStreakGE5)} tone={result.probStreakGE5 > 0.3 ? "danger" : "neutral"} />
        <Metric label="最悪ケース" value={yen(result.worstPnl)} tone="danger" />
        <Metric label="最良ケース" value={yen(result.bestPnl)} tone="profit" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">Equity Fan Chart（資産推移 5%/中央/95%）</h2>
          <FanChart fan={result.fan} capital={result.capital} />
        </section>
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">最大DD分布</h2>
          <DDHist hist={result.ddHistogram} />
        </section>
      </div>

      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS モンテカルロ所見</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {result.comments.map((c, i) => <li key={`r${i}`}>・{c}</li>)}
          {comparison.comments.map((c, i) => <li key={`c${i}`} className="text-caution">・{c}</li>)}
        </ul>
      </section>

      {/* 戦略別寄与 ＆ 合成シミュレーション */}
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">戦略別寄与 ＆ 合成シミュレーション</h2>
        {composite.contributions.length === 0 ? (
          <p className="text-arcdim text-sm">戦略に紐付く取引がありません。売却時に戦略を選択すると分析されます。</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div><p className="hud-label">合成 期待リターン</p><p className={`font-mono text-xl mt-1 ${composite.composite.expectedReturnPct >= 0 ? "text-profit" : "text-danger"}`}>{composite.composite.expectedReturnPct >= 0 ? "+" : ""}{composite.composite.expectedReturnPct.toFixed(1)}%</p></div>
              <div><p className="hud-label">合成 破産確率</p><p className={`font-mono text-xl mt-1 ${composite.composite.ruinProb > 0.05 ? "text-danger" : "text-arc"}`}>{(composite.composite.ruinProb * 100).toFixed(1)}%</p></div>
              <div><p className="hud-label">合成 資産半減確率</p><p className={`font-mono text-xl mt-1 ${composite.composite.halveProb > 0.1 ? "text-danger" : "text-arc"}`}>{(composite.composite.halveProb * 100).toFixed(1)}%</p></div>
              <div><p className="hud-label">合成 DD95</p><p className="font-mono text-xl mt-1 text-caution">{composite.composite.dd95.toFixed(1)}%</p></div>
            </div>
            <ul className="space-y-2 mb-3">
              {composite.contributions.map((c) => (
                <li key={c.id ?? "none"}>
                  <div className="flex justify-between text-sm font-mono mb-0.5">
                    <span className="text-[#cfeaff]">{c.name} <span className="text-arcdim">({c.count}件)</span></span>
                    <span className={c.contributionPct >= 0 ? "text-arc" : "text-danger"}>寄与 {(c.contributionPct * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-2 rounded bg-void/70 border border-line overflow-hidden">
                    <div className={`h-full ${c.contributionPct >= 0 ? "bg-arc/60" : "bg-danger/60"}`} style={{ width: `${Math.min(100, Math.abs(c.contributionPct) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <ul className="space-y-1 text-sm font-mono text-arc leading-relaxed">
              {composite.comments.map((c, i) => <li key={i}>・{c}</li>)}
            </ul>
          </>
        )}
      </section>

      <AiComment
        ctx={{
          title: "MonteCarlo",
          facts: [
            `期待収益率 ${result.expectedReturnPct >= 0 ? "+" : ""}${result.expectedReturnPct.toFixed(1)}%`,
            `95%区間 ${result.ci5Pct.toFixed(1)}% 〜 +${result.ci95Pct.toFixed(1)}%`,
            `破産確率 ${(result.ruinProb * 100).toFixed(1)}% / 資産半減 ${(result.halveProb * 100).toFixed(1)}%`,
            `最大DD(95%ile) ${result.dd95.toFixed(1)}%`,
          ],
        }}
      />
    </div>
  );
}
