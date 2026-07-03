"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import AiComment from "@/components/AiComment";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import { estimateStrategyId } from "@/lib/analysis/strategyPerf";
import { runBacktest, PERIOD_OPTIONS, type BacktestResult } from "@/lib/analysis/backtest";
import type { Stock, Strategy, Trade } from "@/lib/types";

const stockRepo = getStockRepository();
const tradeRepo = getTradeRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const yen = (n: number) => `${n >= 0 ? "+" : ""}¥${fmt(n)}`;

function Spark({ values, color, height = 120 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return <p className="text-arcdim text-sm">データ不足（2取引以上で描画）</p>;
  const w = 600;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const zeroY = height - ((0 - min) / range) * height;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <line x1={0} x2={w} y1={zeroY} y2={zeroY} stroke="#12203a" strokeWidth={1} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
    </svg>
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

export default function BacktestPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [periodKey, setPeriodKey] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [strategySel, setStrategySel] = useState("all");

  useEffect(() => {
    (async () => {
      const [s, t, strats] = await Promise.all([stockRepo.list(), tradeRepo.list(), ensureSeeded()]);
      setStocks(s);
      setTrades(t);
      setStrategies(strats);
    })();
  }, []);

  const cutoff = useMemo(() => {
    const opt = PERIOD_OPTIONS.find((p) => p.key === periodKey);
    if (!opt || opt.months == null) return null;
    const now = new Date();
    const c = new Date(now.getFullYear(), now.getMonth() - opt.months, now.getDate());
    return c.toISOString().slice(0, 10);
  }, [periodKey]);

  const inPeriod = (dateStr: string) => {
    if (periodKey === "custom") return (!from || dateStr >= from) && (!to || dateStr <= to);
    if (!cutoff) return true; // all
    return dateStr >= cutoff;
  };

  const attributedId = (t: Trade) => estimateStrategyId(t, stocks, strategies);

  const filtered = useMemo(
    () => trades.filter((t) => inPeriod(t.date) && (strategySel === "all" || attributedId(t) === strategySel)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trades, stocks, strategies, periodKey, from, to, strategySel, cutoff]
  );

  const result: BacktestResult = useMemo(() => runBacktest(filtered), [filtered]);

  // 戦略比較
  const comparison = useMemo(
    () =>
      strategies
        .map((s) => ({ s, r: runBacktest(trades.filter((t) => inPeriod(t.date) && attributedId(t) === s.id)) }))
        .filter((x) => x.r.tradeCount > 0)
        .sort((a, b) => b.r.netPnl - a.r.netPnl),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trades, stocks, strategies, periodKey, from, to, cutoff]
  );

  return (
    <div className="space-y-6">
      <PageIntro title="📈 バックテスト" description="過去の取引を再現し、戦略の成績を検証します。" helpKey="cagr" />
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">⧗ バックテスト（実現損益リプレイ）</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="hud-label">対象期間</span>
            <select className="hud-input mt-1 w-36" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)}>
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </label>
          {periodKey === "custom" && (
            <>
              <label className="block">
                <span className="hud-label">開始</span>
                <input className="hud-input mt-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="block">
                <span className="hud-label">終了</span>
                <input className="hud-input mt-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
          <label className="block">
            <span className="hud-label">対象戦略</span>
            <select className="hud-input mt-1 w-44" value={strategySel} onChange={(e) => setStrategySel(e.target.value)}>
              <option value="all">全戦略（推定含む）</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-arcdim text-xs mt-2">
          ※ 確定した取引履歴を戦略・期間でリプレイします（未タグ取引は現在データから推定して集計）。
        </p>
      </section>

      {/* 指標 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <Metric label="取引回数" value={`${result.tradeCount}`} />
        <Metric label="純損益" value={yen(result.netPnl)} tone={result.netPnl > 0 ? "profit" : result.netPnl < 0 ? "danger" : "neutral"} />
        <Metric label="総利益" value={yen(result.totalProfit)} tone="profit" />
        <Metric label="総損失" value={yen(result.totalLoss)} tone="danger" />
        <Metric label={<HelpTooltip termKey="pf" label="プロフィットファクター" />} value={result.profitFactor != null ? result.profitFactor.toFixed(2) : "—"} tone={result.profitFactor != null && result.profitFactor >= 1 ? "profit" : "danger"} />
        <Metric label="勝率" value={`${(result.winRate * 100).toFixed(0)}%`} />
        <Metric label="期待値/取引" value={yen(result.expectancy)} tone={result.expectancy > 0 ? "profit" : result.expectancy < 0 ? "danger" : "neutral"} />
        <Metric label="平均利益" value={yen(result.avgWin)} tone="profit" />
        <Metric label="平均損失" value={yen(result.avgLoss)} tone="danger" />
        <Metric label={<HelpTooltip termKey="dd" label="最大DD" />} value={`¥${fmt(result.maxDrawdown)}（${result.maxDrawdownPct.toFixed(1)}%）`} tone="danger" />
        <Metric label="最大連勝 / 連敗" value={`${result.maxWinStreak} / ${result.maxLossStreak}`} />
        <Metric label="平均保有期間" value={result.avgHoldingDays != null ? `${result.avgHoldingDays.toFixed(0)}日` : "—"} />
      </div>

      {/* チャート */}
      <div className="grid lg:grid-cols-2 gap-4">
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">Equity Curve（累積純損益）</h2>
          <Spark values={result.equity.map((e) => e.equity)} color="#6fe3ff" />
        </section>
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">Drawdown</h2>
          <Spark values={result.equity.map((e) => -e.drawdown)} color="#ff4d5e" />
        </section>
      </div>

      {/* JARVIS 所見 */}
      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS 検証所見</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {result.comments.map((c, i) => <li key={i}>・{c}</li>)}
        </ul>
      </section>

      {/* 戦略比較 */}
      <section className="hud-panel p-4 overflow-x-auto">
        <h2 className="hud-label mb-3">戦略比較（同期間）</h2>
        {comparison.length === 0 ? (
          <p className="text-arcdim text-sm">戦略に紐付く取引がありません。</p>
        ) : (
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {["戦略", "取引", "純損益", "PF", "勝率", "期待値", "最大DD", "最大連敗"].map((h) => (
                  <th key={h} className="pb-2 pr-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.map(({ s, r }) => (
                <tr key={s.id} className="border-t border-line/60">
                  <td className="py-2 pr-3 text-arc">{s.name}</td>
                  <td className="py-2 pr-3">{r.tradeCount}</td>
                  <td className={`py-2 pr-3 ${r.netPnl >= 0 ? "text-profit" : "text-danger"}`}>{yen(r.netPnl)}</td>
                  <td className={`py-2 pr-3 ${r.profitFactor != null && r.profitFactor >= 1 ? "text-arc" : "text-danger"}`}>{r.profitFactor != null ? r.profitFactor.toFixed(2) : "—"}</td>
                  <td className="py-2 pr-3">{(r.winRate * 100).toFixed(0)}%</td>
                  <td className={`py-2 pr-3 ${r.expectancy >= 0 ? "text-profit" : "text-danger"}`}>{yen(r.expectancy)}</td>
                  <td className="py-2 pr-3 text-danger">{r.maxDrawdownPct.toFixed(1)}%</td>
                  <td className="py-2 pr-3">{r.maxLossStreak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <AiComment
        ctx={{
          title: "Backtest",
          facts: [
            `取引回数 ${result.tradeCount} / 勝率 ${(result.winRate * 100).toFixed(0)}%`,
            `PF ${result.profitFactor != null ? result.profitFactor.toFixed(2) : "—"} / 期待値/取引 ¥${fmt(result.expectancy)}`,
            `最大DD ${result.maxDrawdownPct.toFixed(1)}%`,
          ],
        }}
      />
    </div>
  );
}
