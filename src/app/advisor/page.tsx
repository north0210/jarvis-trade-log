"use client";

/**
 * Phase 50 (v1.1): JARVIS Advisor 画面。
 * 既存の分析出力を統合し、売買候補を根拠つきで提示する判断補助（投資助言ではない）。
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageIntro from "@/components/PageIntro";
import Disclaimer from "@/components/Disclaimer";
import AdvisorView from "@/components/advisorView";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded, getPrimaryStrategyId } from "@/lib/storage/strategyRepository";
import { analyzePortfolio, getCashPosition } from "@/lib/analysis/portfolio";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { getDashboardRuns } from "@/lib/settings/performance";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateDiscipline } from "@/lib/discipline/rules";
import { evaluateRisk } from "@/lib/risk/risk-engine";
import { getBacktestSummaries } from "@/lib/analytics/backtest-engine";
import { getThresholds } from "@/lib/settings/thresholds";
import { analyzeFactors } from "@/lib/analytics/factor-analysis";
import { adaptiveScoreStock, getAdaptiveScoreSettings } from "@/lib/score/adaptive-score";
import { buildAdvisorReport } from "@/lib/advisor/advisor-engine";
import { getAdvisorWeights, detectPreset } from "@/lib/settings/advisor-settings";
import { getPerStockBacktestMap } from "@/lib/advisor/advisor-provider";
import {
  saveAdvisorSnapshot,
  listAdvisorSnapshots,
  removeAdvisorSnapshot,
  clearAdvisorSnapshots,
  diffSnapshots,
  type AdvisorSnapshot,
} from "@/lib/advisor/advisor-snapshot";
import { formatBackupTime } from "@/lib/storage/exportService";
import {
  buildAdvisorPrompt,
  listAiComments,
  saveAiComment,
  removeAiComment,
  AI_COMMENT_DISCLAIMER,
  type AiCommentRecord,
} from "@/lib/advisor/ai-comment";
import AiComment from "@/components/AiComment";
import type { Holding, Stock, Strategy, Trade } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const tradeRepo = getTradeRepository();

export default function AdvisorPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [cash, setCash] = useState(0);
  const [snapshots, setSnapshots] = useState<AdvisorSnapshot[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiComments, setAiComments] = useState<AiCommentRecord[]>([]);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [s, h, t, strats] = await Promise.all([stockRepo.list(), holdingRepo.list(), tradeRepo.list(), ensureSeeded()]);
      setStocks(s);
      setHoldings(h);
      setTrades(t);
      setStrategies(strats);
      setPrimaryId(getPrimaryStrategyId());
      setCash(getCashPosition());
    })();
    setSnapshots(listAdvisorSnapshots());
    setAiComments(listAiComments());
  }, []);

  const data = useMemo(() => {
    const portfolio = analyzePortfolio(stocks, holdings, cash);
    const th = getThresholds();
    const mc = trades.length ? runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: getDashboardRuns() }) : null;
    const backtest = runBacktest(trades);
    const discipline = evaluateDiscipline(stocks, holdings, trades, cash);
    const risk = mc ? evaluateRisk(portfolio, mc, backtest, discipline, trades, th) : null;
    const primaryStrategy = strategies.find((x) => x.id === primaryId) ?? strategies[0] ?? null;

    // Adaptive Score（Factor寄与を反映）を銘柄コード別に算出
    const factor = analyzeFactors(stocks, trades, strategies, risk, discipline);
    const weights = getAdaptiveScoreSettings().factorWeights;
    const adaptiveByCode: Record<string, number> = {};
    for (const s of stocks) adaptiveByCode[s.code] = adaptiveScoreStock(s, factor, weights).score;

    const bt = getBacktestSummaries();
    const btAvgCagr = bt.length ? bt.reduce((a, s) => a + s.cagr, 0) / bt.length : null;
    const report = buildAdvisorReport({
      stocks,
      holdings,
      portfolio,
      risk,
      discipline,
      btSummaries: bt,
      primaryStrategy,
      thresholds: th,
      adaptiveByCode,
      perStock: getPerStockBacktestMap(),
    });
    return { report, risk, portfolio, btAvgCagr };
  }, [stocks, holdings, trades, strategies, primaryId, cash]);
  const report = data.report;

  const prompt = useMemo(
    () => (data.report.hasData ? buildAdvisorPrompt({ advisor: data.report, risk: data.risk, portfolio: data.portfolio, btAvgCagr: data.btAvgCagr }) : ""),
    [data]
  );
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyMsg("プロンプトをコピーしました。");
    } catch {
      setCopyMsg("コピーできませんでした。手動で選択してください。");
    }
  };
  const doSaveAi = () => {
    if (!aiAnswer.trim()) return;
    saveAiComment(prompt, aiAnswer.trim(), new Date().toISOString());
    setAiAnswer("");
    setAiComments(listAiComments());
    setCopyMsg("AIコメントを保存しました。");
  };
  const doRemoveAi = (id: string) => { removeAiComment(id); setAiComments(listAiComments()); };

  const aiCtx = useMemo(() => {
    const c = data.report.counts;
    const facts: string[] = [
      `買い候補 ${c.strongBuy + c.buy}件（Strong ${c.strongBuy} / Buy ${c.buy}）、Watch ${c.watch}件`,
      `警戒 ${c.sellCandidate + c.danger}件（Danger ${c.danger} / 売却候補 ${c.sellCandidate}）、一部利確 ${c.partialTP} / 縮小 ${c.reduce}`,
    ];
    if (data.risk) facts.push(`Risk Grade ${data.risk.riskGrade} / 破産確率 ${(data.risk.ruinProbability * 100).toFixed(1)}%`);
    if (data.btAvgCagr != null) facts.push(`バックテスト平均CAGR ${data.btAvgCagr.toFixed(1)}%`);
    const top = [...data.report.byCategory.strongBuy, ...data.report.byCategory.buy].sort((a, b) => b.composite - a.composite)[0];
    if (top) facts.push(`最有力候補 ${top.name}（合成${top.composite}${top.btGrade ? ` / BT ${top.btGrade}` : ""}）`);
    return { title: "Advisor", facts };
  }, [data]);

  const doSave = () => {
    if (!report.hasData) return;
    const w = getAdvisorWeights();
    saveAdvisorSnapshot(report, detectPreset(w), w, new Date().toISOString());
    setSnapshots(listAdvisorSnapshots());
    setMsg("Advisor スナップショットを保存しました。");
  };
  const doRemove = (id: string) => { removeAdvisorSnapshot(id); setSnapshots(listAdvisorSnapshots()); };
  const doClear = () => { if (confirm("Advisor 履歴をすべて削除しますか？")) { clearAdvisorSnapshots(); setSnapshots(listAdvisorSnapshots()); setMsg("Advisor 履歴を削除しました。"); } };

  const diff = useMemo(() => (snapshots.length >= 2 ? diffSnapshots(snapshots[0], snapshots[1]) : null), [snapshots]);
  const maxSb = Math.max(1, ...snapshots.map((s) => s.counts.strongBuy + s.counts.buy));
  const maxDg = Math.max(1, ...snapshots.map((s) => s.counts.danger + s.counts.sellCandidate));
  const oldest = snapshots.length ? snapshots[snapshots.length - 1].date : null;

  return (
    <div className="space-y-6">
      <PageIntro title="🛰 JARVIS Advisor" description="分析を統合し、売買候補を根拠つきで提示します（判断補助・投資助言ではありません）。" helpKey="advisorscore" />
      <Disclaimer compact />

      <section className="hud-panel p-3 flex flex-wrap items-center gap-2">
        <button className="hud-btn text-xs px-3 py-1" onClick={doSave}>この判定を保存（スナップショット）</button>
        {snapshots.length > 0 && <button className="hud-btn-danger text-xs px-3 py-1" onClick={doClear}>履歴を全削除</button>}
        <span className="hud-label">保存件数 {snapshots.length}{oldest ? ` ／ 最古 ${oldest}` : ""}</span>
        {msg && <span className="text-profit text-xs font-mono">{msg}</span>}
      </section>

      <AdvisorView report={report} />

      {snapshots.length > 0 && (
        <section className="hud-panel p-4 overflow-x-auto">
          <h2 className="hud-label mb-3">📈 Advisor 推移（買い候補=Strong Buy+Buy / 警戒=Danger+Sell）</h2>
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {["日時", "プリセット", "買い候補", "警戒", "Strong", "Buy", "Watch", "Danger", ""].map((h, i) => <th key={i} className="pb-1 pr-3 font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => {
                const buyN = s.counts.strongBuy + s.counts.buy;
                const dgN = s.counts.danger + s.counts.sellCandidate;
                return (
                  <tr key={s.id} className="border-t border-line/60">
                    <td className="py-1 pr-3 text-arc">{formatBackupTime(s.createdAt) ?? s.date}</td>
                    <td className="py-1 pr-3 text-arcdim">{s.preset}</td>
                    <td className="py-1 pr-3">
                      <span className="inline-block align-middle h-2 bg-arc/60 rounded" style={{ width: `${(buyN / maxSb) * 60}px` }} /> <span className="text-arc">{buyN}</span>
                    </td>
                    <td className="py-1 pr-3">
                      <span className="inline-block align-middle h-2 bg-danger/60 rounded" style={{ width: `${(dgN / maxDg) * 60}px` }} /> <span className="text-danger">{dgN}</span>
                    </td>
                    <td className="py-1 pr-3 text-profit">{s.counts.strongBuy}</td>
                    <td className="py-1 pr-3">{s.counts.buy}</td>
                    <td className="py-1 pr-3">{s.counts.watch}</td>
                    <td className="py-1 pr-3 text-danger">{s.counts.danger}</td>
                    <td className="py-1 pr-3"><button className="hud-btn text-xs px-2 py-0.5" onClick={() => doRemove(s.id)}>削除</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {diff && (
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">🔀 前回判定との差分（最新 vs 直前）</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="hud-label text-profit mb-1">上昇銘柄（{diff.improved.length}）</p>
              {diff.improved.length === 0 ? <p className="text-arcdim text-sm">なし</p> : (
                <ul className="space-y-1 text-sm font-mono">
                  {diff.improved.slice(0, 8).map((r) => (
                    <li key={r.code}><span className="text-arc">{r.code} {r.name}</span> <span className="text-profit">+{r.delta}</span> <span className="text-arcdim">({r.fromComposite}→{r.toComposite})</span></li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="hud-label text-danger mb-1">悪化銘柄（{diff.worsened.length}）</p>
              {diff.worsened.length === 0 ? <p className="text-arcdim text-sm">なし</p> : (
                <ul className="space-y-1 text-sm font-mono">
                  {diff.worsened.slice(0, 8).map((r) => (
                    <li key={r.code}><span className="text-arc">{r.code} {r.name}</span> <span className="text-danger">{r.delta}</span> <span className="text-arcdim">({r.fromComposite}→{r.toComposite})</span></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      <AiComment ctx={aiCtx} />

      <section className="hud-panel p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="hud-label">🤖 外部AIコメント（貼り付け保存）</h2>
          <Link href="/settings" className="hud-btn text-xs px-3 py-1">AI設定 →</Link>
        </div>
        <p className="text-xs text-arcdim mb-3 font-mono">{AI_COMMENT_DISCLAIMER} 自動API接続は行いません（APIキー不要）。</p>
        <p className="hud-label mb-1">1. AI用プロンプト（コピーして外部AIへ）</p>
        <textarea className="hud-input w-full h-40 font-mono text-xs" readOnly value={prompt} />
        <div className="flex flex-wrap gap-2 mt-2">
          <button className="hud-btn text-xs px-3 py-1" onClick={copyPrompt} disabled={!prompt}>プロンプトをコピー</button>
          {copyMsg && <span className="text-profit text-xs font-mono self-center">{copyMsg}</span>}
        </div>
        <p className="hud-label mt-4 mb-1">2. AIの回答を貼り付けて保存</p>
        <textarea className="hud-input w-full h-32 font-mono text-xs" placeholder="外部AIの回答をここに貼り付け…" value={aiAnswer} onChange={(e) => setAiAnswer(e.target.value)} />
        <div className="mt-2"><button className="hud-btn" onClick={doSaveAi} disabled={!aiAnswer.trim()}>保存</button></div>

        {aiComments.length > 0 && (
          <div className="mt-4">
            <p className="hud-label mb-2">保存済みAIコメント（{aiComments.length}）</p>
            <ul className="space-y-2">
              {aiComments.map((c) => (
                <li key={c.id} className="rounded border border-line/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="hud-label">{formatBackupTime(c.createdAt) ?? "—"}</span>
                    <button className="hud-btn text-xs px-2 py-0.5" onClick={() => doRemoveAi(c.id)}>削除</button>
                  </div>
                  <p className="text-sm text-[#cfeaff] mt-1 font-mono whitespace-pre-wrap">{c.answer}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
