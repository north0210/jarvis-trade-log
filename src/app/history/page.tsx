"use client";

import { useEffect, useMemo, useState } from "react";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import type { Stock, Strategy, Trade } from "@/lib/types";
import { analyzeTrades, type GroupStat } from "@/lib/analysis/trades";
import { analyzeByStrategy, estimateStrategy } from "@/lib/analysis/strategyPerf";

const tradeRepo = getTradeRepository();
const stockRepo = getStockRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const signYen = (n: number) => `${n >= 0 ? "+" : ""}¥${fmt(n)}`;
const pctf = (r: number) => `${(r * 100).toFixed(1)}%`;

function StatCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "profit" | "danger" }) {
  const color = tone === "profit" ? "text-profit" : tone === "danger" ? "text-danger" : "text-arc";
  return (
    <div className="hud-panel p-4">
      <p className="hud-label">{label}</p>
      <p className={`font-mono text-2xl mt-2 ${color}`}>{value}</p>
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupStat[] }) {
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
  return (
    <section className="hud-panel p-4">
      <h2 className="hud-label mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-arcdim text-sm">データなし</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex justify-between text-sm font-mono mb-0.5">
                <span className="text-[#cfeaff]">{r.key} <span className="text-arcdim">({r.count}件・勝率{pctf(r.winRate)})</span></span>
                <span className={r.pnl >= 0 ? "text-profit" : "text-danger"}>{signYen(r.pnl)}</span>
              </div>
              <div className="h-2 rounded bg-void/70 border border-line overflow-hidden">
                <div
                  className={`h-full ${r.pnl >= 0 ? "bg-profit/60" : "bg-danger/60"}`}
                  style={{ width: `${(Math.abs(r.pnl) / maxAbs) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function HistoryPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);

  const load = async () => {
    const [t, s, strats] = await Promise.all([tradeRepo.list(), stockRepo.list(), ensureSeeded()]);
    setTrades(t);
    setStocks(s);
    setStrategies(strats);
  };
  useEffect(() => {
    load();
  }, []);

  const a = useMemo(() => analyzeTrades(trades), [trades]);
  const perfStats = useMemo(() => analyzeByStrategy(trades, strategies), [trades, strategies]);

  const remove = async (id: string) => {
    if (!confirm("この取引記録を削除しますか？")) return;
    await tradeRepo.remove(id);
    load();
  };

  return (
    <div className="space-y-6">
      <section className="hud-panel p-4">
        <h2 className="hud-label">▤ 取引履歴分析コンソール</h2>
      </section>

      {/* サマリー */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="総実現損益" value={signYen(a.totalRealizedPnl)} tone={a.totalRealizedPnl > 0 ? "profit" : a.totalRealizedPnl < 0 ? "danger" : "neutral"} />
        <StatCard label="勝率" value={`${pctf(a.winRate)} (${a.wins}/${a.count})`} />
        <StatCard label="平均利益" value={signYen(a.avgWin)} tone="profit" />
        <StatCard label="平均損失" value={signYen(a.avgLoss)} tone="danger" />
        <StatCard label="損益比" value={a.profitFactor != null ? a.profitFactor.toFixed(2) : "—"} tone={a.profitFactor != null && a.profitFactor >= 1 ? "profit" : "danger"} />
        <StatCard label="平均保有期間" value={a.avgHoldingDays != null ? `${a.avgHoldingDays.toFixed(0)}日` : "—"} />
        <StatCard label="最大利益銘柄" value={a.maxWin ? `${a.maxWin.stockName}` : "—"} tone="profit" />
        <StatCard label="最大損失銘柄" value={a.maxLoss ? `${a.maxLoss.stockName}` : "—"} tone="danger" />
      </div>

      {/* JARVIS 所見 */}
      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS 取引分析</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {a.comments.map((c, i) => (
            <li key={i}>・{c}</li>
          ))}
        </ul>
      </section>

      {/* 戦略別集計カード */}
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">戦略別 集計</h2>
        {perfStats.length === 0 ? (
          <p className="text-arcdim text-sm">戦略に紐付いた取引がありません。売却時に戦略を選択すると集計されます。</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {perfStats.map((s) => (
              <div key={s.id ?? "none"} className="rounded border border-line p-3">
                <div className="flex items-center justify-between">
                  <span className="font-display text-arc">{s.name}</span>
                  <span className={`font-mono ${s.totalRealizedPnl >= 0 ? "text-profit" : "text-danger"}`}>{signYen(s.totalRealizedPnl)}</span>
                </div>
                <p className="text-arcdim text-xs mt-1 font-mono">
                  {s.count}件 ・ 勝率{pctf(s.winRate)} ・ 損益比{s.profitFactor != null ? s.profitFactor.toFixed(2) : "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 内訳 */}
      <div className="grid md:grid-cols-2 gap-4">
        <GroupTable title="テーマ別成績" rows={a.byTheme} />
        <GroupTable title="Score別成績（エントリ時）" rows={a.byScoreGrade} />
        <GroupTable title="銘柄別成績" rows={a.byStock} />
        <GroupTable title="月別成績" rows={a.byMonth} />
      </div>

      {/* 履歴テーブル */}
      <section className="hud-panel p-4 overflow-x-auto">
        <h2 className="hud-label mb-3">取引履歴 ({trades.length})</h2>
        {trades.length === 0 ? (
          <p className="text-arcdim text-sm">取引履歴なし。保有株の売却時に記録されます。</p>
        ) : (
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {["日付", "銘柄", "操作", "取得", "売却", "株数", "実現損益", "損益率", "保有日数", "Score", "戦略", "理由", ""].map((h) => (
                  <th key={h} className="pb-2 pr-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-t border-line/60">
                  <td className="py-2 pr-3">{t.date}</td>
                  <td className="py-2 pr-3">{t.stockName} <span className="opacity-60">({t.stockCode})</span></td>
                  <td className="py-2 pr-3">{t.action === "sellAll" ? "全売却" : "一部売却"}</td>
                  <td className="py-2 pr-3">¥{fmt(t.buyPrice)}</td>
                  <td className="py-2 pr-3">¥{fmt(t.sellPrice)}</td>
                  <td className="py-2 pr-3">{t.shares}</td>
                  <td className={`py-2 pr-3 ${t.realizedPnl >= 0 ? "text-profit" : "text-danger"}`}>{signYen(t.realizedPnl)}</td>
                  <td className={`py-2 pr-3 ${t.realizedPnlRate >= 0 ? "text-profit" : "text-danger"}`}>{t.realizedPnlRate >= 0 ? "+" : ""}{t.realizedPnlRate.toFixed(2)}%</td>
                  <td className="py-2 pr-3">{t.holdingDays != null ? `${t.holdingDays}日` : "—"}</td>
                  <td className="py-2 pr-3">{t.scoreAtEntry ?? "—"}→{t.scoreAtExit ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {t.strategyName ? (
                      <span className="text-arc">{t.strategyName}</span>
                    ) : (
                      <span className="text-arcdim">{estimateStrategy(t, stocks, strategies) ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-arcdim">{t.reason ?? "—"}</td>
                  <td className="py-2 pr-3"><button className="hud-btn-danger" onClick={() => remove(t.id)}>削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
