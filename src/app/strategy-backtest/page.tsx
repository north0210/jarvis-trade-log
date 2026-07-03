"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import { getProviderMode, getJQuantsCredentials } from "@/lib/pricing/settings";
import { fetchJQuantsSeries } from "@/lib/pricing/jquantsClient";
import { getCachePolicy, setCachePolicy, type CachePolicy, type SeriesPoint } from "@/lib/analytics/priceCache";
import { saveBacktestSummary } from "@/lib/analytics/backtest-engine";
import { runStrategyBatch, collectBatchCodes, stripVolumeConditions, type StrategyBatchResult } from "@/lib/backtest/strategy-batch";
import { buildRankingSnapshot, getStrategyRankingSnapshotRepository } from "@/lib/backtest/ranking-snapshot";
import Link from "next/link";
import type { Stock, Strategy } from "@/lib/types";

const rankingRepo = getStrategyRankingSnapshotRepository();

const stockRepo = getStockRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const PERIODS = [
  { key: "1", label: "1年", years: 1 },
  { key: "3", label: "3年", years: 3 },
  { key: "5", label: "5年", years: 5 },
  { key: "10", label: "10年", years: 10 },
];

type SortKey = "cagr" | "profitFactor" | "maxDrawdown" | "winRate" | "expectedValue" | "sharpe" | "sortino";
const SORTS: { key: SortKey; label: string; higherBetter: boolean }[] = [
  { key: "cagr", label: "CAGR", higherBetter: true },
  { key: "profitFactor", label: "PF", higherBetter: true },
  { key: "maxDrawdown", label: "最大DD", higherBetter: false },
  { key: "winRate", label: "勝率", higherBetter: true },
  { key: "expectedValue", label: "期待値", higherBetter: true },
  { key: "sharpe", label: "Sharpe", higherBetter: true },
  { key: "sortino", label: "Sortino", higherBetter: true },
];

export default function StrategyBacktestPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selStrat, setSelStrat] = useState<Set<string>>(new Set());
  const [selStock, setSelStock] = useState<Set<string>>(new Set());
  const [periodKey, setPeriodKey] = useState("3");
  const [policy, setPolicy] = useState<CachePolicy>("90");
  const [capital, setCapital] = useState("1000000");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchWith, setBatchWith] = useState<StrategyBatchResult[]>([]);
  const [batchNo, setBatchNo] = useState<StrategyBatchResult[]>([]);
  const [useVolume, setUseVolume] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("cagr");
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [savedStockCount, setSavedStockCount] = useState(0);

  const results = useMemo(() => (useVolume ? batchWith : batchNo), [useVolume, batchWith, batchNo]);

  useEffect(() => {
    (async () => {
      const [s, strats] = await Promise.all([stockRepo.list(), ensureSeeded()]);
      setStocks(s);
      setStrategies(strats);
      setSelStrat(new Set(strats.map((x) => x.id)));
      setSelStock(new Set(s.map((x) => x.id)));
      setPolicy(getCachePolicy());
    })();
  }, []);

  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

  const run = async () => {
    if (getProviderMode() !== "jquants-ready") {
      setError("J-Quantsモードに切り替えてください（設定 → 価格プロバイダ）。");
      return;
    }
    const targetStrats = strategies.filter((s) => selStrat.has(s.id));
    const targetStocks = stocks.filter((s) => selStock.has(s.id));
    if (targetStrats.length === 0 || targetStocks.length === 0) {
      setError("対象戦略・対象銘柄を1件以上選択してください。");
      return;
    }
    setError(null);
    setBatchWith([]);
    setBatchNo([]);
    setCachePolicy(policy);

    const years = PERIODS.find((p) => p.key === periodKey)?.years ?? 3;
    const to = new Date();
    const from = new Date(to.getFullYear() - years, to.getMonth(), to.getDate());
    const fromStr = fmtDate(from);
    const toStr = fmtDate(to);

    const codes = collectBatchCodes(targetStrats, targetStocks);
    if (codes.length === 0) {
      setError("対象戦略のファンダ条件を満たす銘柄がありません。");
      return;
    }

    setRunning(true);
    setProgress({ done: 0, total: codes.length });
    const creds = getJQuantsCredentials();
    const seriesByCode = new Map<string, SeriesPoint[]>();
    for (let i = 0; i < codes.length; i++) {
      const res = await fetchJQuantsSeries(codes[i], fromStr, toStr, creds);
      if (res.ok && res.series.length > 0) seriesByCode.set(codes[i], res.series);
      setProgress({ done: i + 1, total: codes.length });
    }
    if (seriesByCode.size === 0) {
      setRunning(false);
      setError("日足データを取得できませんでした。認証情報・銘柄コード・プランを確認してください。");
      return;
    }

    const cap = Number(capital) > 0 ? Number(capital) : 1000000;
    const withVol = runStrategyBatch(targetStrats, targetStocks, seriesByCode, fromStr, toStr, cap);
    const noVol = runStrategyBatch(targetStrats.map(stripVolumeConditions), targetStocks, seriesByCode, fromStr, toStr, cap);
    (useVolume ? withVol : noVol).forEach((b) => saveBacktestSummary(b.engine)); // Dashboard 用サマリーへ保存
    setBatchWith(withVol);
    setBatchNo(noVol);
    setSavedStockCount(targetStocks.length);
    setRunning(false);
  };

  // 出来高条件 あり/なし 比較（戦略IDで対応付け）
  const volComparison = useMemo(
    () =>
      batchWith
        .map((w) => {
          const n = batchNo.find((x) => x.strategyId === w.strategyId);
          if (!n) return null;
          return { name: w.strategyName, with: w, no: n };
        })
        .filter((x): x is { name: string; with: StrategyBatchResult; no: StrategyBatchResult } => !!x),
    [batchWith, batchNo]
  );

  const volComments = useMemo(() => {
    if (volComparison.length === 0) return [];
    const out: string[] = [];
    const affected = volComparison.filter((c) => c.with.tradeCount !== c.no.tradeCount);
    if (affected.length === 0) {
      out.push("出来高フィルターの効果は限定的です。現在の戦略では価格・Score条件の影響が大きいようです。");
      return out;
    }
    for (const c of affected) {
      const dTrades = c.with.tradeCount - c.no.tradeCount;
      const dPf = (c.with.profitFactor ?? 0) - (c.no.profitFactor ?? 0);
      const dDd = c.with.maxDrawdown - c.no.maxDrawdown;
      if (dTrades < 0 && dPf > 0)
        out.push(`${c.name}: 出来高条件で取引回数は ${dTrades} 件減少しましたが、PFは ${dPf >= 0 ? "+" : ""}${dPf.toFixed(2)} 改善しています。`);
      else if (dDd < -1)
        out.push(`${c.name}: 出来高条件で最大DDが ${dDd.toFixed(1)}pt 低下しています。`);
      else
        out.push(`${c.name}: 出来高条件で取引 ${dTrades} 件 / PF ${dPf >= 0 ? "+" : ""}${dPf.toFixed(2)} / DD ${dDd >= 0 ? "+" : ""}${dDd.toFixed(1)}pt。`);
    }
    return out;
  }, [volComparison]);

  const saveRanking = async () => {
    if (results.length === 0) return;
    const label = PERIODS.find((p) => p.key === periodKey)?.label ?? `${periodKey}年`;
    await rankingRepo.create(
      buildRankingSnapshot(results, {
        date: new Date().toISOString().slice(0, 10),
        period: label,
        initialCapital: Number(capital) > 0 ? Number(capital) : 1000000,
        targetStockCount: savedStockCount,
      })
    );
    setCopyMsg("ランキング結果を保存しました。");
  };

  const sorted = useMemo(() => {
    const cfg = SORTS.find((s) => s.key === sortKey) ?? SORTS[0];
    return results.slice().sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return cfg.higherBetter ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  }, [results, sortKey]);

  const copyCsv = async () => {
    const header = ["rank", "strategy", "trades", "winRate", "PF", "CAGR", "maxDD", "expVal", "sharpe", "sortino", "finalEquity"].join("\t");
    const lines = sorted.map((r) =>
      [r.rank, r.strategyName, r.tradeCount, (r.winRate * 100).toFixed(0) + "%", r.profitFactor != null ? r.profitFactor.toFixed(2) : "-", r.cagr.toFixed(1), r.maxDrawdown.toFixed(1), r.expectedValue.toFixed(2), r.sharpe.toFixed(2), r.sortino.toFixed(2), Math.round(r.finalEquity)].join("\t")
    );
    try {
      await navigator.clipboard.writeText([header, ...lines].join("\n"));
      setCopyMsg("クリップボードにコピーしました（TSV）。");
    } catch {
      setCopyMsg("コピーに失敗しました。");
    }
  };

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFn(next);
  };

  return (
    <div className="space-y-6">
      <PageIntro title="⚙ 一括バックテスト" description="複数戦略の過去成績をまとめて比較します。" helpKey="pf" />
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">⧗⚔ 戦略バックテスト一括実行</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="hud-label">期間</span>
            <select className="hud-input mt-1 w-28" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)}>
              {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
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
            <span className="hud-label">初期資金</span>
            <input className="hud-input mt-1 w-32" type="number" step="10000" value={capital} onChange={(e) => setCapital(e.target.value)} />
          </label>
          <label className="block">
            <span className="hud-label"><HelpTooltip termKey="relativevolume" label="出来高条件" /></span>
            <button className={`hud-btn mt-1 ${useVolume ? "" : "opacity-60"}`} onClick={() => setUseVolume((v) => !v)}>
              {useVolume ? "適用 ON" : "OFF"}
            </button>
          </label>
          <button className="hud-btn" onClick={run} disabled={running}>
            {running ? (progress ? `取得中 ${progress.done}/${progress.total}` : "実行中…") : "一括バックテスト実行"}
          </button>
        </div>

        <div className="mt-3 grid md:grid-cols-2 gap-3">
          <div>
            <p className="hud-label mb-1">対象戦略（{selStrat.size}/{strategies.length}）</p>
            <div className="flex flex-wrap gap-2">
              {strategies.map((s) => (
                <button key={s.id} onClick={() => toggle(selStrat, setSelStrat, s.id)}
                  className={`px-2 py-0.5 rounded border text-xs font-mono ${selStrat.has(s.id) ? "border-arc/60 text-arc bg-arc/10" : "border-line text-arcdim"}`}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="hud-label mb-1">対象銘柄（{selStock.size}/{stocks.length}）</p>
            <div className="flex flex-wrap gap-2 max-h-24 overflow-auto">
              {stocks.map((s) => (
                <button key={s.id} onClick={() => toggle(selStock, setSelStock, s.id)}
                  className={`px-2 py-0.5 rounded border text-xs font-mono ${selStock.has(s.id) ? "border-arc/60 text-arc bg-arc/10" : "border-line text-arcdim"}`}>
                  {s.code}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-arcdim text-xs mt-2">各戦略のファンダ条件で対象銘柄から自動選別（最大12銘柄）→ 日足取得（キャッシュ優先）→ 仮想売買。</p>
        {error && <p className="text-caution text-sm mt-2 font-mono">{error}</p>}
      </section>

      {results.length > 0 && (
        <section className="hud-panel p-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
            <h2 className="hud-label">戦略ランキング（{results.length}）</h2>
            <div className="flex items-center gap-2">
              <span className="hud-label">ソート</span>
              <select className="hud-input w-32" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <button className="hud-btn text-xs px-3 py-1" onClick={copyCsv}>CSVコピー</button>
              <button className="hud-btn text-xs px-3 py-1" onClick={saveRanking}>ランキング結果を保存</button>
              <Link href="/strategy-rank-history" className="hud-btn text-xs px-3 py-1">履歴 →</Link>
            </div>
          </div>
          {copyMsg && <p className="text-profit text-xs font-mono mb-2">{copyMsg}</p>}
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {([
                  { h: "#" }, { h: "戦略" }, { h: "取引" }, { h: "勝率" }, { h: "PF", t: "pf" }, { h: "CAGR", t: "cagr" }, { h: "最大DD", t: "dd" }, { h: "期待値" }, { h: "Sharpe", t: "sharpe" }, { h: "Sortino", t: "sortino" }, { h: "最終資産" },
                ] as { h: string; t?: string }[]).map((c) => (
                  <th key={c.h} className="pb-2 pr-3 font-normal">{c.t ? <HelpTooltip termKey={c.t} label={c.h} /> : c.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.strategyId} className="border-t border-line/60">
                  <td className="py-2 pr-3 text-arc">{r.rank}</td>
                  <td className="py-2 pr-3">{r.strategyName}</td>
                  <td className="py-2 pr-3">{r.tradeCount}</td>
                  <td className="py-2 pr-3">{(r.winRate * 100).toFixed(0)}%</td>
                  <td className={`py-2 pr-3 ${r.profitFactor != null && r.profitFactor >= 1 ? "text-arc" : "text-danger"}`}>{r.profitFactor != null ? r.profitFactor.toFixed(2) : "—"}</td>
                  <td className={`py-2 pr-3 ${r.cagr >= 0 ? "text-profit" : "text-danger"}`}>{r.cagr.toFixed(1)}%</td>
                  <td className="py-2 pr-3 text-caution">{r.maxDrawdown.toFixed(1)}%</td>
                  <td className={`py-2 pr-3 ${r.expectedValue >= 0 ? "text-profit" : "text-danger"}`}>{r.expectedValue.toFixed(2)}%</td>
                  <td className="py-2 pr-3">{r.sharpe.toFixed(2)}</td>
                  <td className="py-2 pr-3">{r.sortino.toFixed(2)}</td>
                  <td className="py-2 pr-3">¥{fmt(r.finalEquity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {results.length > 0 && (
        <section className="hud-panel p-4 border-arc/40 shadow-arc">
          <h2 className="hud-label mb-3">◎ JARVIS 戦略比較所見</h2>
          <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
            {results.slice().sort((a, b) => a.rank - b.rank).map((r) => (
              <li key={r.strategyId}>・<span className="text-[#cfeaff]">{r.strategyName}</span>：{r.jarvisComment}</li>
            ))}
          </ul>
        </section>
      )}

      {volComparison.length > 0 && (
        <section className="hud-panel p-4 overflow-x-auto">
          <h2 className="hud-label mb-3">出来高フィルター効果（あり / なし）</h2>
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {([
                  { h: "戦略" }, { h: "取引(なし→あり)" }, { h: "勝率" }, { h: "PF", t: "pf" }, { h: "最大DD", t: "dd" },
                ] as { h: string; t?: string }[]).map((c) => <th key={c.h} className="pb-2 pr-3 font-normal">{c.t ? <HelpTooltip termKey={c.t} label={c.h} /> : c.h}</th>)}
              </tr>
            </thead>
            <tbody>
              {volComparison.map((c) => {
                const dTrades = c.with.tradeCount - c.no.tradeCount;
                const dPf = (c.with.profitFactor ?? 0) - (c.no.profitFactor ?? 0);
                const dDd = c.with.maxDrawdown - c.no.maxDrawdown;
                return (
                  <tr key={c.with.strategyId} className="border-t border-line/60">
                    <td className="py-2 pr-3 text-arc">{c.name}</td>
                    <td className="py-2 pr-3">{c.no.tradeCount} → {c.with.tradeCount} <span className={dTrades < 0 ? "text-caution" : "text-arcdim"}>({dTrades >= 0 ? "+" : ""}{dTrades})</span></td>
                    <td className="py-2 pr-3">{(c.no.winRate * 100).toFixed(0)}% → {(c.with.winRate * 100).toFixed(0)}%</td>
                    <td className="py-2 pr-3">{c.no.profitFactor != null ? c.no.profitFactor.toFixed(2) : "—"} → <span className={dPf > 0 ? "text-arc" : dPf < 0 ? "text-danger" : ""}>{c.with.profitFactor != null ? c.with.profitFactor.toFixed(2) : "—"}</span></td>
                    <td className="py-2 pr-3">{c.no.maxDrawdown.toFixed(1)}% → <span className={dDd < 0 ? "text-arc" : dDd > 0 ? "text-danger" : ""}>{c.with.maxDrawdown.toFixed(1)}%</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="mt-3 space-y-1 text-sm font-mono text-arc leading-relaxed">
            {volComments.map((c, i) => <li key={i}>・{c}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
