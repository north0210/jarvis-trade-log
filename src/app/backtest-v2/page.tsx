"use client";

import { useEffect, useState } from "react";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import { getProviderMode, getJQuantsCredentials } from "@/lib/pricing/settings";
import { fetchJQuantsSeries } from "@/lib/pricing/jquantsClient";
import { getCachePolicy, setCachePolicy, type CachePolicy, type SeriesPoint } from "@/lib/analytics/priceCache";
import { scoreStock } from "@/lib/score";
import {
  selectUniverse,
  runEngineBacktest,
  saveBacktestSummary,
  type EngineResult,
} from "@/lib/analytics/backtest-engine";
import { runMonteCarlo, type MonteCarloResult } from "@/lib/analytics/montecarlo";
import type { Stock, Strategy } from "@/lib/types";

const stockRepo = getStockRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const MAX_UNIVERSE = 12;

const PERIODS = [
  { key: "1", label: "1年", years: 1 },
  { key: "3", label: "3年", years: 3 },
  { key: "5", label: "5年", years: 5 },
  { key: "10", label: "10年", years: 10 },
];

function Spark({ values, color, height = 150 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return <p className="text-arcdim text-sm">データ不足</p>;
  const w = 600;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "profit" | "danger" }) {
  const color = tone === "profit" ? "text-profit" : tone === "danger" ? "text-danger" : "text-arc";
  return (
    <div className="hud-panel p-3">
      <p className="hud-label">{label}</p>
      <p className={`font-mono text-xl mt-1 ${color}`}>{value}</p>
    </div>
  );
}

export default function BacktestV2Page() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategyId, setStrategyId] = useState("");
  const [periodKey, setPeriodKey] = useState("3");
  const [policy, setPolicy] = useState<CachePolicy>("90");
  const [capital, setCapital] = useState("1000000");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [mc, setMc] = useState<MonteCarloResult | null>(null);

  useEffect(() => {
    (async () => {
      const [s, strats] = await Promise.all([stockRepo.list(), ensureSeeded()]);
      setStocks(s);
      setStrategies(strats);
      setStrategyId(strats[0]?.id ?? "");
      setPolicy(getCachePolicy());
    })();
  }, []);

  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

  const run = async () => {
    const strategy = strategies.find((s) => s.id === strategyId);
    if (!strategy) return;
    if (getProviderMode() !== "jquants-ready") {
      setError("J-Quantsモードに切り替えてください（設定 → 価格プロバイダ）。実データ取得が必要です。");
      return;
    }
    setError(null);
    setResult(null);
    setMc(null);
    setCachePolicy(policy);

    const years = PERIODS.find((p) => p.key === periodKey)?.years ?? 3;
    const to = new Date();
    const from = new Date(to.getFullYear() - years, to.getMonth(), to.getDate());
    const fromStr = fmtDate(from);
    const toStr = fmtDate(to);

    let universe = selectUniverse(stocks, strategy);
    if (universe.length === 0) {
      setError("この戦略のファンダ条件を満たす銘柄がありません。銘柄を登録・更新してください。");
      return;
    }
    if (universe.length > MAX_UNIVERSE) {
      universe = universe
        .slice()
        .sort((a, b) => scoreStock(b).score - scoreStock(a).score)
        .slice(0, MAX_UNIVERSE);
    }

    setRunning(true);
    setProgress({ done: 0, total: universe.length });
    const creds = getJQuantsCredentials();
    const perCode: { code: string; series: SeriesPoint[] }[] = [];
    let failed = 0;
    for (let i = 0; i < universe.length; i++) {
      const res = await fetchJQuantsSeries(universe[i].code, fromStr, toStr, creds);
      if (res.ok && res.series.length > 0) perCode.push({ code: universe[i].code, series: res.series });
      else failed++;
      setProgress({ done: i + 1, total: universe.length });
    }

    if (perCode.length === 0) {
      setRunning(false);
      setError("日足データを取得できませんでした。認証情報・銘柄コード・プランを確認してください。");
      return;
    }

    const r = runEngineBacktest(perCode, strategy, fromStr, toStr);
    saveBacktestSummary(r);
    const cap = Number(capital) > 0 ? Number(capital) : 1000000;
    const pnls = r.tradeReturns.map((ret) => (cap * ret) / 100);
    setMc(pnls.length ? runMonteCarlo({ pnls, capital: cap, runs: 1000 }) : null);
    setResult(r);
    setRunning(false);
    if (failed > 0) setError(`${failed} 銘柄の取得に失敗しました（部分結果を表示）。`);
  };

  return (
    <div className="space-y-6">
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">⧗⧗ 価格系列バックテスト（実データ / J-Quants）</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="hud-label">戦略</span>
            <select className="hud-input mt-1 w-44" value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="hud-label">期間</span>
            <select className="hud-input mt-1 w-28" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)}>
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="hud-label">キャッシュ期限</span>
            <select className="hud-input mt-1 w-28" value={policy} onChange={(e) => setPolicy(e.target.value as CachePolicy)}>
              <option value="30">30日</option>
              <option value="90">90日</option>
              <option value="none">無期限</option>
            </select>
          </label>
          <label className="block">
            <span className="hud-label">基準資産</span>
            <input className="hud-input mt-1 w-32" type="number" step="10000" value={capital} onChange={(e) => setCapital(e.target.value)} />
          </label>
          <button className="hud-btn" onClick={run} disabled={running}>
            {running ? (progress ? `取得中 ${progress.done}/${progress.total}` : "実行中…") : "バックテスト実行"}
          </button>
        </div>
        <p className="text-arcdim text-xs mt-2">
          戦略のファンダ条件で銘柄を選定（現在値・最大{MAX_UNIVERSE}銘柄）→ 日足を取得（キャッシュ優先）→ RSI/利確/損切りで仮想売買します。
        </p>
        {error && <p className="text-caution text-sm mt-2 font-mono">{error}</p>}
      </section>

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <Metric label="CAGR" value={`${result.cagr.toFixed(1)}%`} tone={result.cagr >= 0 ? "profit" : "danger"} />
            <Metric label="年率リターン" value={`${result.annualReturnPct.toFixed(1)}%`} tone={result.annualReturnPct >= 0 ? "profit" : "danger"} />
            <Metric label="累積リターン" value={`${result.totalReturnPct.toFixed(1)}%`} tone={result.totalReturnPct >= 0 ? "profit" : "danger"} />
            <Metric label="市場超過(α)" value={`${result.alphaPct >= 0 ? "+" : ""}${result.alphaPct.toFixed(1)}%`} tone={result.alphaPct >= 0 ? "profit" : "danger"} />
            <Metric label="Sharpe" value={result.sharpe.toFixed(2)} tone={result.sharpe >= 1 ? "profit" : "neutral"} />
            <Metric label="Sortino" value={result.sortino.toFixed(2)} tone={result.sortino >= 1 ? "profit" : "neutral"} />
            <Metric label="最大DD" value={`${result.maxDrawdownPct.toFixed(1)}%`} tone="danger" />
            <Metric label="PF" value={result.profitFactor != null ? result.profitFactor.toFixed(2) : "—"} tone={result.profitFactor != null && result.profitFactor >= 1 ? "profit" : "danger"} />
            <Metric label="勝率" value={`${(result.winRate * 100).toFixed(0)}%`} />
            <Metric label="Recovery Factor" value={result.recoveryFactor != null ? result.recoveryFactor.toFixed(2) : "—"} tone={result.recoveryFactor != null && result.recoveryFactor >= 1 ? "profit" : "neutral"} />
            <Metric label="取引回数" value={`${result.tradeCount}`} />
            <Metric label="ユニバース" value={`${result.universe}銘柄`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <section className="hud-panel p-4">
              <h2 className="hud-label mb-3">Equity Curve（複利成長）</h2>
              <Spark values={result.equity.map((e) => e.equity)} color="#6fe3ff" />
            </section>
            <section className="hud-panel p-4">
              <h2 className="hud-label mb-3">年別リターン</h2>
              {result.yearly.length === 0 ? (
                <p className="text-arcdim text-sm">データなし</p>
              ) : (
                <ul className="space-y-1.5">
                  {result.yearly.map((y) => (
                    <li key={y.year} className="flex justify-between text-sm font-mono">
                      <span className="text-arcdim">{y.year}</span>
                      <span className={y.returnPct >= 0 ? "text-profit" : "text-danger"}>{y.returnPct >= 0 ? "+" : ""}{y.returnPct.toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="hud-panel p-4 border-arc/40 shadow-arc">
            <h2 className="hud-label mb-3">◎ JARVIS 検証所見</h2>
            <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
              {result.comments.map((c, i) => <li key={i}>・{c}</li>)}
            </ul>
          </section>

          {mc && (
            <section className="hud-panel p-4">
              <h2 className="hud-label mb-3">🎲 MonteCarlo 母集団接続（1000回）</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Metric label="期待リターン" value={`${mc.expectedReturnPct >= 0 ? "+" : ""}${mc.expectedReturnPct.toFixed(1)}%`} tone={mc.expectedReturnPct >= 0 ? "profit" : "danger"} />
                <Metric label="破産確率" value={`${(mc.ruinProb * 100).toFixed(1)}%`} tone={mc.ruinProb > 0.05 ? "danger" : "neutral"} />
                <Metric label="DD95" value={`${mc.dd95.toFixed(1)}%`} tone="danger" />
                <Metric label="95%区間" value={`${mc.ci5Pct.toFixed(0)}〜${mc.ci95Pct.toFixed(0)}%`} />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
