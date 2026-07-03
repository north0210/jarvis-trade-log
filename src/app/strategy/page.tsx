"use client";

import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import {
  ensureSeeded,
  getPrimaryStrategyId,
  setPrimaryStrategyId,
  getStrategyRepository,
  type StrategyInput,
} from "@/lib/storage/strategyRepository";
import { getCashPosition, analyzePortfolio } from "@/lib/analysis/portfolio";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { scoreStock } from "@/lib/score";
import { matchStrategy, type MatchStatus } from "@/lib/strategy/match";
import { analyzeByStrategy, strategyPerfComments } from "@/lib/analysis/strategyPerf";
import type { Holding, Stock, Strategy, Trade } from "@/lib/types";

const tradeRepo = getTradeRepository();
const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const strategyRepo = getStrategyRepository();

const GRADES = ["S", "A", "B", "C", "D"];
type StratForm = {
  name: string;
  description: string;
  minScore: string;
  grades: string[];
  maxRsi: string;
  minRoe: string;
  minOpMargin: string;
  minSalesGrowth: string;
  maxPer: string;
  maxPbr: string;
  requiresStopLoss: boolean;
  maxPositionRate: string;
  targetProfitRate: string;
  maxLossRate: string;
  minRelVol: string;
  requiredVolumeTrend: string;
  avoidSpike: boolean;
};
const emptyForm: StratForm = {
  name: "",
  description: "",
  minScore: "",
  grades: [],
  maxRsi: "",
  minRoe: "",
  minOpMargin: "",
  minSalesGrowth: "",
  maxPer: "",
  maxPbr: "",
  requiresStopLoss: false,
  maxPositionRate: "",
  targetProfitRate: "",
  maxLossRate: "",
  minRelVol: "",
  requiredVolumeTrend: "",
  avoidSpike: false,
};
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
const strToForm = (s: Strategy): StratForm => ({
  name: s.name,
  description: s.description,
  minScore: s.minScore?.toString() ?? "",
  grades: [...s.allowedGrades],
  maxRsi: s.maxRsi?.toString() ?? "",
  minRoe: s.minRoe?.toString() ?? "",
  minOpMargin: s.minOperatingMargin?.toString() ?? "",
  minSalesGrowth: s.minSalesGrowth?.toString() ?? "",
  maxPer: s.maxPer?.toString() ?? "",
  maxPbr: s.maxPbr?.toString() ?? "",
  requiresStopLoss: s.requiresStopLoss,
  maxPositionRate: s.maxPositionRate?.toString() ?? "",
  targetProfitRate: s.targetProfitRate?.toString() ?? "",
  maxLossRate: s.maxLossRate?.toString() ?? "",
  minRelVol: s.minRelativeVolume?.toString() ?? "",
  requiredVolumeTrend: s.requiredVolumeTrend ?? "",
  avoidSpike: s.avoidVolumeSpikeWithHighRsi ?? false,
});
const formToInput = (f: StratForm): StrategyInput => ({
  name: f.name.trim(),
  description: f.description.trim(),
  minScore: numOrNull(f.minScore),
  allowedGrades: [...f.grades],
  maxRsi: numOrNull(f.maxRsi),
  minRoe: numOrNull(f.minRoe),
  minOperatingMargin: numOrNull(f.minOpMargin),
  minSalesGrowth: numOrNull(f.minSalesGrowth),
  maxPer: numOrNull(f.maxPer),
  maxPbr: numOrNull(f.maxPbr),
  requiresStopLoss: f.requiresStopLoss,
  maxPositionRate: numOrNull(f.maxPositionRate),
  targetProfitRate: numOrNull(f.targetProfitRate),
  maxLossRate: numOrNull(f.maxLossRate),
  minRelativeVolume: numOrNull(f.minRelVol),
  requiredVolumeTrend: f.requiredVolumeTrend === "increasing" || f.requiredVolumeTrend === "decreasing" || f.requiredVolumeTrend === "flat" ? f.requiredVolumeTrend : null,
  avoidVolumeSpikeWithHighRsi: f.avoidSpike,
});
function validateForm(f: StratForm): string | null {
  if (!f.name.trim()) return "戦略名は必須です。";
  const in0100 = (v: string, label: string) => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? null : `${label}は0〜100で入力してください。`;
  };
  const nonNeg = (v: string, label: string) => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? null : `${label}は0以上で入力してください。`;
  };
  return (
    in0100(f.minScore, "最小Score") ||
    in0100(f.maxRsi, "最大RSI") ||
    in0100(f.maxPositionRate, "最大保有比率") ||
    in0100(f.targetProfitRate, "目標利益率") ||
    in0100(f.maxLossRate, "最大損失率") ||
    nonNeg(f.maxPer, "最大PER") ||
    nonNeg(f.maxPbr, "最大PBR") ||
    nonNeg(f.minRoe, "最小ROE") ||
    nonNeg(f.minOpMargin, "最小営業利益率") ||
    nonNeg(f.minSalesGrowth, "最小売上成長率") ||
    nonNeg(f.minRelVol, "最小相対出来高")
  );
}

const statusMeta: Record<MatchStatus, { label: string; cls: string }> = {
  match: { label: "適合", cls: "text-arc" },
  partial: { label: "一部適合", cls: "text-caution" },
  nomatch: { label: "不適合", cls: "text-danger" },
};

function Criteria({ s }: { s: Strategy }) {
  const items: string[] = [];
  if (s.minScore != null) items.push(`Score ${s.minScore}以上`);
  if (s.allowedGrades.length) items.push(`Grade ${s.allowedGrades.join("/")}`);
  if (s.maxRsi != null) items.push(`RSI ${s.maxRsi}以下`);
  if (s.minRoe != null) items.push(`ROE ${s.minRoe}%以上`);
  if (s.minOperatingMargin != null) items.push(`営業利益率 ${s.minOperatingMargin}%以上`);
  if (s.minSalesGrowth != null) items.push(`売上成長率 ${s.minSalesGrowth}%以上`);
  if (s.maxPer != null) items.push(`PER ${s.maxPer}以下`);
  if (s.maxPbr != null) items.push(`PBR ${s.maxPbr}以下`);
  if (s.requiresStopLoss) items.push("損切り必須");
  if (s.maxPositionRate != null) items.push(`1銘柄比率 ${s.maxPositionRate}%以下`);
  if (s.targetProfitRate != null) items.push(`利確目安 ${s.targetProfitRate}%`);
  if (s.maxLossRate != null) items.push(`損切目安 ${s.maxLossRate}%`);
  if (s.minRelativeVolume != null) items.push(`相対出来高 ${s.minRelativeVolume}x以上`);
  if (s.requiredVolumeTrend) items.push(`出来高トレンド ${s.requiredVolumeTrend}`);
  if (s.avoidVolumeSpikeWithHighRsi) items.push("RSI高値+出来高急増を回避");
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((t) => (
        <span key={t} className="px-2 py-0.5 rounded border border-line text-xs font-mono text-arcdim">{t}</span>
      ))}
    </div>
  );
}

export default function StrategyPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [cash, setCash] = useState(0);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<StratForm>(emptyForm);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [s, h, strats, t] = await Promise.all([
        stockRepo.list(),
        holdingRepo.list(),
        ensureSeeded(),
        tradeRepo.list(),
      ]);
      setStocks(s);
      setHoldings(h);
      setCash(getCashPosition());
      setStrategies(strats);
      setTrades(t);
      const pid = getPrimaryStrategyId();
      setPrimaryId(pid);
      setSelectedId(pid && strats.some((x) => x.id === pid) ? pid : strats[0]?.id ?? "");
    })();
  }, []);

  const selected = strategies.find((s) => s.id === selectedId) ?? null;

  // 銘柄ごとの保有コンテキスト（比率・損切り有無）
  const ctxByStock = useMemo(() => {
    const port = analyzePortfolio(stocks, holdings, cash);
    const map = new Map<string, { positionRatio: number | null; hasStopLoss: boolean; held: boolean }>();
    for (const stock of stocks) {
      const hs = holdings.filter((h) => h.stock_id === stock.id);
      const held = hs.length > 0;
      const shares = hs.reduce((a, x) => a + x.shares, 0);
      const cost = hs.reduce((a, x) => a + x.buy_price * x.shares, 0);
      const value = held ? (stock.current_price != null ? stock.current_price * shares : cost) : 0;
      map.set(stock.id, {
        positionRatio: held && port.totalValue > 0 ? value / port.totalValue : null,
        hasStopLoss: hs.some((x) => x.stop_loss != null) || stock.stop_loss != null,
        held,
      });
    }
    return map;
  }, [stocks, holdings, cash]);

  const evaluated = useMemo(() => {
    if (!selected) return [];
    return stocks
      .map((stock) => {
        const ctx = ctxByStock.get(stock.id) ?? { positionRatio: null, hasStopLoss: false, held: false };
        const result = matchStrategy(selected, stock, scoreStock(stock), ctx);
        return { stock, result, held: ctx.held };
      })
      .sort((a, b) => {
        const order: MatchStatus[] = ["match", "partial", "nomatch"];
        return order.indexOf(a.result.status) - order.indexOf(b.result.status);
      });
  }, [selected, stocks, ctxByStock]);

  const counts = useMemo(() => {
    const c = { match: 0, partial: 0, nomatch: 0 };
    for (const e of evaluated) c[e.result.status]++;
    return c;
  }, [evaluated]);

  const comments = useMemo(() => {
    if (!selected) return [];
    const out: string[] = [`「${selected.name}」に適合 ${counts.match} 件、一部適合 ${counts.partial} 件、不適合 ${counts.nomatch} 件です。`];
    const heldViol = evaluated.filter((e) => e.held && e.result.violations.length > 0);
    if (heldViol.length) out.push(`保有中の ${heldViol.length} 銘柄が本戦略の条件に違反しています。`);
    if (selected.name.includes("見送り")) out.push("この型に適合する銘柄は、保有を避けることを推奨します、ボス。");
    else if (counts.match === 0) out.push("現時点で完全適合する銘柄はありません。焦らず候補を待ちましょう。");
    return out;
  }, [selected, counts, evaluated]);

  const perfStats = useMemo(() => analyzeByStrategy(trades, strategies), [trades, strategies]);
  const perfComments = useMemo(() => strategyPerfComments(perfStats), [perfStats]);

  const makePrimary = () => {
    if (!selectedId) return;
    setPrimaryStrategyId(selectedId);
    setPrimaryId(selectedId);
  };

  const reloadStrategies = async () => setStrategies(await strategyRepo.list());

  const openNew = () => {
    setEditId(null);
    setForm(emptyForm);
    setEditing(true);
    setSaveMsg(null);
  };
  const openEdit = (s: Strategy) => {
    setEditId(s.id);
    setForm(strToForm(s));
    setEditing(true);
    setSaveMsg(null);
  };
  const duplicate = async (s: Strategy) => {
    const { id, createdAt, ...rest } = s;
    void id;
    void createdAt;
    const copy = await strategyRepo.create({ ...rest, name: `${s.name} コピー` });
    await reloadStrategies();
    setSelectedId(copy.id);
    setSaveMsg(`「${s.name}」を複製しました。`);
  };
  const removeStrategy = async (s: Strategy) => {
    const usedCount = trades.filter((t) => t.strategyId === s.id).length;
    const warn = usedCount > 0 ? `\n※ ${usedCount} 件の取引履歴でこの戦略が使用中です。削除しても履歴は残りますが集計から外れます。` : "";
    if (!confirm(`戦略「${s.name}」を削除しますか？${warn}`)) return;
    await strategyRepo.remove(s.id);
    if (editId === s.id) setEditing(false);
    await reloadStrategies();
    const rest = await strategyRepo.list();
    if (selectedId === s.id) setSelectedId(rest[0]?.id ?? "");
    setSaveMsg(`「${s.name}」を削除しました。`);
  };
  const cancelEdit = () => {
    setEditing(false);
    setEditId(null);
  };
  const saveStrategy = async () => {
    const err = validateForm(form);
    if (err) {
      setSaveMsg(`⚠ ${err}`);
      return;
    }
    const input = formToInput(form);
    let saved: Strategy;
    if (editId) saved = await strategyRepo.update(editId, input);
    else saved = await strategyRepo.create(input);
    await reloadStrategies();
    setSelectedId(saved.id);
    setEditing(false);
    setEditId(null);
    setSaveMsg(
      input.requiresStopLoss
        ? "戦略を保存しました。次回のバックテストで有効性を確認してください。"
        : "戦略を保存しました。ただし損切り条件が未設定です。出口のない突撃は推奨しません、ボス。"
    );
  };
  const setF = (k: keyof StratForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggleGrade = (g: string) =>
    setForm((f) => ({ ...f, grades: f.grades.includes(g) ? f.grades.filter((x) => x !== g) : [...f.grades, g] }));

  return (
    <div className="space-y-6">
      <PageIntro title="◇ 戦略テンプレート" description="売買ルール（戦略）を作成・編集し、条件を管理します。" />
      <section className="hud-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="hud-label">✵ 戦略テンプレート ({strategies.length})</h2>
          <button className="hud-btn text-xs px-3 py-1" onClick={openNew}>＋ 新規作成</button>
        </div>
        {saveMsg && <p className={`text-sm font-mono mb-3 ${saveMsg.startsWith("⚠") ? "text-danger" : "text-profit"}`}>{saveMsg}</p>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {strategies.map((s) => (
            <div
              key={s.id}
              className={`p-3 rounded border transition-colors ${
                s.id === selectedId ? "border-arc/60 bg-arc/10 shadow-arc" : "border-line"
              }`}
            >
              <button className="text-left w-full" onClick={() => setSelectedId(s.id)}>
                <div className="flex items-center justify-between">
                  <span className="font-display text-arc">{s.name}</span>
                  {s.id === primaryId && <span className="hud-label text-profit">主戦略</span>}
                </div>
                <p className="text-arcdim text-xs mt-1 line-clamp-2">{s.description}</p>
              </button>
              <div className="flex gap-2 mt-2">
                <button className="hud-btn text-xs px-2 py-0.5" onClick={() => openEdit(s)}>編集</button>
                <button className="hud-btn text-xs px-2 py-0.5" onClick={() => duplicate(s)}>複製</button>
                <button className="hud-btn-danger" onClick={() => removeStrategy(s)}>削除</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {editing && (
        <section className="hud-panel p-4 border-arc/40 shadow-arc">
          <h2 className="hud-label mb-4">{editId ? "▲ 戦略を編集" : "＋ 戦略を新規作成"}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="block col-span-2">
              <span className="hud-label">戦略名 *</span>
              <input className="hud-input mt-1" value={form.name} onChange={(e) => setF("name", e.target.value)} placeholder="成長株スイング" />
            </label>
            <label className="block col-span-2">
              <span className="hud-label">説明</span>
              <input className="hud-input mt-1" value={form.description} onChange={(e) => setF("description", e.target.value)} />
            </label>
            {([
              ["最小Score", "minScore"],
              ["最大RSI", "maxRsi", "rsi"],
              ["最小ROE %", "minRoe", "roe"],
              ["最小営業利益率 %", "minOpMargin"],
              ["最小売上成長率 %", "minSalesGrowth"],
              ["最大PER", "maxPer", "per"],
              ["最大PBR", "maxPbr", "pbr"],
              ["最大保有比率 %", "maxPositionRate"],
              ["目標利益率 %", "targetProfitRate"],
              ["最大損失率 %", "maxLossRate"],
            ] as [string, string, string?][]).map(([label, key, term]) => (
              <label key={key} className="block">
                <span className="hud-label">{term ? <HelpTooltip termKey={term} label={label} /> : label}</span>
                <input className="hud-input mt-1" type="number" step="0.1" value={form[key as keyof StratForm] as string} onChange={(e) => setF(key as keyof StratForm, e.target.value)} />
              </label>
            ))}
            <label className="block">
              <span className="hud-label">損切り必須</span>
              <button
                className={`hud-btn mt-1 w-full ${form.requiresStopLoss ? "" : "opacity-60"}`}
                onClick={() => setForm((f) => ({ ...f, requiresStopLoss: !f.requiresStopLoss }))}
              >
                {form.requiresStopLoss ? "必須 ON" : "OFF"}
              </button>
            </label>
          </div>
          <div className="mt-3">
            <span className="hud-label">許可Grade</span>
            <div className="flex gap-2 mt-1">
              {GRADES.map((g) => (
                <button
                  key={g}
                  onClick={() => toggleGrade(g)}
                  className={`px-2 py-0.5 rounded border text-sm font-mono ${form.grades.includes(g) ? "border-arc/60 text-arc bg-arc/10" : "border-line text-arcdim"}`}
                >
                  {g}
                </button>
              ))}
              <span className="text-arcdim text-xs self-center ml-2">（未選択＝全Grade可）</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
            <label className="block">
              <span className="hud-label">最小相対出来高（x）</span>
              <input className="hud-input mt-1" type="number" step="0.1" value={form.minRelVol} onChange={(e) => setF("minRelVol", e.target.value)} placeholder="1.5" />
            </label>
            <label className="block">
              <span className="hud-label">必要出来高トレンド</span>
              <select className="hud-input mt-1" value={form.requiredVolumeTrend} onChange={(e) => setF("requiredVolumeTrend", e.target.value)}>
                <option value="">指定なし</option>
                <option value="increasing">増加</option>
                <option value="flat">横ばい</option>
                <option value="decreasing">減少</option>
              </select>
            </label>
            <label className="block">
              <span className="hud-label">RSI高値+出来高急増を回避</span>
              <button className={`hud-btn mt-1 w-full ${form.avoidSpike ? "" : "opacity-60"}`} onClick={() => setForm((f) => ({ ...f, avoidSpike: !f.avoidSpike }))}>
                {form.avoidSpike ? "回避 ON" : "OFF"}
              </button>
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button className="hud-btn" onClick={saveStrategy}>{editId ? "更新する" : "作成する"}</button>
            <button className="hud-btn-danger px-4 py-1.5 text-sm" onClick={cancelEdit}>キャンセル</button>
          </div>
        </section>
      )}

      {selected && (
        <>
          <section className="hud-panel p-4">
            <div className="flex items-center justify-between">
              <h2 className="hud-label">{selected.name}</h2>
              <button className="hud-btn text-xs px-3 py-1" onClick={makePrimary} disabled={selected.id === primaryId}>
                {selected.id === primaryId ? "主戦略に設定済み" : "主戦略に設定"}
              </button>
            </div>
            <p className="text-sm text-[#cfeaff] mt-2">{selected.description}</p>
            <Criteria s={selected} />
          </section>

          <div className="grid grid-cols-3 gap-4">
            <div className="hud-panel p-4"><p className="hud-label">適合</p><p className="font-mono text-2xl mt-1 text-arc">{counts.match}</p></div>
            <div className="hud-panel p-4"><p className="hud-label">一部適合</p><p className="font-mono text-2xl mt-1 text-caution">{counts.partial}</p></div>
            <div className="hud-panel p-4"><p className="hud-label">不適合</p><p className="font-mono text-2xl mt-1 text-danger">{counts.nomatch}</p></div>
          </div>

          <section className="hud-panel p-4 border-arc/40 shadow-arc">
            <h2 className="hud-label mb-3">◎ JARVIS 戦略コメント</h2>
            <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
              {comments.map((c, i) => <li key={i}>・{c}</li>)}
            </ul>
          </section>

          <section className="hud-panel p-4 overflow-x-auto">
            <h2 className="hud-label mb-3">銘柄適合判定</h2>
            {evaluated.length === 0 ? (
              <p className="text-arcdim text-sm">銘柄がありません。</p>
            ) : (
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="hud-label text-left">
                    {["銘柄", "判定", "保有", "違反項目"].map((h) => (
                      <th key={h} className="pb-2 pr-3 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {evaluated.map((e) => (
                    <tr key={e.stock.id} className="border-t border-line/60 align-top">
                      <td className="py-2 pr-3">{e.stock.name} <span className="opacity-60">({e.stock.code})</span></td>
                      <td className={`py-2 pr-3 ${statusMeta[e.result.status].cls}`}>{statusMeta[e.result.status].label}</td>
                      <td className="py-2 pr-3">{e.held ? <span className="text-arc">保有</span> : "—"}</td>
                      <td className="py-2 pr-3 whitespace-normal">
                        {e.result.violations.length === 0 ? (
                          <span className="text-arcdim">—</span>
                        ) : (
                          <ul className="text-danger space-y-0.5">
                            {e.result.violations.map((v, i) => <li key={i}>・{v}</li>)}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      <section className="hud-panel p-4 overflow-x-auto">
        <h2 className="hud-label mb-3">戦略別成績</h2>
        <div className="mb-3 border border-arc/40 bg-arc/5 rounded p-3">
          <p className="hud-label mb-1">◎ JARVIS 成績コメント</p>
          <ul className="space-y-1 text-sm font-mono text-arc leading-relaxed">
            {perfComments.map((c, i) => <li key={i}>・{c}</li>)}
          </ul>
        </div>
        {perfStats.length === 0 ? (
          <p className="text-arcdim text-sm">戦略に紐付いた取引がありません。売却時に戦略を選択すると集計されます。</p>
        ) : (
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {["#", "戦略", "取引", "勝率", "実現損益", "平均利益", "平均損失", "損益比", "平均保有"].map((h) => (
                  <th key={h} className="pb-2 pr-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perfStats.map((s, i) => (
                <tr key={s.id ?? "none"} className="border-t border-line/60">
                  <td className="py-2 pr-3 text-arc">{i + 1}</td>
                  <td className="py-2 pr-3">{s.name}</td>
                  <td className="py-2 pr-3">{s.count}</td>
                  <td className={`py-2 pr-3 ${s.winRate >= 0.5 ? "text-arc" : "text-danger"}`}>{(s.winRate * 100).toFixed(0)}%</td>
                  <td className={`py-2 pr-3 ${s.totalRealizedPnl >= 0 ? "text-profit" : "text-danger"}`}>{s.totalRealizedPnl >= 0 ? "+" : ""}¥{fmt(s.totalRealizedPnl)}</td>
                  <td className="py-2 pr-3 text-profit">+¥{fmt(s.avgWin)}</td>
                  <td className="py-2 pr-3 text-danger">¥{fmt(s.avgLoss)}</td>
                  <td className={`py-2 pr-3 ${s.profitFactor != null && s.profitFactor >= 1 ? "text-arc" : "text-danger"}`}>{s.profitFactor != null ? s.profitFactor.toFixed(2) : "—"}</td>
                  <td className="py-2 pr-3">{s.avgHoldingDays != null ? `${s.avgHoldingDays.toFixed(0)}日` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
