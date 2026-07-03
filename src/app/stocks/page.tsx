"use client";

import { Fragment, useEffect, useState } from "react";
import { getStockRepository, type StockInput } from "@/lib/storage/stockRepository";
import type { MacdState, Stock, StockRank, StockStatus } from "@/lib/types";
import { stockAlerts, type AlertLevel } from "@/lib/alerts";
import { stockVolumeAlerts } from "@/lib/alerts/volume-alerts";
import { scoreStock, type ScoreResult } from "@/lib/score";
import JarvisCommentPanel from "@/components/JarvisCommentPanel";
import HelpTooltip from "@/components/HelpTooltip";
import { isTradingViewEnabled } from "@/lib/tradingview";
import dynamic from "next/dynamic";
import { getProviderMode } from "@/lib/pricing/settings";
import { updateAllPrices } from "@/lib/pricing/priceUpdater";

const TradingViewChart = dynamic(() => import("@/components/TradingViewChart"), { ssr: false });
const repo = getStockRepository();

const gradeTone: Record<ScoreResult["grade"], string> = {
  S: "text-profit",
  A: "text-arc",
  B: "text-arc",
  C: "text-caution",
  D: "text-danger",
};

const STATUSES: StockStatus[] = ["買い候補", "押し目待ち", "保有中", "見送り", "危険"];
const RANKS: StockRank[] = ["S", "A", "B", "C"];
const MACDS: MacdState[] = ["ゴールデンクロス", "デッドクロス", "上昇中", "下降中", "横ばい", "不明"];

const empty = {
  code: "",
  name: "",
  market: "",
  theme: "",
  per: "",
  pbr: "",
  roe: "",
  sales_growth: "",
  operating_margin: "",
  rsi: "",
  macd: "不明" as MacdState,
  current_price: "",
  stop_loss: "",
  take_profit: "",
  rank: "B" as StockRank,
  status: "買い候補" as StockStatus,
  memo: "",
};
type Form = typeof empty;

const num = (v: string) => (v.trim() === "" ? null : Number(v));

export default function StocksPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scored, setScored] = useState<{ id: string; result: ScoreResult } | null>(null);
  const [chartId, setChartId] = useState<string | null>(null);
  const [tvEnabled, setTvEnabled] = useState(false);
  const [priceMsg, setPriceMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const load = async () => {
    setStocks(await repo.list());
  };
  useEffect(() => {
    load();
    setTvEnabled(isTradingViewEnabled());
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.code || !form.name) {
      alert("銘柄コードと銘柄名は必須です。");
      return;
    }
    setBusy(true);
    const payload: StockInput = {
      code: form.code.trim(),
      name: form.name.trim(),
      market: form.market || null,
      theme: form.theme || null,
      per: num(form.per),
      pbr: num(form.pbr),
      roe: num(form.roe),
      sales_growth: num(form.sales_growth),
      operating_margin: num(form.operating_margin),
      rsi: num(form.rsi),
      macd: form.macd,
      current_price: num(form.current_price),
      stop_loss: num(form.stop_loss),
      take_profit: num(form.take_profit),
      rank: form.rank,
      status: form.status,
      memo: form.memo || null,
      price_updated_at: form.current_price ? new Date().toISOString() : null,
    };
    try {
      if (editingId) await repo.update(editingId, payload);
      else await repo.create(payload);
    } catch (e) {
      setBusy(false);
      alert(`保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setBusy(false);
    setForm(empty);
    setEditingId(null);
    load();
  };

  const edit = (s: Stock) => {
    setEditingId(s.id);
    setForm({
      code: s.code,
      name: s.name,
      market: s.market ?? "",
      theme: s.theme ?? "",
      per: s.per?.toString() ?? "",
      pbr: s.pbr?.toString() ?? "",
      roe: s.roe?.toString() ?? "",
      sales_growth: s.sales_growth?.toString() ?? "",
      operating_margin: s.operating_margin?.toString() ?? "",
      rsi: s.rsi?.toString() ?? "",
      macd: s.macd,
      current_price: s.current_price?.toString() ?? "",
      stop_loss: s.stop_loss?.toString() ?? "",
      take_profit: s.take_profit?.toString() ?? "",
      rank: s.rank,
      status: s.status,
      memo: s.memo ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (id: string) => {
    if (!confirm("この銘柄を削除します。よろしいですか？")) return;
    await repo.remove(id);
    if (scored?.id === id) setScored(null);
    load();
  };

  // JARVIS Score Engine で自動採点（同じ行を再度押すと閉じる）
  const runScore = (s: Stock) =>
    setScored((prev) => (prev?.id === s.id ? null : { id: s.id, result: scoreStock(s) }));

  const toggleChart = (id: string) => setChartId((prev) => (prev === id ? null : id));

  // 価格更新: 手入力モードは案内のみ。J-Quantsモードは共通サービスで一括更新。
  const updatePrices = async () => {
    if (getProviderMode() === "manual") {
      setPriceMsg("現在は手入力モードです。価格は銘柄情報の「現在価格」を編集して更新してください。");
      return;
    }
    setUpdating(true);
    setPriceMsg("価格データ取得中です、ボス…");
    const r = await updateAllPrices();
    setUpdating(false);
    const rsiMsg = r.ok
      ? r.rsiCount > 0
        ? ` RSIを自動計算しました（${r.rsiCount}件）。`
        : " RSI算出に必要な日足データが不足しています。"
      : "";
    setPriceMsg(`${r.message}（成功：${r.successCount}件 / 失敗：${r.failedCount}件）${rsiMsg}`);
    load();
  };

  const field = (label: string, node: React.ReactNode) => (
    <label className="block">
      <span className="hud-label">{label}</span>
      <div className="mt-1">{node}</div>
    </label>
  );

  return (
    <div className="space-y-6">
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">
          {editingId ? "▲ 銘柄を編集" : "＋ 銘柄を登録"}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {field("銘柄コード *", <input className="hud-input" value={form.code} onChange={set("code")} placeholder="7203" />)}
          {field("銘柄名 *", <input className="hud-input" value={form.name} onChange={set("name")} placeholder="トヨタ自動車" />)}
          {field("市場", <input className="hud-input" value={form.market} onChange={set("market")} placeholder="東証プライム" />)}
          {field("テーマ", <input className="hud-input" value={form.theme} onChange={set("theme")} placeholder="EV / AI" />)}
          {field("PER", <input className="hud-input" type="number" step="0.1" value={form.per} onChange={set("per")} />)}
          {field("PBR", <input className="hud-input" type="number" step="0.01" value={form.pbr} onChange={set("pbr")} />)}
          {field("ROE %", <input className="hud-input" type="number" step="0.1" value={form.roe} onChange={set("roe")} />)}
          {field("売上成長率 %", <input className="hud-input" type="number" step="0.1" value={form.sales_growth} onChange={set("sales_growth")} />)}
          {field("営業利益率 %", <input className="hud-input" type="number" step="0.1" value={form.operating_margin} onChange={set("operating_margin")} />)}
          {field("RSI", <input className="hud-input" type="number" step="0.1" value={form.rsi} onChange={set("rsi")} />)}
          {field("MACD状態", (
            <select className="hud-input" value={form.macd} onChange={set("macd")}>
              {MACDS.map((m) => <option key={m}>{m}</option>)}
            </select>
          ))}
          {field("現在価格", <input className="hud-input" type="number" step="0.1" value={form.current_price} onChange={set("current_price")} />)}
          {field("損切りライン", <input className="hud-input" type="number" step="0.1" value={form.stop_loss} onChange={set("stop_loss")} />)}
          {field("利確目標", <input className="hud-input" type="number" step="0.1" value={form.take_profit} onChange={set("take_profit")} />)}
          {field("評価ランク", (
            <select className="hud-input" value={form.rank} onChange={set("rank")}>
              {RANKS.map((r) => <option key={r}>{r}</option>)}
            </select>
          ))}
          {field("状態", (
            <select className="hud-input" value={form.status} onChange={set("status")}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          ))}
        </div>
        <div className="mt-3">
          {field("メモ", <textarea className="hud-input" rows={2} value={form.memo} onChange={set("memo")} />)}
        </div>
        <div className="mt-4 flex gap-3">
          <button className="hud-btn" onClick={submit} disabled={busy}>
            {editingId ? "更新する" : "登録する"}
          </button>
          {editingId && (
            <button className="hud-btn-danger" onClick={() => { setEditingId(null); setForm(empty); }}>
              編集をやめる
            </button>
          )}
        </div>
      </section>

      <section className="hud-panel p-4 overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="hud-label">銘柄一覧 ({stocks.length})</h2>
          <button className="hud-btn text-xs px-3 py-1" onClick={updatePrices} disabled={updating}>
            {updating ? "更新中…" : "価格更新"}
          </button>
        </div>
        {priceMsg && (
          <p className="text-arc text-sm font-mono border border-arc/40 bg-arc/5 rounded px-3 py-2 mb-3">
            {priceMsg}
          </p>
        )}
        <table className="w-full text-sm font-mono whitespace-nowrap">
          <thead>
            <tr className="hud-label text-left">
              {([
                { h: "コード" }, { h: "銘柄名" }, { h: "状態" }, { h: "Rank" }, { h: "現在値" }, { h: "損切り" }, { h: "利確" },
                { h: "RSI", t: "rsi" }, { h: "相対出来高", t: "volume" }, { h: "MACD", t: "macd" }, { h: "PER", t: "per" }, { h: "ROE", t: "roe" }, { h: "" },
              ] as { h: string; t?: string }[]).map((c, i) => (
                <th key={c.h || `x${i}`} className="pb-2 pr-3 font-normal">
                  {c.t ? <HelpTooltip termKey={c.t} label={c.h} /> : c.h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => {
              // 行ハイライトは alerts.ts の判定を再利用（ロジックの重複実装はしない）
              const levels = stockAlerts(s).map((a) => a.level);
              const rowLevel: AlertLevel | null = levels.includes("danger")
                ? "danger" // 損切り到達/接近
                : levels.includes("caution")
                  ? "caution" // RSI>=80 過熱
                  : null;
              const rowColor =
                rowLevel === "danger"
                  ? "text-danger bg-danger/5"
                  : rowLevel === "caution"
                    ? "text-caution bg-caution/5"
                    : "";
              const sc = scored?.id === s.id ? scored.result : null;
              return (
                <Fragment key={s.id}>
                  <tr className={`border-t border-line/60 ${rowColor}`}>
                    <td className="py-2 pr-3">{s.code}</td>
                    <td className="py-2 pr-3">{s.name}</td>
                    <td className="py-2 pr-3">{s.status}</td>
                    <td className="py-2 pr-3 text-arc">{s.rank}</td>
                    <td className="py-2 pr-3">{s.current_price ?? "—"}</td>
                    <td className="py-2 pr-3">{s.stop_loss ?? "—"}</td>
                    <td className="py-2 pr-3">{s.take_profit ?? "—"}</td>
                    <td className={`py-2 pr-3 ${s.rsi != null && s.rsi >= 80 ? "text-caution" : ""}`}>{s.rsi ?? "—"}</td>
                    <td className={`py-2 pr-3 ${s.relativeVolume != null && s.relativeVolume >= 1.5 ? "text-arc" : s.relativeVolume != null && s.relativeVolume < 0.5 ? "text-danger" : ""}`}>
                      {s.relativeVolume != null ? `${s.relativeVolume}x` : "—"}
                    </td>
                    <td className="py-2 pr-3">{s.macd}</td>
                    <td className="py-2 pr-3">{s.per ?? "—"}</td>
                    <td className="py-2 pr-3">{s.roe ?? "—"}</td>
                    <td className="py-2 flex gap-2">
                      <button className="hud-btn text-xs px-2 py-0.5" onClick={() => runScore(s)}>評価</button>
                      {tvEnabled && (
                        <button className="hud-btn text-xs px-2 py-0.5" onClick={() => toggleChart(s.id)}>チャート</button>
                      )}
                      <button className="hud-btn text-xs px-2 py-0.5" onClick={() => edit(s)}>編集</button>
                      <button className="hud-btn-danger" onClick={() => remove(s.id)}>削除</button>
                    </td>
                  </tr>
                  {sc && (
                    <tr className="border-t border-line/40 bg-arc/5">
                      <td colSpan={13} className="py-3 px-3">
                        <div className="flex flex-wrap items-center gap-6">
                          <span className="hud-label">JARVIS SCORE</span>
                          <span className={`font-mono text-3xl ${gradeTone[sc.grade]}`}>{sc.score}</span>
                          <span className={`font-mono text-3xl ${gradeTone[sc.grade]}`}>{sc.grade}</span>
                          <span className="font-display text-lg text-arc">{sc.recommendation}</span>
                        </div>
                        <ul className="mt-2 grid sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs font-mono text-[#cfeaff]">
                          {sc.reasons.map((r, i) => (
                            <li key={i}>・{r}</li>
                          ))}
                        </ul>
                        {stockVolumeAlerts(s).length > 0 && (
                          <ul className="mt-3 space-y-1 text-xs font-mono">
                            {stockVolumeAlerts(s).map((a) => (
                              <li key={a.id} className={a.level === "danger" ? "text-danger" : a.level === "warning" ? "text-caution" : "text-arc"}>
                                ▪ {a.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-3">
                          <JarvisCommentPanel stock={s} scoreResult={sc} alerts={stockAlerts(s)} />
                        </div>
                      </td>
                    </tr>
                  )}
                  {tvEnabled && chartId === s.id && (
                    <tr className="border-t border-line/40 bg-void/40">
                      <td colSpan={13} className="py-3 px-3">
                        <TradingViewChart code={s.code} height={420} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
