"use client";

/**
 * Phase 55 (v1.3): 銘柄別バックテスト（軽量版）。
 * 既存の J-Quants 価格系列（キャッシュ優先）＋BTエンジンを単一銘柄で再利用。
 * データ不足時は安全にfallback。結果は Advisor 反映準備として保存。投資助言ではない。
 */
import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import Link from "next/link";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import { getProviderMode, getJQuantsCredentials } from "@/lib/pricing/settings";
import { fetchJQuantsSeries } from "@/lib/pricing/jquantsClient";
import { runStockBacktest, saveStockBtResult, listStockBtResults, removeStockBtResult, type StockBtResult } from "@/lib/advisor/stock-backtest";
import type { Stock, Strategy } from "@/lib/types";

const stockRepo = getStockRepository();
const PERIODS = [
  { key: "1", label: "1年", years: 1 },
  { key: "3", label: "3年", years: 3 },
  { key: "5", label: "5年", years: 5 },
];
const pad = (n: number) => String(n).padStart(2, "0");
const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

export default function StockBacktestPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [stockId, setStockId] = useState("");
  const [stratId, setStratId] = useState("");
  const [periodKey, setPeriodKey] = useState("3");
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [results, setResults] = useState<StockBtResult[]>([]);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    (async () => {
      const [s, strats] = await Promise.all([stockRepo.list(), ensureSeeded()]);
      setStocks(s);
      setStrategies(strats);
      if (s[0]) setStockId(s[0].id);
      if (strats[0]) setStratId(strats[0].id);
    })();
    setResults(listStockBtResults());
  }, []);

  const run = async () => {
    const stock = stocks.find((x) => x.id === stockId);
    const strat = strategies.find((x) => x.id === stratId);
    if (!stock || !strat) {
      setMsg({ tone: "err", text: "銘柄と戦略を選択してください。" });
      return;
    }
    if (getProviderMode() !== "jquants-ready") {
      setMsg({ tone: "err", text: "価格系列の取得には J-Quants モードが必要です（設定 → 価格プロバイダ）。キャッシュがあれば利用します。" });
    }
    setRunning(true);
    setMsg({ tone: "ok", text: "価格系列を取得中です、ボス…" });
    const years = PERIODS.find((p) => p.key === periodKey)?.years ?? 3;
    const to = new Date();
    const from = new Date(to.getFullYear() - years, to.getMonth(), to.getDate());
    const res = await fetchJQuantsSeries(stock.code, fmtDate(from), fmtDate(to), getJQuantsCredentials());
    if (!res.ok || res.series.length < 20) {
      setRunning(false);
      setMsg({ tone: "err", text: "価格系列が不足しています。価格更新後に再試行してください（安全に中断しました）。" });
      return;
    }
    const r = runStockBacktest(stock.code, stock.name, strat, res.series, fmtDate(from), fmtDate(to), new Date().toISOString());
    setRunning(false);
    if (!r) {
      setMsg({ tone: "err", text: "データ不足のためバックテストを実行できませんでした。" });
      return;
    }
    saveStockBtResult(r);
    setResults(listStockBtResults());
    setMsg({ tone: "ok", text: `${stock.name} × ${strat.name} のバックテストが完了しました（取引 ${r.tradeCount} 件）。` });
  };

  const doRemove = (code: string, sid: string) => { removeStockBtResult(code, sid); setResults(listStockBtResults()); };

  // 全銘柄自動BT：選択戦略で全銘柄を順次バックテスト（キャッシュ優先・fallback安全）
  const runAll = async () => {
    const strat = strategies.find((x) => x.id === stratId);
    if (!strat) { setMsg({ tone: "err", text: "戦略を選択してください。" }); return; }
    const years = PERIODS.find((p) => p.key === periodKey)?.years ?? 3;
    const to = new Date();
    const from = new Date(to.getFullYear() - years, to.getMonth(), to.getDate());
    const creds = getJQuantsCredentials();
    setRunning(true);
    setBatch({ done: 0, total: stocks.length });
    setMsg({ tone: "ok", text: "全銘柄BTを実行中です、ボス…" });
    let ok = 0;
    let skip = 0;
    for (let i = 0; i < stocks.length; i++) {
      const st = stocks[i];
      try {
        const res = await fetchJQuantsSeries(st.code, fmtDate(from), fmtDate(to), creds);
        if (res.ok && res.series.length >= 20) {
          const r = runStockBacktest(st.code, st.name, strat, res.series, fmtDate(from), fmtDate(to), new Date().toISOString());
          if (r) { saveStockBtResult(r); ok++; } else skip++;
        } else skip++;
      } catch {
        skip++;
      }
      setBatch({ done: i + 1, total: stocks.length });
    }
    setResults(listStockBtResults());
    setRunning(false);
    setBatch(null);
    setMsg({ tone: ok > 0 ? "ok" : "err", text: `全銘柄BT完了: 成功 ${ok} / スキップ ${skip}（データ不足はAdvisorで市場平均にフォールバック）。` });
  };

  const latest = useMemo(() => results[0] ?? null, [results]);

  return (
    <div className="space-y-6">
      <PageIntro title="📈 銘柄別バックテスト" description="銘柄×戦略の過去成績（PF/勝率/最大DD/CAGR）を簡易検証します。判断補助であり投資助言ではありません。" helpKey="pf" />

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">条件</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="hud-label">銘柄</span>
            <select className="hud-input mt-1 w-52" value={stockId} onChange={(e) => setStockId(e.target.value)}>
              {stocks.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="hud-label">戦略</span>
            <select className="hud-input mt-1 w-52" value={stratId} onChange={(e) => setStratId(e.target.value)}>
              {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="hud-label">期間</span>
            <select className="hud-input mt-1 w-24" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)}>
              {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <button className="hud-btn" onClick={run} disabled={running}>{running ? "実行中…" : "バックテスト実行"}</button>
          <button className="hud-btn" onClick={runAll} disabled={running}>全銘柄BT（自動）</button>
          {batch && <span className="hud-label">{batch.done}/{batch.total}</span>}
        </div>
        {msg && <p className={`text-sm font-mono mt-3 ${msg.tone === "ok" ? "text-profit" : "text-danger"}`}>{msg.text}</p>}
        <p className="text-xs text-arcdim mt-2">※ エントリー: 戦略のファンダ/テクニカル条件成立。イグジット: 損切り/利確/期間末（エンジン準拠）。エントリー時点でのファンダは現在値近似です。</p>
      </section>

      {latest && (
        <section className="hud-panel p-4 border-arc/40 shadow-arc">
          <h2 className="hud-label mb-3">最新結果: {latest.name} × {latest.strategyName}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Metric label="取引回数" value={`${latest.tradeCount}`} />
            <Metric label="勝率" value={pct(latest.winRate * 100)} />
            <Metric label={<HelpTooltip termKey="pf" label="PF" />} value={latest.profitFactor != null ? latest.profitFactor.toFixed(2) : "—"} tone={latest.profitFactor != null && latest.profitFactor >= 1 ? "profit" : "danger"} />
            <Metric label={<HelpTooltip termKey="dd" label="最大DD" />} value={pct(latest.maxDrawdownPct)} tone="danger" />
            <Metric label={<HelpTooltip termKey="cagr" label="CAGR" />} value={pct(latest.cagr)} tone={latest.cagr >= 0 ? "profit" : "danger"} />
            <Metric label="平均保有日数" value={latest.avgHoldingDays != null ? `${latest.avgHoldingDays.toFixed(0)}日` : "—"} />
          </div>
          <p className="text-xs text-arcdim mt-2">Advisor 反映準備: 本結果は保存され、将来の銘柄別シグナル供給（接続口）に利用予定です。</p>
        </section>
      )}

      <section className="hud-panel p-4 overflow-x-auto">
        <h2 className="hud-label mb-3">保存済み結果</h2>
        {results.length === 0 ? (
          <p className="text-arcdim text-sm">まだ結果がありません。銘柄×戦略を選んで実行してください。</p>
        ) : (
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {["銘柄", "戦略", "期間", "取引", "勝率", <HelpTooltip key="pf" termKey="pf" label="PF" />, <HelpTooltip key="dd" termKey="dd" label="最大DD" />, <HelpTooltip key="cagr" termKey="cagr" label="CAGR" />, "平均保有", ""].map((h, i) => <th key={i} className="pb-2 pr-3 font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={`${r.code}-${r.strategyId}`} className="border-t border-line/60">
                  <td className="py-1 pr-3 text-arc">{r.code} {r.name}</td>
                  <td className="py-1 pr-3">{r.strategyName}</td>
                  <td className="py-1 pr-3 text-arcdim">{r.from}〜{r.to}</td>
                  <td className="py-1 pr-3">{r.tradeCount}</td>
                  <td className="py-1 pr-3">{pct(r.winRate * 100)}</td>
                  <td className={`py-1 pr-3 ${r.profitFactor != null && r.profitFactor >= 1 ? "text-profit" : "text-danger"}`}>{r.profitFactor != null ? r.profitFactor.toFixed(2) : "—"}</td>
                  <td className="py-1 pr-3 text-caution">{pct(r.maxDrawdownPct)}</td>
                  <td className={`py-1 pr-3 ${r.cagr >= 0 ? "text-profit" : "text-danger"}`}>{pct(r.cagr)}</td>
                  <td className="py-1 pr-3">{r.avgHoldingDays != null ? `${r.avgHoldingDays.toFixed(0)}日` : "—"}</td>
                  <td className="py-1 pr-3"><button className="hud-btn text-xs px-2 py-0.5" onClick={() => doRemove(r.code, r.strategyId)}>削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-arcdim mt-2">
          関連: <Link href="/advisor" className="text-arc hover:underline">JARVIS Advisor</Link> ／ <Link href="/strategy-backtest" className="text-arc hover:underline">一括バックテスト</Link>
        </p>
      </section>
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: React.ReactNode; value: string; tone?: "neutral" | "profit" | "danger" }) {
  const color = tone === "profit" ? "text-profit" : tone === "danger" ? "text-danger" : "text-arc";
  return (
    <div className="hud-panel p-3">
      <p className="hud-label">{label}</p>
      <p className={`font-mono text-xl mt-1 ${color}`}>{value}</p>
    </div>
  );
}
