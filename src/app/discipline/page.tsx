"use client";

import { useEffect, useMemo, useState } from "react";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { getCashPosition } from "@/lib/analysis/portfolio";
import { evaluateDiscipline, type DisciplineLevel } from "@/lib/discipline/rules";
import type { Holding, Stock, Trade } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const tradeRepo = getTradeRepository();

const levelTone: Record<DisciplineLevel, string> = {
  danger: "border-danger/50 text-danger bg-danger/5 shadow-dangerGlow",
  warning: "border-caution/50 text-caution bg-caution/5",
  info: "border-arc/50 text-arc bg-arc/5",
};
const levelLabel: Record<DisciplineLevel, string> = { danger: "重大", warning: "警告", info: "情報" };

function ScoreCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "profit" | "danger" | "caution" }) {
  const color = tone === "profit" ? "text-profit" : tone === "danger" ? "text-danger" : tone === "caution" ? "text-caution" : "text-arc";
  return (
    <div className="hud-panel p-4">
      <p className="hud-label">{label}</p>
      <p className={`font-mono text-3xl mt-2 ${color}`}>{value}</p>
    </div>
  );
}

export default function DisciplinePage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [cash, setCash] = useState(0);

  useEffect(() => {
    (async () => {
      const [s, h, t] = await Promise.all([stockRepo.list(), holdingRepo.list(), tradeRepo.list()]);
      setStocks(s);
      setHoldings(h);
      setTrades(t);
      setCash(getCashPosition());
    })();
  }, []);

  const report = useMemo(
    () => evaluateDiscipline(stocks, holdings, trades, cash),
    [stocks, holdings, trades, cash]
  );

  const scoreTone = report.score >= 90 ? "profit" : report.score >= 70 ? "neutral" : report.score >= 50 ? "caution" : "danger";
  const order: DisciplineLevel[] = ["danger", "warning", "info"];
  const sorted = report.results.slice().sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));

  return (
    <div className="space-y-6">
      <section className="hud-panel p-4">
        <h2 className="hud-label">⚖ 取引規律コンソール — Discipline Monitor</h2>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ScoreCard label="規律スコア" value={`${report.score}`} tone={scoreTone} />
        <ScoreCard label="違反件数" value={`${report.results.length}`} />
        <ScoreCard label="重大違反 (danger)" value={`${report.dangerCount}`} tone={report.dangerCount > 0 ? "danger" : "neutral"} />
        <ScoreCard label="警告 (warning)" value={`${report.warningCount}`} tone={report.warningCount > 0 ? "caution" : "neutral"} />
      </div>

      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS 警告</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {report.comments.map((c, i) => (
            <li key={i}>・{c}</li>
          ))}
        </ul>
      </section>

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">ルール別 違反一覧 ({report.results.length})</h2>
        {sorted.length === 0 ? (
          <p className="text-arcdim text-sm">検知された違反はありません。規律は完璧です、ボス。</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((r) => (
              <li key={r.id} className={`px-3 py-2 rounded border text-sm ${levelTone[r.level]}`}>
                <div className="flex items-center justify-between font-mono">
                  <span className="font-display tracking-wider">[{levelLabel[r.level]}] {r.title}</span>
                  {r.relatedStockCode && (
                    <span className="text-arcdim">{r.relatedStockName}（{r.relatedStockCode}）</span>
                  )}
                </div>
                <p className="mt-1 text-[#cfeaff]">{r.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
