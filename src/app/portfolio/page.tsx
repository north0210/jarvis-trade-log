"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import AiComment from "@/components/AiComment";
import { safeFixed } from "@/lib/utils/safe";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import type { Holding, Stock } from "@/lib/types";
import {
  analyzePortfolio,
  getCashPosition,
  setCashPosition,
  type AllocationSlice,
} from "@/lib/analysis/portfolio";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

function StatCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "profit" | "danger" }) {
  const color = tone === "profit" ? "text-profit" : tone === "danger" ? "text-danger" : "text-arc";
  return (
    <div className="hud-panel p-4">
      <p className="hud-label">{label}</p>
      <p className={`font-mono text-2xl mt-2 ${color}`}>{value}</p>
    </div>
  );
}

function AllocBars({ title, slices }: { title: string; slices: AllocationSlice[] }) {
  return (
    <section className="hud-panel p-4">
      <h2 className="hud-label mb-3">{title}</h2>
      {slices.length === 0 ? (
        <p className="text-arcdim text-sm">データなし</p>
      ) : (
        <ul className="space-y-2">
          {slices.map((s) => (
            <li key={s.key}>
              <div className="flex justify-between text-sm font-mono mb-0.5">
                <span className="text-[#cfeaff]">{s.key}</span>
                <span className="text-arc">{pct(s.ratio)} <span className="text-arcdim">¥{fmt(s.value)}</span></span>
              </div>
              <div className="h-2 rounded bg-void/70 border border-line overflow-hidden">
                <div
                  className="h-full bg-arc/60 shadow-arc"
                  style={{ width: `${Math.min(100, s.ratio * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PortfolioPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [cashInput, setCashInput] = useState("");

  useEffect(() => {
    (async () => {
      const [s, h] = await Promise.all([stockRepo.list(), holdingRepo.list()]);
      setStocks(s);
      setHoldings(h);
      setCashInput(String(getCashPosition()));
    })();
  }, []);

  const cash = useMemo(() => {
    const n = Number(cashInput);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [cashInput]);

  const a = useMemo(() => analyzePortfolio(stocks, holdings, cash), [stocks, holdings, cash]);

  const onCashChange = (v: string) => {
    setCashInput(v);
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) setCashPosition(n);
  };

  const riskTone =
    a.riskLevel === "danger" ? "text-danger" : a.riskLevel === "caution" ? "text-caution" : "text-profit";
  const riskLabel = a.riskLevel === "danger" ? "危険" : a.riskLevel === "caution" ? "注意" : "安全";

  return (
    <div className="space-y-6">
      <PageIntro title="◈ PF分析" description="保有比率の偏り・現金比率・配分バランスを確認します。" helpKey="currentweight" />
      {holdings.length === 0 && (
        <section className="hud-panel p-4 border-caution/50 bg-caution/5">
          <p className="text-sm font-mono text-caution">・現在表示できる保有データがありません。保有株を登録後に分析します、ボス。</p>
        </section>
      )}
      <section className="hud-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="hud-label">◈ ポートフォリオ最適化コンソール</h2>
          <span className={`font-display text-lg ${riskTone}`}>危険度: {riskLabel}</span>
        </div>
      </section>

      {/* サマリー */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="総評価額" value={`¥${fmt(a.totalValue)}`} />
        <StatCard
          label="総含み損益"
          value={`${a.pnl >= 0 ? "+" : ""}¥${fmt(a.pnl)}`}
          tone={a.pnl > 0 ? "profit" : a.pnl < 0 ? "danger" : "neutral"}
        />
        <StatCard
          label="損益率"
          value={`${a.pnlPct >= 0 ? "+" : ""}${a.pnlPct.toFixed(2)}%`}
          tone={a.pnlPct > 0 ? "profit" : a.pnlPct < 0 ? "danger" : "neutral"}
        />
        <StatCard label="保有銘柄数" value={`${a.holdingCount}`} />
        <StatCard label="総資産（現金込）" value={`¥${fmt(a.totalAssets)}`} />
        <StatCard label="現金比率" value={pct(a.cashRatio)} tone={a.cashRatio < 0.1 ? "danger" : "neutral"} />
        <StatCard label="Score平均（加重）" value={safeFixed(a.scoreAvg, 1)} />
        <StatCard label="危険銘柄数" value={`${a.dangerCount}`} tone={a.dangerCount > 0 ? "danger" : "neutral"} />
      </div>

      {/* 現金入力 + 最大集中 */}
      <div className="grid md:grid-cols-2 gap-4">
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-2">現金ポジション</h2>
          <label className="block max-w-xs">
            <span className="hud-label">現金額（円）</span>
            <input
              className="hud-input mt-1"
              type="number"
              min="0"
              step="1000"
              value={cashInput}
              onChange={(e) => onCashChange(e.target.value)}
              placeholder="0"
            />
          </label>
          <p className="text-arcdim text-xs mt-2">総資産に対する現金比率の算出に使用します。</p>
        </section>
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-2">最大保有比率銘柄</h2>
          {a.maxPosition ? (
            <p className="font-mono">
              <span className="text-arc text-lg">{a.maxPosition.name}</span>{" "}
              <span className={a.maxPosition.ratio >= 0.4 ? "text-danger" : "text-arcdim"}>
                {pct(a.maxPosition.ratio)}
              </span>
            </p>
          ) : (
            <p className="text-arcdim text-sm">保有なし</p>
          )}
        </section>
      </div>

      {/* リスク警告 */}
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">⚠ リスク警告</h2>
        {a.warnings.length === 0 ? (
          <p className="text-arcdim text-sm">重大な偏りは検出されていません、ボス。</p>
        ) : (
          <ul className="space-y-2">
            {a.warnings.map((w, i) => (
              <li
                key={i}
                className={`text-sm font-mono px-3 py-2 rounded border ${
                  w.level === "danger"
                    ? "border-danger/50 text-danger bg-danger/5 shadow-dangerGlow"
                    : "border-caution/50 text-caution bg-caution/5"
                }`}
              >
                {w.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* JARVIS 提案 */}
      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS リバランス提案</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {a.suggestions.map((s, i) => (
            <li key={i}>・{s}</li>
          ))}
        </ul>
      </section>

      {/* 配分 */}
      <div className="grid md:grid-cols-2 gap-4">
        <AllocBars title="銘柄別 保有比率" slices={a.byStock} />
        <AllocBars title="テーマ別 保有比率" slices={a.byTheme} />
        <AllocBars title="Grade別 保有比率" slices={a.byGrade} />
        <AllocBars title="状態別 保有比率" slices={a.byStatus} />
      </div>

      <AiComment
        ctx={{
          title: "Portfolio",
          facts: [
            `総資産 ¥${fmt(a.totalAssets)} / 現金比率 ${pct(a.cashRatio)}`,
            `含み損益 ${a.pnl >= 0 ? "+" : ""}¥${fmt(a.pnl)}（${a.pnlPct.toFixed(1)}%）`,
            a.maxPosition ? `最大集中 ${a.maxPosition.name} ${pct(a.maxPosition.ratio)}` : "保有なし",
            `保有 ${a.holdingCount}銘柄 / 危険銘柄 ${a.dangerCount}件`,
          ],
        }}
      />
    </div>
  );
}
