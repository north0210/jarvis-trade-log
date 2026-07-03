"use client";

import { Fragment, useEffect, useState } from "react";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository, type HoldingInput } from "@/lib/storage/holdingRepository";
import type { Holding, Stock } from "@/lib/types";
import { holdingDangerLevel, pnl } from "@/lib/alerts";
import { scoreStock } from "@/lib/score";
import { isTradingViewEnabled } from "@/lib/tradingview";
import dynamic from "next/dynamic";
import HelpTooltip from "@/components/HelpTooltip";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { computeRealized, daysBetween } from "@/lib/analysis/trades";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import type { Strategy } from "@/lib/types";

const TradingViewChart = dynamic(() => import("@/components/TradingViewChart"), { ssr: false });
const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const tradeRepo = getTradeRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const num = (v: string) => (v.trim() === "" ? null : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

const empty = { stock_id: "", buy_price: "", shares: "", stop_loss: "", take_profit: "", memo: "" };
type Form = typeof empty;

export default function HoldingsPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chartId, setChartId] = useState<string | null>(null);
  const [buyMoreId, setBuyMoreId] = useState<string | null>(null);
  const [buyForm, setBuyForm] = useState({ price: "", shares: "" });
  const [tvEnabled, setTvEnabled] = useState(false);
  const [sellTarget, setSellTarget] = useState<Holding | null>(null);
  const [sellForm, setSellForm] = useState({ shares: "", price: "", reason: "利確", memo: "", strategyId: "" });
  const [strategies, setStrategies] = useState<Strategy[]>([]);

  const load = async () => {
    const [s, h] = await Promise.all([stockRepo.list(), holdingRepo.list()]);
    setStocks(s);
    // 銘柄マスタを join（localStorage は stock_id のみ保持するため）
    const byId = new Map(s.map((x) => [x.id, x]));
    setHoldings(h.map((x) => ({ ...x, stocks: byId.get(x.stock_id) })));
  };
  useEffect(() => {
    load();
    setTvEnabled(isTradingViewEnabled());
    ensureSeeded().then(setStrategies);
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggleChart = (id: string) => setChartId((prev) => (prev === id ? null : id));

  const resetForm = () => {
    setForm(empty);
    setEditingId(null);
  };

  const submit = async () => {
    if (!form.stock_id || !form.buy_price || !form.shares) {
      alert("銘柄・取得単価・株数は必須です。");
      return;
    }
    setBusy(true);
    const payload: HoldingInput = {
      stock_id: form.stock_id,
      buy_price: Number(form.buy_price),
      shares: Number(form.shares),
      stop_loss: num(form.stop_loss),
      take_profit: num(form.take_profit),
      memo: form.memo || null,
    };
    try {
      if (editingId) {
        await holdingRepo.update(editingId, payload);
      } else {
        const target = stocks.find((s) => s.id === form.stock_id);
        await holdingRepo.create({
          ...payload,
          score_at_entry: target ? scoreStock(target).score : null, // 取得時Scoreを記録
        });
        // 新規保有 → 銘柄状態を「保有中」へ
        if (target && target.status !== "保有中") {
          const { id, ...rest } = target;
          await stockRepo.update(id, { ...rest, status: "保有中" });
        }
      }
    } catch (e) {
      setBusy(false);
      alert(`保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setBusy(false);
    resetForm();
    load();
  };

  const edit = (h: Holding) => {
    setEditingId(h.id);
    setForm({
      stock_id: h.stock_id,
      buy_price: h.buy_price.toString(),
      shares: h.shares.toString(),
      stop_loss: h.stop_loss?.toString() ?? "",
      take_profit: h.take_profit?.toString() ?? "",
      memo: h.memo ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 売却モーダルを開く（対象銘柄の保有を集約して初期値を設定）
  const openSell = (h: Holding) => {
    const stock = stocks.find((s) => s.id === h.stock_id);
    const total = holdings.filter((x) => x.stock_id === h.stock_id).reduce((a, x) => a + x.shares, 0);
    setSellTarget(h);
    setSellForm({
      shares: String(total),
      price: stock?.current_price != null ? String(stock.current_price) : "",
      reason: "利確",
      memo: "",
      strategyId: "",
    });
  };

  // 売却実行: Trade を記録し、保有を減算/解消。全解消時は状態を戻す。
  const confirmSell = async () => {
    if (!sellTarget) return;
    const stock = stocks.find((s) => s.id === sellTarget.stock_id);
    if (!stock) return;
    const sellPrice = Number(sellForm.price);
    const stockHoldings = holdings.filter((x) => x.stock_id === sellTarget.stock_id);
    const total = stockHoldings.reduce((a, x) => a + x.shares, 0);
    const cost = stockHoldings.reduce((a, x) => a + x.buy_price * x.shares, 0);
    const avg = total > 0 ? cost / total : 0;
    const sellShares = Math.min(Number(sellForm.shares) || 0, total);
    if (!Number.isFinite(sellPrice) || sellPrice <= 0 || sellShares <= 0) {
      alert("売却価格・株数を正しく入力してください。");
      return;
    }
    setBusy(true);
    try {
      const { pnl: realizedPnl, rate } = computeRealized(avg, sellPrice, sellShares);
      const remain = total - sellShares;
      const entryDate = stockHoldings
        .map((x) => x.created_at)
        .filter((d): d is string => !!d)
        .sort()[0];
      const scoreExit = scoreStock(stock).score;
      const scoreEntry = stockHoldings.find((x) => x.score_at_entry != null)?.score_at_entry ?? scoreExit;

      // Trade を記録
      await tradeRepo.create({
        date: new Date().toISOString().slice(0, 10),
        stockCode: stock.code,
        stockName: stock.name,
        theme: stock.theme,
        action: remain > 0 ? "sellPartial" : "sellAll",
        buyPrice: round2(avg),
        sellPrice,
        shares: sellShares,
        realizedPnl: round2(realizedPnl),
        realizedPnlRate: round2(rate),
        holdingDays: daysBetween(entryDate, new Date().toISOString()),
        scoreAtEntry: scoreEntry,
        scoreAtExit: scoreExit,
        reason: sellForm.reason || null,
        memo: sellForm.memo || null,
        strategyId: sellForm.strategyId || null,
        strategyName: strategies.find((s) => s.id === sellForm.strategyId)?.name ?? null,
      });

      // 保有を再構成
      for (const x of stockHoldings) await holdingRepo.remove(x.id);
      if (remain > 0) {
        await holdingRepo.create({
          stock_id: sellTarget.stock_id,
          buy_price: round2(avg),
          shares: remain,
          stop_loss: null,
          take_profit: null,
          score_at_entry: scoreEntry,
        });
      } else if (stock.status === "保有中") {
        const { id, ...rest } = stock;
        await stockRepo.update(id, { ...rest, status: "買い候補" });
      }
    } catch (e) {
      setBusy(false);
      alert(`売却の記録に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setBusy(false);
    setSellTarget(null);
    load();
  };

  const toggleBuyMore = (id: string) => {
    setBuyMoreId((prev) => (prev === id ? null : id));
    setBuyForm({ price: "", shares: "" });
  };

  // 買い増し: 平均取得単価 =(旧取得額＋追加取得額)÷総株数
  const confirmBuyMore = async (h: Holding) => {
    const addPrice = Number(buyForm.price);
    const addShares = Number(buyForm.shares);
    if (!buyForm.price || !buyForm.shares || addPrice <= 0 || addShares <= 0) {
      alert("追加購入の購入単価・追加株数を正しく入力してください。");
      return;
    }
    const totalShares = h.shares + addShares;
    const avg = round2((h.buy_price * h.shares + addPrice * addShares) / totalShares);
    setBusy(true);
    try {
      await holdingRepo.update(h.id, {
        stock_id: h.stock_id,
        buy_price: avg,
        shares: totalShares,
        stop_loss: h.stop_loss ?? null,
        take_profit: h.take_profit ?? null,
        memo: h.memo ?? null,
        created_at: h.created_at ?? null,
        score_at_entry: h.score_at_entry ?? null,
      });
    } catch (e) {
      setBusy(false);
      alert(`買い増しに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setBusy(false);
    setBuyMoreId(null);
    setBuyForm({ price: "", shares: "" });
    load();
  };

  return (
    <div className="space-y-6">
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">{editingId ? "▲ 保有株を編集" : "＋ 保有株を登録"}</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <label className="block col-span-2 md:col-span-1">
            <span className="hud-label">銘柄 *</span>
            <select className="hud-input mt-1" value={form.stock_id} onChange={set("stock_id")}>
              <option value="">選択してください</option>
              {stocks.map((s) => (
                <option key={s.id} value={s.id}>{s.code} {s.name}</option>
              ))}
            </select>
          </label>
          {([
            ["取得単価 *", "buy_price"],
            ["株数 *", "shares"],
            ["損切価格", "stop_loss"],
            ["利確価格", "take_profit"],
          ] as const).map(([label, key]) => (
            <label key={key} className="block">
              <span className="hud-label">{label}</span>
              <input className="hud-input mt-1" type="number" step="0.1" value={form[key]} onChange={set(key)} />
            </label>
          ))}
        </div>
        <div className="mt-3">
          <label className="block">
            <span className="hud-label">メモ</span>
            <textarea className="hud-input mt-1" rows={2} value={form.memo} onChange={set("memo")} />
          </label>
        </div>
        <p className="text-arcdim text-xs mt-2">
          損切／利確価格を空欄にすると、銘柄マスタ側の設定を継承します。
        </p>
        <div className="mt-4 flex gap-3">
          <button className="hud-btn" onClick={submit} disabled={busy}>
            {editingId ? "更新する" : "登録する"}
          </button>
          {editingId && (
            <button className="hud-btn-danger px-4 py-1.5 text-sm" onClick={resetForm}>編集をやめる</button>
          )}
        </div>
      </section>

      <section className="hud-panel p-4 overflow-x-auto">
        <h2 className="hud-label mb-3"><HelpTooltip termKey="currentweight" label="保有株一覧" /> ({holdings.length})</h2>
        {holdings.length === 0 ? (
          <p className="text-arcdim text-sm">保有ポジションなし。資産は待機状態です、ボス。</p>
        ) : (
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {["銘柄", "取得単価", "株数", "現在値", "評価額", "評価損益", "損益率", "損切り", "利確", "判定", ""].map((h) => (
                  <th key={h} className="pb-2 pr-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const s = h.stocks;
                const price = s?.current_price;
                const r = price != null ? pnl(h, price) : null;
                const level = s ? holdingDangerLevel(h, s) : null;
                const rowTone =
                  level === "danger"
                    ? "text-danger bg-danger/5"
                    : level === "profit"
                      ? "text-profit"
                      : level === "caution"
                        ? "text-caution"
                        : "";
                return (
                  <Fragment key={h.id}>
                    <tr className={`border-t border-line/60 ${rowTone}`}>
                      <td className="py-2 pr-3">{s?.name} <span className="opacity-60">({s?.code})</span></td>
                      <td className="py-2 pr-3">¥{fmt(h.buy_price)}</td>
                      <td className="py-2 pr-3">{h.shares}</td>
                      <td className="py-2 pr-3">{price != null ? `¥${fmt(price)}` : "—"}</td>
                      <td className="py-2 pr-3">{r ? `¥${fmt(r.value)}` : "—"}</td>
                      <td className="py-2 pr-3">{r ? `${r.diff >= 0 ? "+" : ""}¥${fmt(r.diff)}` : "—"}</td>
                      <td className="py-2 pr-3">{r ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%` : "—"}</td>
                      <td className="py-2 pr-3">{h.stop_loss ?? s?.stop_loss ?? "—"}</td>
                      <td className="py-2 pr-3">{h.take_profit ?? s?.take_profit ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {level === "danger" ? "危険" : level === "profit" ? "利確検討" : level === "caution" ? "過熱" : "正常"}
                      </td>
                      <td className="py-2 flex gap-2">
                        <button className="hud-btn text-xs px-2 py-0.5" onClick={() => toggleBuyMore(h.id)}>買い増し</button>
                        <button className="hud-btn text-xs px-2 py-0.5" onClick={() => edit(h)}>編集</button>
                        {tvEnabled && (
                          <button className="hud-btn text-xs px-2 py-0.5" onClick={() => toggleChart(h.id)}>チャート</button>
                        )}
                        <button className="hud-btn-danger" onClick={() => openSell(h)}>売却</button>
                      </td>
                    </tr>
                    {buyMoreId === h.id && (
                      <tr className="border-t border-line/40 bg-arc/5">
                        <td colSpan={11} className="py-3 px-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <span className="hud-label">買い増し</span>
                            <label className="block">
                              <span className="hud-label">購入単価</span>
                              <input className="hud-input mt-1 w-32" type="number" step="0.1"
                                value={buyForm.price} onChange={(e) => setBuyForm((f) => ({ ...f, price: e.target.value }))} />
                            </label>
                            <label className="block">
                              <span className="hud-label">追加株数</span>
                              <input className="hud-input mt-1 w-32" type="number" step="1"
                                value={buyForm.shares} onChange={(e) => setBuyForm((f) => ({ ...f, shares: e.target.value }))} />
                            </label>
                            <button className="hud-btn text-sm px-3 py-1.5" onClick={() => confirmBuyMore(h)} disabled={busy}>確定</button>
                          </div>
                          {buyForm.price && buyForm.shares && Number(buyForm.shares) > 0 && (
                            <p className="text-arcdim text-xs mt-2">
                              新・平均取得単価（予定）：¥{fmt(
                                round2((h.buy_price * h.shares + Number(buyForm.price) * Number(buyForm.shares)) / (h.shares + Number(buyForm.shares)))
                              )}
                              {" / "}総株数：{h.shares + Number(buyForm.shares)}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                    {tvEnabled && chartId === h.id && (
                      <tr className="border-t border-line/40 bg-void/40">
                        <td colSpan={11} className="py-3 px-3">
                          <TradingViewChart code={s?.code} height={420} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {sellTarget && (() => {
        const stock = stocks.find((s) => s.id === sellTarget.stock_id);
        const sh = holdings.filter((x) => x.stock_id === sellTarget.stock_id);
        const total = sh.reduce((a, x) => a + x.shares, 0);
        const cost = sh.reduce((a, x) => a + x.buy_price * x.shares, 0);
        const avg = total > 0 ? cost / total : 0;
        const sellShares = Math.min(Number(sellForm.shares) || 0, total);
        const sellPrice = Number(sellForm.price) || 0;
        const realized = (sellPrice - avg) * sellShares;
        const rate = avg > 0 ? ((sellPrice - avg) / avg) * 100 : 0;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setSellTarget(null)}
          >
            <div className="hud-panel p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <h2 className="hud-label mb-3">
                売却 — {stock?.name} <span className="text-arcdim">({stock?.code})</span>
              </h2>
              <p className="text-arcdim text-xs mb-3">
                保有 {total} 株 / 平均取得単価 ¥{fmt(avg)}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="hud-label">売却株数</span>
                  <input className="hud-input mt-1" type="number" step="1" max={total}
                    value={sellForm.shares} onChange={(e) => setSellForm((f) => ({ ...f, shares: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="hud-label">売却価格</span>
                  <input className="hud-input mt-1" type="number" step="0.1"
                    value={sellForm.price} onChange={(e) => setSellForm((f) => ({ ...f, price: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="hud-label">売却理由</span>
                  <select className="hud-input mt-1" value={sellForm.reason}
                    onChange={(e) => setSellForm((f) => ({ ...f, reason: e.target.value }))}>
                    {["利確", "損切り", "リバランス", "目標到達", "その他"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="hud-label">メモ</span>
                  <input className="hud-input mt-1" value={sellForm.memo}
                    onChange={(e) => setSellForm((f) => ({ ...f, memo: e.target.value }))} />
                </label>
                <label className="block col-span-2">
                  <span className="hud-label">戦略（任意）</span>
                  <select className="hud-input mt-1" value={sellForm.strategyId}
                    onChange={(e) => setSellForm((f) => ({ ...f, strategyId: e.target.value }))}>
                    <option value="">未選択</option>
                    {strategies.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className={`mt-3 font-mono text-sm ${realized >= 0 ? "text-profit" : "text-danger"}`}>
                実現損益（予定）: {realized >= 0 ? "+" : ""}¥{fmt(realized)}（{rate >= 0 ? "+" : ""}{rate.toFixed(2)}%）
                {sellShares >= total ? " ／ 全売却" : " ／ 一部売却"}
              </p>
              <div className="mt-4 flex gap-3">
                <button className="hud-btn" onClick={confirmSell} disabled={busy}>
                  {busy ? "記録中…" : "売却を確定"}
                </button>
                <button className="hud-btn-danger px-4 py-1.5 text-sm" onClick={() => setSellTarget(null)}>
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
