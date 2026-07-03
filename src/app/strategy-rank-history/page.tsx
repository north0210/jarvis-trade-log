"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import {
  getStrategyRankingSnapshotRepository,
  compareRanking,
} from "@/lib/backtest/ranking-snapshot";
import type { StrategyRankingSnapshot } from "@/lib/types";

const repo = getStrategyRankingSnapshotRepository();
const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });

export default function StrategyRankHistoryPage() {
  const [all, setAll] = useState<StrategyRankingSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = async () => setAll(await repo.list());
  useEffect(() => {
    load();
  }, []);

  const selected = all.find((s) => s.id === selectedId) ?? all[0] ?? null;
  const prev = useMemo(() => {
    if (!selected) return null;
    const idx = all.findIndex((s) => s.id === selected.id);
    return idx >= 0 && idx + 1 < all.length ? all[idx + 1] : null;
  }, [all, selected]);

  const cmp = useMemo(() => (selected ? compareRanking(selected, prev) : null), [selected, prev]);

  const remove = async (id: string) => {
    if (!confirm("このランキングスナップショットを削除しますか？")) return;
    await repo.remove(id);
    if (selectedId === id) setSelectedId(null);
    load();
  };

  return (
    <div className="space-y-6">
      <PageIntro title="🏁 戦略ランキング履歴" description="戦略ごとの検証結果の推移・順位変動を比較します。" helpKey="cagr" />
      <section className="hud-panel p-4">
        <h2 className="hud-label">🏁 戦略ランキング履歴 ({all.length})</h2>
      </section>

      {all.length === 0 ? (
        <section className="hud-panel p-4">
          <p className="text-arcdim text-sm">保存済みランキングがありません。一括BT画面の「ランキング結果を保存」で記録できます、ボス。</p>
        </section>
      ) : (
        <>
          {/* 一覧 */}
          <section className="hud-panel p-4 overflow-x-auto">
            <h2 className="hud-label mb-3">保存済みランキング</h2>
            <table className="w-full text-sm font-mono whitespace-nowrap">
              <thead>
                <tr className="hud-label text-left">
                  {([
                    { h: "日付" }, { h: "期間" }, { h: "最強戦略" }, { h: "平均CAGR", t: "cagr" }, { h: "平均PF", t: "pf" }, { h: "平均DD", t: "dd" }, { h: "銘柄数" }, { h: "" },
                  ] as { h: string; t?: string }[]).map((c, i) => (
                    <th key={c.h || `x${i}`} className="pb-2 pr-3 font-normal">{c.t ? <HelpTooltip termKey={c.t} label={c.h} /> : c.h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {all.map((s) => (
                  <tr key={s.id} className={`border-t border-line/60 cursor-pointer ${selected?.id === s.id ? "bg-arc/5" : ""}`} onClick={() => setSelectedId(s.id)}>
                    <td className="py-2 pr-3 text-arc">{s.date}</td>
                    <td className="py-2 pr-3 text-arcdim">{s.period}</td>
                    <td className="py-2 pr-3">{s.bestStrategy}</td>
                    <td className={`py-2 pr-3 ${s.averageCagr >= 0 ? "text-profit" : "text-danger"}`}>{s.averageCagr.toFixed(1)}%</td>
                    <td className="py-2 pr-3">{s.averagePf.toFixed(2)}</td>
                    <td className="py-2 pr-3 text-caution">{s.averageMaxDrawdown.toFixed(1)}%</td>
                    <td className="py-2 pr-3">{s.targetStockCount}</td>
                    <td className="py-2 pr-3"><button className="hud-btn-danger" onClick={(e) => { e.stopPropagation(); remove(s.id); }}>削除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {selected && cmp && (
            <>
              {/* 前回比較 */}
              <section className="hud-panel p-4 overflow-x-auto">
                <h2 className="hud-label mb-3">前回比較 — {selected.date}（{selected.period}） vs {prev ? prev.date : "—"}</h2>
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="hud-label text-left">
                      {["指標", "今回", "前回", "変化"].map((h) => <th key={h} className="pb-2 pr-3 font-normal">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {cmp.rows.map((r) => (
                      <tr key={r.label} className="border-t border-line/60">
                        <td className="py-2 pr-3 text-arcdim">{r.label}</td>
                        <td className="py-2 pr-3 text-[#cfeaff]">{r.cur}</td>
                        <td className="py-2 pr-3 text-arcdim">{r.prev}</td>
                        <td className={`py-2 pr-3 ${r.better === true ? "text-arc" : r.better === false ? "text-danger" : "text-[#cfeaff]"}`}>{r.delta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* 順位変動 */}
              <section className="hud-panel p-4 overflow-x-auto">
                <h2 className="hud-label mb-3">戦略別 順位・成績</h2>
                <table className="w-full text-sm font-mono whitespace-nowrap">
                  <thead>
                    <tr className="hud-label text-left">
                      {([
                        { h: "順位" }, { h: "前回順位" }, { h: "変動" }, { h: "戦略" }, { h: "CAGR", t: "cagr" }, { h: "PF", t: "pf" }, { h: "最大DD", t: "dd" }, { h: "勝率" },
                      ] as { h: string; t?: string }[]).map((c) => <th key={c.h} className="pb-2 pr-3 font-normal">{c.t ? <HelpTooltip termKey={c.t} label={c.h} /> : c.h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.rankingResults.map((r) => {
                      const ch = cmp.changes.find((c) => c.strategyName === r.strategyName);
                      const delta = ch?.delta ?? 0;
                      return (
                        <tr key={r.strategyId} className="border-t border-line/60">
                          <td className="py-2 pr-3 text-arc">{r.rank}</td>
                          <td className="py-2 pr-3 text-arcdim">{ch?.prevRank ?? "—"}</td>
                          <td className={`py-2 pr-3 ${delta > 0 ? "text-arc" : delta < 0 ? "text-danger" : "text-arcdim"}`}>{delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : "—"}</td>
                          <td className="py-2 pr-3">{r.strategyName}</td>
                          <td className={`py-2 pr-3 ${r.cagr >= 0 ? "text-profit" : "text-danger"}`}>{r.cagr.toFixed(1)}%</td>
                          <td className="py-2 pr-3">{r.profitFactor != null ? r.profitFactor.toFixed(2) : "—"}</td>
                          <td className="py-2 pr-3 text-caution">{r.maxDrawdown.toFixed(1)}%</td>
                          <td className="py-2 pr-3">{(r.winRate * 100).toFixed(0)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-arcdim text-xs mt-2">初期資金 ¥{fmt(selected.initialCapital)}</p>
              </section>

              <section className="hud-panel p-4 border-arc/40 shadow-arc">
                <h2 className="hud-label mb-3">◎ JARVIS 比較所見</h2>
                <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
                  {cmp.comments.map((c, i) => <li key={i}>・{c}</li>)}
                </ul>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
