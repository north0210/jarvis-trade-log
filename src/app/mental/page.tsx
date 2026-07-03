"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import { getJournalRepository } from "@/lib/storage/journalRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { analyzeMental, type EmotionStat } from "@/lib/mental/mental-analysis";
import type { Journal, Trade } from "@/lib/types";

const journalRepo = getJournalRepository();
const tradeRepo = getTradeRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const yen = (n: number) => `${n >= 0 ? "+" : ""}¥${fmt(n)}`;

export default function MentalPage() {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    (async () => {
      const [j, t] = await Promise.all([journalRepo.list(), tradeRepo.list()]);
      setJournals(j);
      setTrades(t);
    })();
  }, []);

  const a = useMemo(() => analyzeMental(journals, trades), [journals, trades]);
  const scoreTone = a.mentalScore >= 80 ? "text-profit" : a.mentalScore >= 60 ? "text-arc" : a.mentalScore >= 45 ? "text-caution" : "text-danger";
  const maxAbs = Math.max(1, ...a.emotions.map((e) => Math.abs(e.pnl)));

  return (
    <div className="space-y-6">
      <PageIntro title="🧠 メンタル分析" description="取引履歴から心理の乱れを可視化します。" />
      <section className="hud-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="hud-label">🧠 メンタル分析コンソール</h2>
          <span className={`font-mono text-3xl ${scoreTone}`}>Mental {a.mentalScore}</span>
        </div>
        <p className="text-arcdim text-xs mt-1">日誌の感情記録と取引成績の突合（{a.matched}件紐付 / {a.unmatched}件未記録）。高いほど心理的に安定。</p>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="hud-panel p-3">
          <p className="hud-label">危険感情</p>
          <p className="font-mono text-lg mt-1 text-danger">{a.riskEmotion && a.riskEmotion.avgPnl < 0 ? a.riskEmotion.emotion : "—"}</p>
        </div>
        <div className="hud-panel p-3">
          <p className="hud-label">好成績感情</p>
          <p className="font-mono text-lg mt-1 text-arc">{a.bestEmotion && a.bestEmotion.avgPnl > 0 ? a.bestEmotion.emotion : "—"}</p>
        </div>
        <div className="hud-panel p-3">
          <p className="hud-label">連敗後再エントリー勝率</p>
          <p className={`font-mono text-lg mt-1 ${a.afterLoss.avgPnl >= 0 ? "text-profit" : "text-danger"}`}>{a.afterLoss.count > 0 ? `${(a.afterLoss.winRate * 100).toFixed(0)}%` : "—"}</p>
        </div>
        <div className="hud-panel p-3">
          <p className="hud-label">連敗後再エントリー平均損益</p>
          <p className={`font-mono text-lg mt-1 ${a.afterLoss.avgPnl >= 0 ? "text-profit" : "text-danger"}`}>{a.afterLoss.count > 0 ? yen(a.afterLoss.avgPnl) : "—"}</p>
        </div>
      </div>

      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-3">◎ JARVIS メンタル所見</h2>
        <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
          {a.comments.map((c, i) => <li key={i}>・{c}</li>)}
        </ul>
      </section>

      {/* 感情別カード（勝率バー） */}
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">感情別 勝率・損益</h2>
        {a.emotions.length === 0 ? (
          <p className="text-arcdim text-sm">感情に紐付く取引がありません。運用日誌に感情メモを記録してください。</p>
        ) : (
          <ul className="space-y-2">
            {a.emotions.map((e: EmotionStat) => (
              <li key={e.emotion}>
                <div className="flex justify-between text-sm font-mono mb-0.5">
                  <span className="text-[#cfeaff]">{e.emotion} <span className="text-arcdim">({e.count}件・勝率{(e.winRate * 100).toFixed(0)}%)</span></span>
                  <span className={e.pnl >= 0 ? "text-profit" : "text-danger"}>{yen(e.pnl)}</span>
                </div>
                <div className="h-2 rounded bg-void/70 border border-line overflow-hidden">
                  <div className={`h-full ${e.pnl >= 0 ? "bg-arc/60" : "bg-danger/60"}`} style={{ width: `${(Math.abs(e.pnl) / maxAbs) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 感情別 損益テーブル */}
      <section className="hud-panel p-4 overflow-x-auto">
        <h2 className="hud-label mb-3">感情別 詳細</h2>
        {a.emotions.length === 0 ? (
          <p className="text-arcdim text-sm">データなし</p>
        ) : (
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="hud-label text-left">
                {["感情", "取引", "勝率", "実現損益", "平均利益", "平均損失", "平均損益"].map((h) => (
                  <th key={h} className="pb-2 pr-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.emotions.map((e) => (
                <tr key={e.emotion} className="border-t border-line/60">
                  <td className="py-2 pr-3 text-arc">{e.emotion}</td>
                  <td className="py-2 pr-3">{e.count}</td>
                  <td className="py-2 pr-3">{(e.winRate * 100).toFixed(0)}%</td>
                  <td className={`py-2 pr-3 ${e.pnl >= 0 ? "text-profit" : "text-danger"}`}>{yen(e.pnl)}</td>
                  <td className="py-2 pr-3 text-profit">{e.avgWin ? `+¥${fmt(e.avgWin)}` : "—"}</td>
                  <td className="py-2 pr-3 text-danger">{e.avgLoss ? `¥${fmt(e.avgLoss)}` : "—"}</td>
                  <td className={`py-2 pr-3 ${e.avgPnl >= 0 ? "text-profit" : "text-danger"}`}>{yen(e.avgPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
