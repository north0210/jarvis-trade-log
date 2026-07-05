"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { getStockRepository, type StockInput } from "@/lib/storage/stockRepository";
import type { MacdState, Stock, StockRank, StockStatus } from "@/lib/types";
import { stockAlerts, type AlertLevel } from "@/lib/alerts";
import { stockVolumeAlerts } from "@/lib/alerts/volume-alerts";
import { scoreStock, type ScoreResult } from "@/lib/score";
import JarvisCommentPanel from "@/components/JarvisCommentPanel";
import HelpTooltip from "@/components/HelpTooltip";
import Link from "next/link";
import TradingViewChartModal from "@/components/TradingViewChartModal";
import { isTradingViewEnabled } from "@/lib/tradingview";
import { getProviderMode } from "@/lib/pricing/settings";
import { updateAllPrices, updateStockPrice } from "@/lib/pricing/priceUpdater";
import { updateAllFundamentals } from "@/lib/pricing/fundamentalsUpdater";
import { elapsedLabel } from "@/lib/pricing/fundamentals";
import { quickSetup, type QuickSetupResult } from "@/lib/advisor/quick-setup";

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
  const [priceProgress, setPriceProgress] = useState<{ done: number; total: number } | null>(null);
  const bulkAbortRef = useRef<AbortController | null>(null);
  const [funding, setFunding] = useState(false);
  const [fundProgress, setFundProgress] = useState<{ done: number; total: number } | null>(null);
  const fundAbortRef = useRef<AbortController | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [quickCode, setQuickCode] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickResult, setQuickResult] = useState<QuickSetupResult | null>(null);

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

  const doQuickSetup = async () => {
    setQuickBusy(true);
    const r = await quickSetup(quickCode, quickName);
    setQuickResult(r);
    setQuickBusy(false);
    if (r.ok) {
      setQuickCode("");
      setQuickName("");
      await load();
    }
  };

  const doUpdateOne = async (id: string) => {
    setUpdatingId(id);
    const r = await updateStockPrice(id);
    setUpdatingId(null);
    setPriceMsg(r.message);
    await load();
  };

  // 価格更新: 手入力モードは案内のみ。J-Quantsモードは共通サービスで一括更新。
  const updatePrices = async () => {
    if (getProviderMode() === "manual") {
      setPriceMsg("現在は手入力モードです。価格は銘柄情報の「現在価格」を編集して更新してください。");
      return;
    }
    const controller = new AbortController();
    bulkAbortRef.current = controller;
    setUpdating(true);
    setPriceProgress(null);
    setPriceMsg("価格データ取得中です、ボス…");
    const r = await updateAllPrices({
      signal: controller.signal,
      onProgress: (p) => setPriceProgress({ done: p.done, total: p.total }),
    });
    setUpdating(false);
    setPriceProgress(null);
    bulkAbortRef.current = null;
    const rsiMsg = r.ok
      ? r.rsiCount > 0
        ? ` RSIを自動計算しました（${r.rsiCount}件）。`
        : " RSI算出に必要な日足データが不足しています。"
      : "";
    setPriceMsg(`${r.message}（成功：${r.successCount}件 / 失敗：${r.failedCount}件）${rsiMsg}`);
    load();
  };

  // 財務指標更新: J-Quants /fins/summary から PER/PBR/ROE/営業利益率/売上成長率 を自動反映。
  const updateFundamentals = async () => {
    if (getProviderMode() === "manual") {
      setPriceMsg("現在は手入力モードです。財務指標の自動取得には設定画面で J-Quants モードに切り替えてください。");
      return;
    }
    const controller = new AbortController();
    fundAbortRef.current = controller;
    setFunding(true);
    setFundProgress(null);
    setPriceMsg("財務データ取得中です、ボス…（決算開示ベース・遅延あり）");
    const r = await updateAllFundamentals({
      signal: controller.signal,
      onProgress: (p) => setFundProgress({ done: p.done, total: p.total }),
    });
    setFunding(false);
    setFundProgress(null);
    fundAbortRef.current = null;
    setPriceMsg(`${r.message}（更新：${r.successCount}件 / ${r.fieldCount}指標）。PER/PBR は現在値×最新決算で算出。ROEはEPS/BPS近似。`);
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
      <section className="hud-panel p-4 border-arc/40 shadow-arc">
        <h2 className="hud-label mb-2">⚡ クイックセットアップ（コード入力→自動評価）</h2>
        <p className="text-xs text-arcdim mb-3">
          銘柄コードを入力すると、登録 → 価格/RSI/MACD/出来高 自動取得 → Advisor評価 → AIコメント → 保存 を一括実行します。
          PER/PBR/ROE/営業利益率/売上成長率 は「財務指標更新」で自動取得（決算開示ベース）。取得できない指標は手入力値を維持します。判断補助であり投資助言ではありません。
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="hud-label">銘柄コード *</span>
            <input className="hud-input mt-1 w-28" value={quickCode} onChange={(e) => setQuickCode(e.target.value)} placeholder="7203" />
          </label>
          <label className="block">
            <span className="hud-label">銘柄名（任意）</span>
            <input className="hud-input mt-1 w-48" value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder="トヨタ自動車" />
          </label>
          <button className="hud-btn" onClick={doQuickSetup} disabled={quickBusy || !quickCode.trim()}>{quickBusy ? "処理中…" : "自動セットアップ"}</button>
        </div>
        {quickResult && (
          <div className="mt-3 rounded border border-line/60 p-3">
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-display text-arc">{quickResult.name}（{quickResult.code}）</span>
              <span className="font-mono">Score <span className="text-arc text-lg">{quickResult.score}</span> / Grade {quickResult.grade}</span>
              {quickResult.advisor && <span className="font-mono">Advisor <span className="text-arc">{quickResult.advisor.grade}</span>（{quickResult.advisor.category}）</span>}
            </div>
            <p className="text-xs font-mono mt-2"><span className="text-arcdim">自動取得: </span><span className="text-profit">{quickResult.autoFilled.join(" / ") || "なし"}</span></p>
            {quickResult.missing.length > 0 && (
              <p className="text-xs font-mono mt-1"><span className="text-arcdim">要手入力（データなし）: </span><span className="text-caution">{quickResult.missing.join(" / ")}</span></p>
            )}
            {quickResult.advisor && (
              <ul className="mt-2 grid sm:grid-cols-2 gap-x-4 text-xs font-mono text-[#cfeaff]">
                {quickResult.advisor.reasons.map((r, i) => <li key={i}>・{r}</li>)}
              </ul>
            )}
            {quickResult.aiComment && (
              <div className="mt-2 rounded border border-arc/30 p-2">
                <p className="text-arcdim text-xs">AIコメント（ローカル・判断補助）</p>
                <p className="text-xs font-mono text-[#cfeaff] whitespace-pre-wrap">{quickResult.aiComment}</p>
              </div>
            )}
            <p className="text-xs text-arcdim mt-2">{quickResult.priceMsg}</p>
            <div className="mt-2 flex gap-2">
              {quickResult.missing.length > 0 && (
                <button className="hud-btn text-xs px-3 py-1" onClick={() => { const t = stocks.find((x) => x.code === quickResult.code); if (t) edit(t); }}>ファンダを手入力 →</button>
              )}
              <Link href="/advisor" className="hud-btn text-xs px-3 py-1">Advisorで確認 →</Link>
            </div>
          </div>
        )}
      </section>

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
          <div className="flex items-center gap-2">
            <Link href="/advisor" className="hud-btn text-xs px-3 py-1">Advisorで再評価 →</Link>
            <button className="hud-btn text-xs px-3 py-1" onClick={updatePrices} disabled={updating || funding}>
              {updating ? "更新中…" : "価格更新（一括）"}
            </button>
            {updating && (
              <>
                {priceProgress && (
                  <span className="text-arc text-xs">{priceProgress.done}/{priceProgress.total} 件</span>
                )}
                <button className="hud-btn text-xs px-3 py-1" onClick={() => bulkAbortRef.current?.abort()}>
                  中断
                </button>
              </>
            )}
            <button className="hud-btn text-xs px-3 py-1" onClick={updateFundamentals} disabled={updating || funding}>
              {funding ? "更新中…" : "財務指標更新（一括）"}
            </button>
            {funding && (
              <>
                {fundProgress && (
                  <span className="text-arc text-xs">{fundProgress.done}/{fundProgress.total} 件</span>
                )}
                <button className="hud-btn text-xs px-3 py-1" onClick={() => fundAbortRef.current?.abort()}>
                  中断
                </button>
              </>
            )}
          </div>
        </div>
        <p className="text-xs text-arcdim mb-3">
          価格更新で 現在値/RSI/MACD/相対出来高、財務指標更新で PER/PBR/ROE/営業利益率/売上成長率 を自動取得（J-Quantsモード）。
          財務は決算開示ベース（<strong className="text-caution">本決算/年次を優先</strong>のため、最新本決算が数ヶ月〜1年程度前になることがあります）。各行に開示日と経過・基準を併記。手入力値は自動取得できない指標のフォールバックとして維持されます。
        </p>
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
                    <td className="py-2 pr-3">
                      {s.name}
                      {(() => {
                        const miss = [s.per == null && "PER", s.pbr == null && "PBR", s.roe == null && "ROE", s.rsi == null && "RSI"].filter(Boolean);
                        return miss.length > 0 ? <span className="ml-1 text-[10px] text-caution border border-caution/50 rounded px-1">データ不足</span> : null;
                      })()}
                      <span className="block text-[10px] text-arcdim">
                        価格: {s.price_updated_at ? `自動取得 ${s.price_updated_at.slice(0, 10)}` : "未取得（手入力）"}
                      </span>
                      <span className="block text-[10px] text-arcdim">
                        財務: {s.fundamentals_updated_at
                          ? (() => {
                              const date = s.fundamentals_updated_at.slice(0, 10);
                              const basisJp = s.fundamentals_basis === "FY" ? "本決算" : s.fundamentals_basis === "quarter" ? "四半期" : null;
                              const parts = [basisJp, elapsedLabel(s.fundamentals_updated_at, Date.now())].filter(Boolean);
                              return `自動取得 ${date}${parts.length ? `（${parts.join("・")}）` : ""}`;
                            })()
                          : "手入力"}
                      </span>
                    </td>
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
                    <td className="py-2 flex flex-wrap gap-2">
                      <button className="hud-btn text-xs px-2 py-0.5" onClick={() => runScore(s)}>評価</button>
                      <button className="hud-btn text-xs px-2 py-0.5" onClick={() => doUpdateOne(s.id)} disabled={updatingId === s.id}>{updatingId === s.id ? "更新中" : "更新"}</button>
                      {tvEnabled && (
                        <button className="hud-btn text-xs px-2 py-0.5" onClick={() => setChartId(s.id)}>チャート</button>
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
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      {tvEnabled && chartId && (() => {
        const cs = stocks.find((x) => x.id === chartId);
        return cs ? <TradingViewChartModal code={cs.code} name={cs.name} onClose={() => setChartId(null)} /> : null;
      })()}
    </div>
  );
}
