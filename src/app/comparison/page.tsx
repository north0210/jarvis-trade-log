"use client";

import { useEffect, useMemo, useState } from "react";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import type { Holding, Stock, StockStatus } from "@/lib/types";
import { scoreStock, type ScoreResult } from "@/lib/score";
import { stockAlerts } from "@/lib/alerts";
import JarvisCommentPanel from "@/components/JarvisCommentPanel";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const nn = (v: number | null | undefined, suffix = "") =>
  v == null ? "—" : `${v}${suffix}`;

const GRADES: ScoreResult["grade"][] = ["S", "A", "B", "C", "D"];
const STATUSES: StockStatus[] = ["買い候補", "押し目待ち", "保有中", "見送り", "危険"];

const gradeTone: Record<ScoreResult["grade"], string> = {
  S: "text-profit",
  A: "text-arc",
  B: "text-arc",
  C: "text-caution",
  D: "text-danger",
};

/** Score ヒートマップの配色クラス。 */
function scoreHeat(score: number): string {
  if (score >= 90) return "bg-arc/25 text-arc";
  if (score >= 80) return "bg-signal/25 text-signal";
  if (score >= 65) return "text-[#cfeaff]";
  if (score >= 50) return "bg-caution/20 text-caution";
  return "bg-danger/20 text-danger";
}

interface Row {
  stock: Stock;
  result: ScoreResult;
  pnlPct: number | null;
  held: boolean;
}

// 比較パネルの指標定義（dir: high=大きいほど良い / low=小さいほど良い / rsi=帯評価 / none=中立）
type Dir = "high" | "low" | "rsi" | "none";
const METRICS: { label: string; dir: Dir; get: (r: Row) => number | string | null; num?: (r: Row) => number | null }[] = [
  { label: "Score", dir: "high", get: (r) => r.result.score, num: (r) => r.result.score },
  { label: "Grade", dir: "none", get: (r) => r.result.grade },
  { label: "推奨", dir: "none", get: (r) => r.result.recommendation },
  { label: "PER", dir: "low", get: (r) => r.stock.per, num: (r) => r.stock.per },
  { label: "PBR", dir: "low", get: (r) => r.stock.pbr, num: (r) => r.stock.pbr },
  { label: "ROE %", dir: "high", get: (r) => r.stock.roe, num: (r) => r.stock.roe },
  { label: "営業利益率 %", dir: "high", get: (r) => r.stock.operating_margin, num: (r) => r.stock.operating_margin },
  { label: "売上成長率 %", dir: "high", get: (r) => r.stock.sales_growth, num: (r) => r.stock.sales_growth },
  { label: "RSI", dir: "rsi", get: (r) => r.stock.rsi, num: (r) => r.stock.rsi },
  { label: "現在価格", dir: "none", get: (r) => r.stock.current_price },
  { label: "損益率 %", dir: "high", get: (r) => r.pnlPct, num: (r) => r.pnlPct },
];

/** 比較セルの差分色（最良=青 / 危険=赤 / 中立=白）。 */
function cellColor(dir: Dir, value: number | null, values: (number | null)[]): string {
  if (value == null) return "";
  if (dir === "rsi") {
    if (value >= 80) return "text-danger";
    if (value >= 40 && value <= 65) return "text-arc";
    return "";
  }
  if (dir === "high" || dir === "low") {
    const nums = values.filter((v): v is number => typeof v === "number");
    if (nums.length < 2) return "";
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    if (max === min) return "";
    const best = dir === "high" ? max : min;
    const worst = dir === "high" ? min : max;
    if (value === best) return "text-arc";
    if (value === worst) return "text-danger";
  }
  return "";
}

const numDesc = (get: (r: Row) => number | null) => (a: Row, b: Row) => {
  const x = get(a);
  const y = get(b);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return y - x;
};
const numAsc = (get: (r: Row) => number | null) => (a: Row, b: Row) => {
  const x = get(a);
  const y = get(b);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return x - y;
};

const SORTS: { key: string; label: string; cmp: (a: Row, b: Row) => number }[] = [
  { key: "score", label: "Score順", cmp: (a, b) => b.result.score - a.result.score },
  { key: "roe", label: "ROE順", cmp: numDesc((r) => r.stock.roe) },
  { key: "rsi", label: "RSI順", cmp: numDesc((r) => r.stock.rsi) },
  { key: "op", label: "利益率順", cmp: numDesc((r) => r.stock.operating_margin) },
  { key: "per", label: "PER順", cmp: numAsc((r) => r.stock.per) },
  { key: "pbr", label: "PBR順", cmp: numAsc((r) => r.stock.pbr) },
  { key: "code", label: "コード順", cmp: (a, b) => a.stock.code.localeCompare(b.stock.code) },
];

const MAX_COMPARE = 5;

export default function ComparisonPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [grades, setGrades] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState("score");
  const [compareIds, setCompareIds] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const [s, h] = await Promise.all([stockRepo.list(), holdingRepo.list()]);
      setStocks(s);
      setHoldings(h);
    })();
  }, []);

  const rows: Row[] = useMemo(() => {
    return stocks.map((stock) => {
      const hs = holdings.filter((h) => h.stock_id === stock.id);
      let pnlPct: number | null = null;
      if (hs.length > 0 && stock.current_price != null) {
        const cost = hs.reduce((a, h) => a + h.buy_price * h.shares, 0);
        const value = hs.reduce((a, h) => a + (stock.current_price as number) * h.shares, 0);
        pnlPct = cost === 0 ? 0 : ((value - cost) / cost) * 100;
      }
      return { stock, result: scoreStock(stock), pnlPct, held: hs.length > 0 };
    });
  }, [stocks, holdings]);

  const filtered = useMemo(() => {
    const out = rows.filter(
      (r) =>
        (grades.size === 0 || grades.has(r.result.grade)) &&
        (statuses.size === 0 || statuses.has(r.stock.status))
    );
    const sort = SORTS.find((s) => s.key === sortKey) ?? SORTS[0];
    return [...out].sort(sort.cmp);
  }, [rows, grades, statuses, sortKey]);

  const compareRows = useMemo(
    () => compareIds.map((id) => rows.find((r) => r.stock.id === id)).filter((r): r is Row => !!r),
    [compareIds, rows]
  );

  const toggleSet = (set: Set<string>, setFn: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFn(next);
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev; // 最大5銘柄
      return [...prev, id];
    });
  };

  return (
    <div className="space-y-6">
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">⟁ JARVIS 分析コンソール — 銘柄比較</h2>

        {/* フィルタ */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="hud-label w-16">Grade</span>
            {GRADES.map((g) => (
              <button
                key={g}
                onClick={() => toggleSet(grades, setGrades, g)}
                className={`px-2 py-0.5 rounded border text-sm font-mono transition-colors ${
                  grades.has(g) ? "border-arc/60 text-arc bg-arc/10 shadow-arc" : "border-line text-arcdim"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hud-label w-16">状態</span>
            {STATUSES.map((st) => (
              <button
                key={st}
                onClick={() => toggleSet(statuses, setStatuses, st)}
                className={`px-2 py-0.5 rounded border text-xs font-display tracking-wider transition-colors ${
                  statuses.has(st) ? "border-arc/60 text-arc bg-arc/10 shadow-arc" : "border-line text-arcdim"
                }`}
              >
                {st}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hud-label w-16">ソート</span>
            <select className="hud-input w-44" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            {(grades.size > 0 || statuses.size > 0) && (
              <button
                className="hud-btn text-xs px-2 py-0.5"
                onClick={() => {
                  setGrades(new Set());
                  setStatuses(new Set());
                }}
              >
                フィルタ解除
              </button>
            )}
          </div>
        </div>
      </section>

      {/* JARVIS 分析コメント（比較選択の先頭 or 上位銘柄） */}
      {(() => {
        const focus = compareRows[0] ?? filtered[0];
        if (!focus) return null;
        return (
          <JarvisCommentPanel
            key={focus.stock.id}
            title={`JARVIS COMMENT — ${focus.stock.name} (${focus.stock.code})`}
            stock={focus.stock}
            scoreResult={focus.result}
            alerts={stockAlerts(focus.stock)}
          />
        );
      })()}

      {/* 比較パネル */}
      {compareRows.length >= 2 && (
        <section className="hud-panel p-4 overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">⚔ 比較モード（{compareRows.length}銘柄）</h2>
            <button className="hud-btn text-xs px-2 py-0.5" onClick={() => setCompareIds([])}>選択解除</button>
          </div>
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                <th className="pb-2 pr-4 font-normal">指標</th>
                {compareRows.map((r) => (
                  <th key={r.stock.id} className="pb-2 pr-4 font-normal text-arc">
                    {r.stock.name} <span className="text-arcdim">({r.stock.code})</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const values = m.num ? compareRows.map((r) => m.num!(r)) : [];
                return (
                  <tr key={m.label} className="border-t border-line/50">
                    <td className="py-1.5 pr-4 text-arcdim">{m.label}</td>
                    {compareRows.map((r) => {
                      const raw = m.get(r);
                      const color = m.num ? cellColor(m.dir, m.num(r), values) : "";
                      const gcolor = m.label === "Grade" && typeof raw === "string" ? gradeTone[raw as ScoreResult["grade"]] : "";
                      return (
                        <td key={r.stock.id} className={`py-1.5 pr-4 ${color} ${gcolor}`}>
                          {raw == null ? "—" : raw}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-arcdim text-xs mt-2">最良値=<span className="text-arc">青</span> / 危険値=<span className="text-danger">赤</span> / 中立=白</p>
        </section>
      )}

      {/* 比較テーブル */}
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">
          銘柄一覧 ({filtered.length}) — 比較選択 {compareIds.length}/{MAX_COMPARE}
        </h2>
        {filtered.length === 0 ? (
          <p className="text-arcdim text-sm">該当銘柄なし。フィルタ条件を確認してください。</p>
        ) : (
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-sm font-mono whitespace-nowrap">
              <thead className="sticky top-0 z-10">
                <tr className="hud-label text-left bg-panel">
                  {["", "コード", "銘柄名", "Grade", "Score", "推奨", "PER", "PBR", "ROE", "利益率", "成長率", "RSI", "相対出来高", "MACD", "現在価格", "損益率", "状態", "保有"].map((h) => (
                    <th key={h} className="pb-2 pr-3 font-normal bg-panel">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const s = r.stock;
                  const selected = compareIds.includes(s.id);
                  const disabled = !selected && compareIds.length >= MAX_COMPARE;
                  return (
                    <tr key={s.id} className={`border-t border-line/60 ${selected ? "bg-arc/5" : ""}`}>
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={disabled}
                          onChange={() => toggleCompare(s.id)}
                          className="accent-[#6fe3ff]"
                        />
                      </td>
                      <td className="py-2 pr-3">{s.code}</td>
                      <td className="py-2 pr-3">{s.name}</td>
                      <td className={`py-2 pr-3 ${gradeTone[r.result.grade]}`}>{r.result.grade}</td>
                      <td className={`py-2 pr-3 rounded ${scoreHeat(r.result.score)}`}>{r.result.score}</td>
                      <td className="py-2 pr-3 text-arcdim">{r.result.recommendation}</td>
                      <td className="py-2 pr-3">{nn(s.per)}</td>
                      <td className="py-2 pr-3">{nn(s.pbr)}</td>
                      <td className="py-2 pr-3">{nn(s.roe)}</td>
                      <td className="py-2 pr-3">{nn(s.operating_margin)}</td>
                      <td className="py-2 pr-3">{nn(s.sales_growth)}</td>
                      <td className={`py-2 pr-3 ${s.rsi != null && s.rsi >= 80 ? "text-caution" : ""}`}>{nn(s.rsi)}</td>
                      <td className={`py-2 pr-3 ${s.relativeVolume != null && s.relativeVolume >= 1.5 ? "text-arc" : s.relativeVolume != null && s.relativeVolume < 0.5 ? "text-danger" : ""}`}>
                        {s.relativeVolume != null ? `${s.relativeVolume}x` : "—"}
                      </td>
                      <td className="py-2 pr-3">{s.macd}</td>
                      <td className="py-2 pr-3">{s.current_price != null ? `¥${fmt(s.current_price)}` : "—"}</td>
                      <td className={`py-2 pr-3 ${r.pnlPct == null ? "" : r.pnlPct >= 0 ? "text-profit" : "text-danger"}`}>
                        {r.pnlPct == null ? "—" : `${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(2)}%`}
                      </td>
                      <td className="py-2 pr-3">{s.status}</td>
                      <td className="py-2 pr-3">{r.held ? <span className="text-arc">保有</span> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
