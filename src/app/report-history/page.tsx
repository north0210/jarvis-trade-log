"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import {
  getReportSnapshotRepository,
  compareSnapshots,
  compareComments,
  compareSnapshotStates,
} from "@/lib/report/snapshot";
import type { ReportSnapshot } from "@/lib/types";

const repo = getReportSnapshotRepository();

const periodLabel: Record<ReportSnapshot["period"], string> = { daily: "日次", weekly: "週次", monthly: "月次" };

function Spark({ values, color, height = 80 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return <p className="text-arcdim text-xs">推移データ不足（2件以上で描画）</p>;
  const w = 400;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

export default function ReportHistoryPage() {
  const [all, setAll] = useState<ReportSnapshot[]>([]);
  const [filter, setFilter] = useState<"all" | ReportSnapshot["period"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = async () => setAll(await repo.list());
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? all : all.filter((s) => s.period === filter)),
    [all, filter]
  );

  const selected = filtered.find((s) => s.id === selectedId) ?? filtered[0] ?? null;
  const prev = useMemo(() => {
    if (!selected) return null;
    // 選択より古い、同期間フィルタ内の直近スナップショット（list は新しい順）
    const idx = filtered.findIndex((s) => s.id === selected.id);
    return idx >= 0 && idx + 1 < filtered.length ? filtered[idx + 1] : null;
  }, [filtered, selected]);

  const rows = useMemo(() => (selected ? compareSnapshots(selected, prev) : []), [selected, prev]);
  const stateRows = useMemo(() => (selected ? compareSnapshotStates(selected, prev) : []), [selected, prev]);
  const comments = useMemo(() => (selected ? compareComments(selected, prev) : []), [selected, prev]);

  // 推移（古い→新しい）
  const chrono = filtered.slice().reverse();

  const remove = async (id: string) => {
    if (!confirm("このスナップショットを削除しますか？")) return;
    await repo.remove(id);
    if (selectedId === id) setSelectedId(null);
    load();
  };

  return (
    <div className="space-y-6">
      <PageIntro title="📚 レポート履歴" description="過去スナップショットを比較し、運用の推移を確認します。" />
      <section className="hud-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="hud-label">📚 レポート履歴 ({filtered.length})</h2>
          <select className="hud-input w-28" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">全期間</option>
            <option value="daily">日次</option>
            <option value="weekly">週次</option>
            <option value="monthly">月次</option>
          </select>
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="hud-panel p-4">
          <p className="text-arcdim text-sm">スナップショットがありません。レポート画面の「現在の状態を保存」で記録できます、ボス。</p>
        </section>
      ) : (
        <>
          {/* 推移 */}
          <div className="grid md:grid-cols-2 gap-4">
            <section className="hud-panel p-4">
              <h2 className="hud-label mb-2">総資産 推移</h2>
              <Spark values={chrono.map((s) => s.totalAssets)} color="#6fe3ff" />
            </section>
            <section className="hud-panel p-4">
              <h2 className="hud-label mb-2">Risk Score 推移</h2>
              <Spark values={chrono.map((s) => s.riskScore)} color="#4ade80" />
            </section>
          </div>

          {/* 一覧 */}
          <section className="hud-panel p-4 overflow-x-auto">
            <h2 className="hud-label mb-3">スナップショット一覧</h2>
            <table className="w-full text-sm font-mono whitespace-nowrap">
              <thead>
                <tr className="hud-label text-left">
                  {([
                    { h: "日付" }, { h: "期間" }, { h: "保存" }, { h: "総資産" }, { h: "実現損益" }, { h: "勝率" }, { h: "Risk", t: "riskgrade" }, { h: "規律", t: "disciplinescore" }, { h: "Mental" }, { h: "" },
                  ] as { h: string; t?: string }[]).map((c, i) => (
                    <th key={c.h || `x${i}`} className="pb-2 pr-3 font-normal">{c.t ? <HelpTooltip termKey={c.t} label={c.h} /> : c.h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-t border-line/60 cursor-pointer ${selected?.id === s.id ? "bg-arc/5" : ""}`}
                    onClick={() => setSelectedId(s.id)}
                  >
                    <td className="py-2 pr-3 text-arc">{s.date}</td>
                    <td className="py-2 pr-3 text-arcdim">{periodLabel[s.period]}</td>
                    <td className="py-2 pr-3">{s.source === "auto" ? <span className="text-arc">自動</span> : s.source === "manual" ? "手動" : "—"}</td>
                    <td className="py-2 pr-3">¥{s.totalAssets.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}</td>
                    <td className={`py-2 pr-3 ${s.realizedPnl >= 0 ? "text-profit" : "text-danger"}`}>{s.realizedPnl >= 0 ? "+" : ""}¥{s.realizedPnl.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}</td>
                    <td className="py-2 pr-3">{(s.winRate * 100).toFixed(0)}%</td>
                    <td className="py-2 pr-3">{s.riskGrade}/{s.riskScore}</td>
                    <td className="py-2 pr-3">{s.disciplineScore}</td>
                    <td className="py-2 pr-3">{s.mentalScore}</td>
                    <td className="py-2 pr-3"><button className="hud-btn-danger" onClick={(e) => { e.stopPropagation(); remove(s.id); }}>削除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* 前回比較 */}
          {selected && (
            <>
              <section className="hud-panel p-4 overflow-x-auto">
                <h2 className="hud-label mb-3">前回比較 — {selected.date}（{periodLabel[selected.period]}） vs {prev ? prev.date : "—"}</h2>
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="hud-label text-left">
                      {["指標", "今回", "前回", "変化"].map((h) => (
                        <th key={h} className="pb-2 pr-3 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-line/60">
                        <td className="py-2 pr-3 text-arcdim">{r.label}</td>
                        <td className="py-2 pr-3 text-[#cfeaff]">{r.cur}</td>
                        <td className="py-2 pr-3 text-arcdim">{r.prev}</td>
                        <td className={`py-2 pr-3 ${r.better === true ? "text-arc" : r.better === false ? "text-danger" : "text-[#cfeaff]"}`}>{r.delta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="hud-panel p-4 overflow-x-auto">
                <h2 className="hud-label mb-3">市況・戦略・セクター 変化</h2>
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="hud-label text-left">
                      {["項目", "今回", "前回", ""].map((h) => <th key={h} className="pb-2 pr-3 font-normal">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {stateRows.map((r) => (
                      <tr key={r.label} className="border-t border-line/60">
                        <td className="py-2 pr-3 text-arcdim">{r.label}</td>
                        <td className={`py-2 pr-3 ${r.changed ? "text-arc" : "text-[#cfeaff]"}`}>{r.cur}</td>
                        <td className="py-2 pr-3 text-arcdim">{r.prev}</td>
                        <td className={`py-2 pr-3 ${r.changed ? "text-caution" : "text-arcdim"}`}>{r.changed ? "変化" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="hud-panel p-4 border-arc/40 shadow-arc">
                <h2 className="hud-label mb-3">◎ JARVIS 比較所見</h2>
                <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
                  {comments.map((c, i) => <li key={i}>・{c}</li>)}
                </ul>
                {selected.jarvisSummary && <p className="text-arcdim text-xs mt-2">当時の総括: {selected.jarvisSummary}</p>}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
