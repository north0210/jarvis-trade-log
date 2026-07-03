"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { computeSectorHeatmap, type SectorCell, type SectorRiskLevel } from "@/lib/market/sector-heatmap";
import type { Holding, Stock } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();

const cellTone: Record<SectorRiskLevel, string> = {
  strong: "border-arc/60 bg-arc/10 text-arc shadow-arc",
  neutral: "border-line bg-panel/60 text-[#cfeaff]",
  caution: "border-caution/50 bg-caution/10 text-caution",
  danger: "border-danger/50 bg-danger/10 text-danger",
};
const levelLabel: Record<SectorRiskLevel, string> = { strong: "強", neutral: "中立", caution: "注意", danger: "過熱" };
const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });

export default function SectorHeatmapPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);

  useEffect(() => {
    (async () => {
      const [s, h] = await Promise.all([stockRepo.list(), holdingRepo.list()]);
      setStocks(s);
      setHoldings(h);
    })();
  }, []);

  const hm = useMemo(() => computeSectorHeatmap(stocks, holdings), [stocks, holdings]);
  const maxWeight = Math.max(0.0001, ...hm.sectors.map((s) => s.portfolioWeight));

  return (
    <div className="space-y-6">
      <PageIntro title="🗺 セクターヒートマップ" description="セクター/テーマ別の強弱と保有の偏りを確認します。" />
      <section className="hud-panel p-4">
        <h2 className="hud-label">🗺 セクター/テーマ ヒートマップ</h2>
        <p className="text-arcdim text-xs mt-1">強い=シアン / 中立=白 / 注意=黄 / 過熱=赤（Heat = 強さ・魅力度）</p>
      </section>

      {/* サマリー */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="hud-panel p-3"><p className="hud-label">最強セクター</p><p className="font-mono text-lg mt-1 text-arc">{hm.strongest ? `${hm.strongest.sectorName}（${hm.strongest.heatScore.toFixed(0)}）` : "—"}</p></div>
        <div className="hud-panel p-3"><p className="hud-label"><HelpTooltip termKey="rsi" label="最過熱セクター" /></p><p className="font-mono text-lg mt-1 text-caution">{hm.hottest && hm.hottest.averageRsi != null ? `${hm.hottest.sectorName}（RSI ${hm.hottest.averageRsi.toFixed(0)}）` : "—"}</p></div>
        <div className="hud-panel p-3"><p className="hud-label">最大保有テーマ</p><p className="font-mono text-lg mt-1 text-danger">{hm.maxHoldingSector ? `${hm.maxHoldingSector.sectorName}（${(hm.maxHoldingSector.portfolioWeight * 100).toFixed(0)}%）` : "—"}</p></div>
      </div>

      {/* JARVIS 所見 */}
      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS セクター所見</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {hm.comments.map((c, i) => <li key={i}>・{c}</li>)}
        </ul>
      </section>

      {/* ヒートマップ */}
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">テーマ/セクター別 ヒート</h2>
        {hm.sectors.length === 0 ? (
          <p className="text-arcdim text-sm">銘柄がありません。</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {hm.sectors.map((c: SectorCell) => (
              <div key={c.sectorName} className={`rounded border p-3 ${cellTone[c.riskLevel]}`}>
                <div className="flex items-center justify-between">
                  <span className="font-display tracking-wider">{c.sectorName}</span>
                  <span className="font-mono text-2xl">{c.heatScore.toFixed(0)}</span>
                </div>
                <p className="text-xs font-mono mt-1 opacity-80">
                  [{levelLabel[c.riskLevel]}] 銘柄{c.stockCount} / 保有{c.holdingCount}
                  {c.averageRelVolume != null && c.averageRelVolume >= 1.5 && <span className="text-caution"> ・出来高急増</span>}
                </p>
                <div className="grid grid-cols-2 gap-x-3 text-xs font-mono mt-2 opacity-90">
                  <span>Score {c.averageScore.toFixed(0)}</span>
                  <span>RSI {c.averageRsi != null ? c.averageRsi.toFixed(0) : "—"}</span>
                  <span>ROE {c.averageRoe != null ? `${c.averageRoe.toFixed(0)}%` : "—"}</span>
                  <span>成長 {c.averageGrowth != null ? `${c.averageGrowth.toFixed(0)}%` : "—"}</span>
                  <span>PER {c.averagePer != null ? c.averagePer.toFixed(1) : "—"}</span>
                  <span>相対出来高 {c.averageRelVolume != null ? `${c.averageRelVolume.toFixed(2)}x` : "—"}</span>
                  <span>比率 {(c.portfolioWeight * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs mt-2 whitespace-pre-wrap opacity-90">{c.jarvisComment}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 保有比率バー */}
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">セクター別 保有比率</h2>
        {hm.sectors.filter((s) => s.portfolioWeight > 0).length === 0 ? (
          <p className="text-arcdim text-sm">保有ポジションがありません。</p>
        ) : (
          <ul className="space-y-2">
            {hm.sectors.filter((s) => s.portfolioWeight > 0).sort((a, b) => b.portfolioWeight - a.portfolioWeight).map((c) => (
              <li key={c.sectorName}>
                <div className="flex justify-between text-sm font-mono mb-0.5">
                  <span className="text-[#cfeaff]">{c.sectorName}</span>
                  <span className="text-arc">{(c.portfolioWeight * 100).toFixed(1)}% <span className="text-arcdim">¥{fmt(c.totalMarketValue)}</span></span>
                </div>
                <div className="h-2 rounded bg-void/70 border border-line overflow-hidden">
                  <div className={`h-full ${c.portfolioWeight >= 0.4 ? "bg-danger/60" : "bg-arc/60"}`} style={{ width: `${(c.portfolioWeight / maxWeight) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
