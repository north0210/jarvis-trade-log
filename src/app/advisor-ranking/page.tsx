"use client";

/**
 * Phase 62 (v1.7): Advisor ランキング。
 * 登録銘柄を Advisor Score 順に順位化。買い候補・監視・危険を一目で確認。
 * 完全ローカル・外部API不使用・投資助言ではない。
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import { scoreStock } from "@/lib/score";
import { updateStockPrice } from "@/lib/pricing/priceUpdater";
import { computeAdvisorContext } from "@/lib/advisor/advisor-context";
import { rankingComment, DISCLAIMER_LINE } from "@/lib/advisor/ranking";
import { listFavorites, toggleFavorite } from "@/lib/advisor/favorites";
import { CATEGORY_LABELS, type AdvisorCategory } from "@/lib/advisor/advisorTypes";
import type { Stock } from "@/lib/types";
import { K } from "@/lib/storage/keys";

const SETTINGS_KEY = K.rankingSettings;

type SortKey = "score" | "grade" | "pf" | "cagr" | "dd" | "winRate" | "expectedValue" | "rsi" | "per" | "roe" | "updated";
type FilterKey = "all" | "fav" | "strongBuy" | "buyPlus" | "watchPlus" | "danger" | "jp" | "us" | "missing" | "bt" | "nobt" | "manual" | "auto";

interface Row {
  rank: number;
  code: string;
  name: string;
  score: number;
  grade: string;
  category: AdvisorCategory;
  composite: number;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  rsi: number | null;
  macd: string;
  pf: number | null;
  cagr: number | null;
  maxDD: number | null;
  winRate: number | null;
  expectedValue: number | null;
  updatedAt: string | null;
  missing: string[];
  isJP: boolean;
  hasBt: boolean;
  auto: boolean;
  comment: string;
  reasons: string[];
  breakdown: string[];
}

const GRADE_RANK: Record<string, number> = { S: 7, "A+": 6, A: 5, "B+": 4, B: 3, C: 2, D: 1 };
const DANGER_CATS = new Set<AdvisorCategory>(["danger", "sellCandidate", "reduce"]);
const catTone: Record<AdvisorCategory, string> = {
  strongBuy: "text-profit", buy: "text-arc", watch: "text-arc", hold: "text-arcdim",
  partialTP: "text-caution", reduce: "text-caution", sellCandidate: "text-danger", danger: "text-danger", avoid: "text-arcdim",
};

function missingOf(s: Stock): string[] {
  const m: string[] = [];
  if (s.per == null) m.push("PER");
  if (s.pbr == null) m.push("PBR");
  if (s.roe == null) m.push("ROE");
  if (s.operating_margin == null) m.push("営業利益率");
  if (s.sales_growth == null) m.push("売上成長率");
  if (s.rsi == null) m.push("RSI");
  if (s.current_price == null) m.push("現在価格");
  return m;
}

export default function AdvisorRankingPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sort, setSort] = useState<SortKey>("score");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [excludeHot, setExcludeHot] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [favs, setFavs] = useState<string[]>([]);
  const toggleFav = (code: string) => setFavs(toggleFavorite(code));

  const load = async () => {
    const { report, stocksByCode } = await computeAdvisorContext();
    const built: Row[] = report.items.map((it) => {
      const s = stocksByCode[it.code];
      const miss = s ? missingOf(s) : [];
      return {
        rank: 0,
        code: it.code,
        name: it.name,
        score: it.score,
        grade: it.grade,
        category: it.category,
        composite: it.composite,
        per: s?.per ?? null,
        pbr: s?.pbr ?? null,
        roe: s?.roe ?? null,
        rsi: s?.rsi ?? null,
        macd: s?.macd ?? "不明",
        pf: it.bt?.pf ?? null,
        cagr: it.bt?.cagr ?? null,
        maxDD: it.bt?.maxDD ?? null,
        winRate: it.bt?.winRate ?? null,
        expectedValue: it.bt?.expectedValue ?? null,
        updatedAt: s?.price_updated_at ?? null,
        missing: miss,
        isJP: /^\d+$/.test(it.code),
        hasBt: it.bt != null,
        auto: !!s?.price_updated_at,
        comment: rankingComment(it, miss.length),
        reasons: it.reasons,
        breakdown: s ? scoreStock(s).reasons : [],
      };
    });
    setRows(built);
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.sort) setSort(p.sort);
        if (p.filter) setFilter(p.filter);
        if (typeof p.excludeHot === "boolean") setExcludeHot(p.excludeHot);
      }
    } catch {
      /* ignore */
    }
    setFavs(listFavorites());
    load();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sort, filter, excludeHot }));
    } catch {
      /* ignore */
    }
  }, [sort, filter, excludeHot]);

  const view = useMemo(() => {
    if (!rows) return [];
    let r = rows.slice();
    // フィルター
    if (filter === "fav") r = r.filter((x) => favs.includes(x.code));
    else if (filter === "strongBuy") r = r.filter((x) => x.category === "strongBuy");
    else if (filter === "buyPlus") r = r.filter((x) => x.category === "strongBuy" || x.category === "buy");
    else if (filter === "watchPlus") r = r.filter((x) => ["strongBuy", "buy", "watch"].includes(x.category));
    else if (filter === "danger") r = r.filter((x) => DANGER_CATS.has(x.category));
    else if (filter === "jp") r = r.filter((x) => x.isJP);
    else if (filter === "us") r = r.filter((x) => !x.isJP);
    else if (filter === "missing") r = r.filter((x) => x.missing.length > 0);
    else if (filter === "bt") r = r.filter((x) => x.hasBt);
    else if (filter === "nobt") r = r.filter((x) => !x.hasBt);
    else if (filter === "manual") r = r.filter((x) => !x.auto);
    else if (filter === "auto") r = r.filter((x) => x.auto);
    if (excludeHot) r = r.filter((x) => x.rsi == null || x.rsi < 80);
    // ソート
    const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
      score: (a, b) => b.composite - a.composite,
      grade: (a, b) => (GRADE_RANK[b.grade] ?? 0) - (GRADE_RANK[a.grade] ?? 0),
      pf: (a, b) => (b.pf ?? -1) - (a.pf ?? -1),
      cagr: (a, b) => (b.cagr ?? -999) - (a.cagr ?? -999),
      dd: (a, b) => (a.maxDD ?? 999) - (b.maxDD ?? 999),
      winRate: (a, b) => (b.winRate ?? -1) - (a.winRate ?? -1),
      expectedValue: (a, b) => (b.expectedValue ?? -999) - (a.expectedValue ?? -999),
      rsi: (a, b) => (a.rsi ?? 999) - (b.rsi ?? 999),
      per: (a, b) => (a.per ?? 9999) - (b.per ?? 9999),
      roe: (a, b) => (b.roe ?? -999) - (a.roe ?? -999),
      updated: (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    };
    r.sort(cmp[sort]);
    return r.map((x, i) => ({ ...x, rank: i + 1 }));
  }, [rows, sort, filter, excludeHot, favs]);

  const dangerRows = useMemo(() => (rows ?? []).filter((x) => DANGER_CATS.has(x.category)).sort((a, b) => a.composite - b.composite), [rows]);
  const missingRows = useMemo(() => (rows ?? []).filter((x) => x.missing.length > 0), [rows]);

  const doUpdate = async (code: string) => {
    const { stocksByCode } = await computeAdvisorContext();
    const s = stocksByCode[code];
    if (!s) return;
    setBusy(code);
    await updateStockPrice(s.id);
    setBusy(null);
    await load();
  };

  return (
    <div className="space-y-6">
      <PageIntro title="🏁 Advisor ランキング" description="登録銘柄を Advisor Score 順に順位化。買い候補・監視・危険を一目で確認します。判断補助であり投資助言ではありません。" helpKey="advisorscore" />

      {!rows ? (
        <section className="hud-panel p-4"><p className="text-arcdim text-sm">算出中です、ボス…</p></section>
      ) : rows.length === 0 ? (
        <section className="hud-panel p-4">
          <p className="text-arcdim text-sm">まだランキング対象がありません。銘柄を登録し、価格更新を実行してください、ボス。</p>
          <Link href="/stocks" className="hud-btn text-xs px-3 py-1 mt-2 inline-block">銘柄管理へ →</Link>
        </section>
      ) : (
        <>
          <section className="hud-panel p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="hud-label">並び替え</span>
                <select className="hud-input mt-1 w-40" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  <option value="score">Advisor Score順</option>
                  <option value="grade">Grade順</option>
                  <option value="pf">PF順</option>
                  <option value="cagr">CAGR順</option>
                  <option value="dd">DD小さい順</option>
                  <option value="winRate">勝率順</option>
                  <option value="expectedValue">期待値順</option>
                  <option value="rsi">RSI（低い順）</option>
                  <option value="per">PER（低い順）</option>
                  <option value="roe">ROE（高い順）</option>
                  <option value="updated">更新日時順</option>
                </select>
              </label>
              <label className="block">
                <span className="hud-label">フィルター</span>
                <select className="hud-input mt-1 w-44" value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
                  <option value="all">すべて</option>
                  <option value="fav">お気に入り</option>
                  <option value="strongBuy">Strong Buyのみ</option>
                  <option value="buyPlus">Buy以上</option>
                  <option value="watchPlus">Watch以上</option>
                  <option value="danger">Dangerのみ</option>
                  <option value="jp">日本株</option>
                  <option value="us">米国株</option>
                  <option value="missing">データ不足</option>
                  <option value="bt">BT済み</option>
                  <option value="nobt">未BT</option>
                  <option value="manual">手入力銘柄</option>
                  <option value="auto">自動取得済み</option>
                </select>
              </label>
              <label className="flex items-center gap-2 pb-1">
                <input type="checkbox" className="accent-arc" checked={excludeHot} onChange={(e) => setExcludeHot(e.target.checked)} />
                <span className="text-sm font-mono text-arcdim">RSI過熱(80+)除外</span>
              </label>
              <span className="hud-label ml-auto">{view.length} 件</span>
            </div>
          </section>

          <section className="hud-panel p-4 overflow-x-auto">
            <h2 className="hud-label mb-3">ランキング</h2>
            {view.length === 0 ? (
              <p className="text-arcdim text-sm">条件に一致する銘柄がありません。</p>
            ) : (
              <table className="w-full text-sm font-mono whitespace-nowrap">
                <thead>
                  <tr className="hud-label text-left">
                    {["★", "#", "コード", "銘柄", <HelpTooltip key="s" termKey="advisorscore" label="Score" />, "Grade", "判定", "PER", "PBR", "ROE", "RSI", "MACD", <HelpTooltip key="pf" termKey="pf" label="PF" />, <HelpTooltip key="c" termKey="cagr" label="CAGR" />, <HelpTooltip key="d" termKey="dd" label="最大DD" />, "勝率", "期待値", "更新", ""].map((h, i) => <th key={i} className="pb-2 pr-3 font-normal">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {view.map((r) => (
                    <Fragment key={r.code}>
                      <tr className="border-t border-line/60">
                        <td className="py-1 pr-2">
                          <button onClick={() => toggleFav(r.code)} className={favs.includes(r.code) ? "text-caution" : "text-arcdim hover:text-caution"} aria-label="お気に入り">{favs.includes(r.code) ? "★" : "☆"}</button>
                        </td>
                        <td className="py-1 pr-3 text-arcdim">{r.rank}</td>
                        <td className="py-1 pr-3 text-arc">{r.code}{!r.isJP && <span className="text-[10px] text-arcdim"> US</span>}</td>
                        <td className="py-1 pr-3">{r.name}{r.missing.length > 0 && <span className="ml-1 text-[10px] text-caution border border-caution/50 rounded px-1">不足</span>}</td>
                        <td className="py-1 pr-3 text-arc">{r.composite}</td>
                        <td className="py-1 pr-3">{r.grade}</td>
                        <td className={`py-1 pr-3 ${catTone[r.category]}`}>{CATEGORY_LABELS[r.category].split("（")[0]}</td>
                        <td className="py-1 pr-3">{r.per ?? "—"}</td>
                        <td className="py-1 pr-3">{r.pbr ?? "—"}</td>
                        <td className="py-1 pr-3">{r.roe ?? "—"}</td>
                        <td className={`py-1 pr-3 ${r.rsi != null && r.rsi >= 80 ? "text-caution" : ""}`}>{r.rsi != null ? r.rsi.toFixed(0) : "—"}</td>
                        <td className="py-1 pr-3">{r.macd}</td>
                        <td className="py-1 pr-3">{r.pf != null ? r.pf.toFixed(2) : "—"}</td>
                        <td className="py-1 pr-3">{r.cagr != null ? `${r.cagr.toFixed(0)}%` : "—"}</td>
                        <td className="py-1 pr-3 text-caution">{r.maxDD != null ? `${r.maxDD.toFixed(0)}%` : "—"}</td>
                        <td className="py-1 pr-3">{r.winRate != null ? `${(r.winRate * 100).toFixed(0)}%` : "—"}</td>
                        <td className="py-1 pr-3">{r.expectedValue != null ? `${r.expectedValue.toFixed(1)}%` : "—"}</td>
                        <td className="py-1 pr-3 text-arcdim">{r.updatedAt ? r.updatedAt.slice(0, 10) : "手入力"}</td>
                        <td className="py-1 pr-3"><button className="hud-btn text-xs px-2 py-0.5" onClick={() => setExpanded(expanded === r.code ? null : r.code)}>内訳</button></td>
                      </tr>
                      {expanded === r.code && (
                        <tr className="bg-arc/5">
                          <td colSpan={19} className="py-2 px-3">
                            <p className="text-xs text-arc font-mono">{r.comment}</p>
                            <p className="hud-label mt-2">Score内訳（JARVIS Score）</p>
                            <ul className="grid sm:grid-cols-2 md:grid-cols-3 gap-x-4 text-xs font-mono text-[#cfeaff]">
                              {r.breakdown.map((b, i) => <li key={i}>・{b}</li>)}
                            </ul>
                            <p className="hud-label mt-2">Advisor理由</p>
                            <ul className="grid sm:grid-cols-2 gap-x-4 text-xs font-mono text-[#cfeaff]">
                              {r.reasons.map((b, i) => <li key={i}>・{b}</li>)}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-xs text-arcdim mt-2">{DISCLAIMER_LINE}</p>
          </section>

          {dangerRows.length > 0 && (
            <section className="hud-panel p-4 border-danger/40">
              <h2 className="hud-label mb-3 text-danger">⚠ 危険銘柄ランキング（Danger / Sell / Reduce）</h2>
              <ul className="space-y-1">
                {dangerRows.map((r) => (
                  <li key={r.code} className="text-sm font-mono">
                    <span className="text-danger">{r.code} {r.name}</span>
                    <span className="text-arcdim"> — 合成{r.composite} / {CATEGORY_LABELS[r.category].split("（")[0]} / {r.reasons.slice(0, 4).join(" / ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {missingRows.length > 0 && (
            <section className="hud-panel p-4 border-caution/40">
              <h2 className="hud-label mb-3 text-caution">◇ データ不足銘柄（Advisor精度が下がります）</h2>
              <ul className="space-y-2">
                {missingRows.map((r) => (
                  <li key={r.code} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-mono">
                      <span className="text-arc">{r.code} {r.name}</span>
                      <span className="text-caution"> — 不足: {r.missing.join(" / ")}</span>
                    </span>
                    <span className="flex gap-2">
                      <button className="hud-btn text-xs px-2 py-0.5" onClick={() => doUpdate(r.code)} disabled={busy === r.code}>{busy === r.code ? "更新中" : "自動更新"}</button>
                      <Link href="/stocks" className="hud-btn text-xs px-2 py-0.5">手入力 →</Link>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-arcdim mt-2">PER/PBR/ROE/営業利益率/売上成長率 は手入力（自動取得不可）。価格/RSI/MACD/出来高は「自動更新」で取得します。</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
