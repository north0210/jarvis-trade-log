"use client";

import { useEffect, useMemo, useState } from "react";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded, getStrategyRepository } from "@/lib/storage/strategyRepository";
import { getCashPosition, analyzePortfolio } from "@/lib/analysis/portfolio";
import {
  generateImprovements,
  improverComments,
  getDismissedImprovements,
  dismissImprovement,
  type Improvement,
  type Confidence,
} from "@/lib/strategy/rule-improver";
import type { Holding, Stock, Strategy, Trade } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const tradeRepo = getTradeRepository();
const strategyRepo = getStrategyRepository();

const confMeta: Record<Confidence, { label: string; cls: string }> = {
  high: { label: "高", cls: "text-profit" },
  medium: { label: "中", cls: "text-caution" },
  low: { label: "低", cls: "text-arcdim" },
};

export default function RuleImproverPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [s, h, t, strats] = await Promise.all([
      stockRepo.list(),
      holdingRepo.list(),
      tradeRepo.list(),
      ensureSeeded(),
    ]);
    setStocks(s);
    setHoldings(h);
    setTrades(t);
    setStrategies(strats);
    setDismissed(getDismissedImprovements());
  };
  useEffect(() => {
    load();
  }, []);

  const improvements = useMemo(() => {
    const port = analyzePortfolio(stocks, holdings, getCashPosition());
    const all = generateImprovements(
      trades,
      strategies,
      { maxRatio: port.maxPosition?.ratio ?? 0, maxName: port.maxPosition?.name ?? null },
      // createdAt は表示用。id は決定的なので却下判定に影響しない。
      "—"
    );
    return all.filter((i) => !dismissed.includes(i.id));
  }, [stocks, holdings, trades, strategies, dismissed]);

  const comments = useMemo(() => improverComments(improvements, trades), [improvements, trades]);
  const highCount = improvements.filter((i) => i.confidence === "high").length;

  const apply = async (imp: Improvement) => {
    const strategy = strategies.find((s) => s.id === imp.strategyId);
    if (!strategy) return;
    if (!confirm(`「${strategy.name}」に提案を適用します。\n${imp.currentRule} → ${imp.suggestedRule}\nよろしいですか？`)) return;
    setBusy(true);
    try {
      const { id, createdAt, ...rest } = strategy;
      void id;
      void createdAt;
      await strategyRepo.update(strategy.id, { ...rest, ...imp.patch });
      dismissImprovement(imp.id);
    } catch (e) {
      setBusy(false);
      alert(`適用に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setBusy(false);
    load();
  };

  const reject = (imp: Improvement) => {
    if (!confirm("この提案を却下（非表示）しますか？")) return;
    dismissImprovement(imp.id);
    setDismissed(getDismissedImprovements());
  };

  return (
    <div className="space-y-6">
      <section className="hud-panel p-4">
        <h2 className="hud-label">⚙ 売買ルール自動改善 — Rule Improver</h2>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="hud-panel p-4"><p className="hud-label">改善提案件数</p><p className="font-mono text-3xl mt-2 text-arc">{improvements.length}</p></div>
        <div className="hud-panel p-4"><p className="hud-label">高信頼度提案</p><p className="font-mono text-3xl mt-2 text-profit">{highCount}</p></div>
        <div className="hud-panel p-4"><p className="hud-label">対象戦略数</p><p className="font-mono text-3xl mt-2 text-arc">{new Set(improvements.map((i) => i.strategyId)).size}</p></div>
      </div>

      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS 改善コメント</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {comments.map((c, i) => <li key={i}>・{c}</li>)}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="hud-label">改善提案一覧 ({improvements.length})</h2>
        {improvements.length === 0 ? (
          <p className="text-arcdim text-sm">現在、有効な改善提案はありません。規律は良好です、ボス。</p>
        ) : (
          improvements.map((imp) => (
            <article key={imp.id} className="hud-panel p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-display text-arc">{imp.title}</h3>
                <span className="hud-label">
                  対象: <span className="text-arc">{imp.strategyName}</span> / 信頼度:{" "}
                  <span className={confMeta[imp.confidence].cls}>{confMeta[imp.confidence].label}</span>
                </span>
              </div>
              <p className="text-sm text-[#cfeaff] mb-3">{imp.reason}</p>
              <div className="grid sm:grid-cols-2 gap-3 text-sm font-mono">
                <div className="rounded border border-line px-3 py-2">
                  <p className="hud-label">現在ルール</p>
                  <p className="text-arcdim mt-1">{imp.currentRule}</p>
                </div>
                <div className="rounded border border-arc/40 bg-arc/5 px-3 py-2">
                  <p className="hud-label">提案ルール</p>
                  <p className="text-arc mt-1">{imp.suggestedRule}</p>
                </div>
              </div>
              <div className="mt-3 text-xs font-mono grid sm:grid-cols-2 gap-x-6 gap-y-1">
                <p><span className="hud-label">期待効果:</span> <span className="text-profit">{imp.expectedEffect}</span></p>
                <p><span className="hud-label">リスク:</span> <span className="text-caution">{imp.risk}</span></p>
              </div>
              <div className="mt-4 flex gap-3">
                <button className="hud-btn" onClick={() => apply(imp)} disabled={busy}>適用する</button>
                <button className="hud-btn-danger px-4 py-1.5 text-sm" onClick={() => reject(imp)}>却下</button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
