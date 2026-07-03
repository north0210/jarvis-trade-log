"use client";

import { useEffect, useMemo, useState } from "react";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import type { Holding, Stock } from "@/lib/types";
import { getCashPosition, setCashPosition } from "@/lib/analysis/portfolio";
import { scoreStock } from "@/lib/score";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { computeRealized, daysBetween } from "@/lib/analysis/trades";
import {
  simulate,
  simulationComment,
  summarize,
  appendSimulation,
  getSimulations,
  type SimAction,
  type SimTrade,
  type SimulationRecord,
} from "@/lib/analysis/simulator";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const tradeRepo = getTradeRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const pctf = (r: number) => `${(r * 100).toFixed(1)}%`;

const ACTIONS: { key: SimAction; label: string }[] = [
  { key: "buy", label: "買い" },
  { key: "add", label: "買い増し" },
  { key: "sellPartial", label: "一部売却" },
  { key: "sellAll", label: "全売却" },
];

const cmpColor = (b: number, a: number, betterHigher: boolean) => {
  if (a === b) return "";
  const improved = betterHigher ? a > b : a < b;
  return improved ? "text-arc" : "text-danger";
};

export default function SimulatorPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [cash, setCash] = useState(0);
  const [history, setHistory] = useState<SimulationRecord[]>([]);

  const [stockId, setStockId] = useState("");
  const [action, setAction] = useState<SimAction>("buy");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [cashDelta, setCashDelta] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [s, h] = await Promise.all([stockRepo.list(), holdingRepo.list()]);
    setStocks(s);
    setHoldings(h);
    setCash(getCashPosition());
    setHistory(getSimulations());
  };
  useEffect(() => {
    load();
    // リバランス提案からの引き渡し（?stockId=&action=&shares=&price=）を反映
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search);
      const sid = q.get("stockId");
      const act = q.get("action");
      if (sid) setStockId(sid);
      if (act === "buy" || act === "add" || act === "sellPartial" || act === "sellAll") setAction(act);
      const qs = q.get("shares");
      const qp = q.get("price");
      if (qs) setShares(qs);
      if (qp) setPrice(qp);
    }
  }, []);

  const heldShares = (id: string) =>
    holdings.filter((h) => h.stock_id === id).reduce((a, h) => a + h.shares, 0);

  // 銘柄選択時に価格/株数を補助入力
  const onSelectStock = (id: string) => {
    setStockId(id);
    const s = stocks.find((x) => x.id === id);
    if (s?.current_price != null) setPrice(String(s.current_price));
  };

  const trade: SimTrade | null = useMemo(() => {
    if (!stockId) return null;
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return null;
    const sh = action === "sellAll" ? heldShares(stockId) : Number(shares);
    if (action !== "sellAll" && (!Number.isFinite(sh) || sh <= 0)) return null;
    if (action === "sellAll" && sh <= 0) return null;
    return { stockId, action, shares: sh, price: p, cashDelta: Number(cashDelta) || 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockId, action, shares, price, cashDelta, holdings]);

  const sim = useMemo(
    () => (trade ? simulate(stocks, holdings, cash, trade) : null),
    [trade, stocks, holdings, cash]
  );
  const comments = useMemo(() => (sim ? simulationComment(sim.before, sim.after) : []), [sim]);

  const selectedStock = stocks.find((s) => s.id === stockId) ?? null;

  const reflect = async () => {
    if (!trade || !sim || !selectedStock) return;
    const actLabel = ACTIONS.find((a) => a.key === trade.action)?.label ?? "";
    if (!confirm(`${selectedStock.name}（${selectedStock.code}）を「${actLabel}」で保有株へ反映します。よろしいですか？`)) return;
    setBusy(true);
    try {
      const stockHoldings = holdings.filter((h) => h.stock_id === trade.stockId);
      const totalShares = stockHoldings.reduce((a, h) => a + h.shares, 0);
      const totalCost = stockHoldings.reduce((a, h) => a + h.buy_price * h.shares, 0);
      const avg = totalShares > 0 ? totalCost / totalShares : 0;

      if (trade.action === "buy" || trade.action === "add") {
        await holdingRepo.create({
          stock_id: trade.stockId,
          buy_price: trade.price,
          shares: trade.shares,
          stop_loss: null,
          take_profit: null,
          score_at_entry: scoreStock(selectedStock).score,
        });
        if (selectedStock.status !== "保有中") {
          const { id, ...rest } = selectedStock;
          await stockRepo.update(id, { ...rest, status: "保有中" });
        }
      } else {
        // 売却系: Trade を記録 → 既存保有を削除し残数を再作成
        const sellShares = trade.action === "sellAll" ? totalShares : Math.min(trade.shares, totalShares);
        const { pnl: realizedPnl, rate } = computeRealized(avg, trade.price, sellShares);
        const entryDate = stockHoldings
          .map((h) => h.created_at)
          .filter((d): d is string => !!d)
          .sort()[0];
        const scoreExit = scoreStock(selectedStock).score;
        const scoreEntry = stockHoldings.find((h) => h.score_at_entry != null)?.score_at_entry ?? scoreExit;
        await tradeRepo.create({
          date: new Date().toISOString().slice(0, 10),
          stockCode: selectedStock.code,
          stockName: selectedStock.name,
          theme: selectedStock.theme,
          action: trade.action === "sellAll" ? "sellAll" : "sellPartial",
          buyPrice: Math.round(avg * 100) / 100,
          sellPrice: trade.price,
          shares: sellShares,
          realizedPnl: Math.round(realizedPnl * 100) / 100,
          realizedPnlRate: Math.round(rate * 100) / 100,
          holdingDays: daysBetween(entryDate, new Date().toISOString()),
          scoreAtEntry: scoreEntry,
          scoreAtExit: scoreExit,
          reason: "シミュレーター反映",
          memo: memo || null,
        });

        for (const h of stockHoldings) await holdingRepo.remove(h.id);
        const remain = trade.action === "sellAll" ? 0 : Math.max(0, totalShares - trade.shares);
        if (remain > 0) {
          await holdingRepo.create({
            stock_id: trade.stockId,
            buy_price: avg,
            shares: remain,
            stop_loss: null,
            take_profit: null,
          });
        } else if (selectedStock.status === "保有中") {
          const { id, ...rest } = selectedStock;
          await stockRepo.update(id, { ...rest, status: "買い候補" });
        }
      }

      // 現金を反映後の値に更新
      const appliedCash = sim.after.cash;
      setCashPosition(appliedCash);

      // 履歴に記録
      const now = new Date().toISOString();
      appendSimulation({
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`,
        date: now.slice(0, 10),
        stockCode: selectedStock.code,
        stockName: selectedStock.name,
        action: trade.action,
        shares: trade.shares,
        price: trade.price,
        beforeSummary: summarize(sim.before),
        afterSummary: summarize(sim.after),
        jarvisComment: [memo, ...comments].filter(Boolean).join(" / "),
        createdAt: now,
      });
    } catch (e) {
      setBusy(false);
      alert(`反映に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setBusy(false);
    setShares("");
    setCashDelta("");
    setMemo("");
    load();
  };

  const before = sim?.before;
  const after = sim?.after;
  const saRatio = (byGrade: { key: string; ratio: number }[]) =>
    byGrade.filter((g) => g.key === "S" || g.key === "A").reduce((a, g) => a + g.ratio, 0);

  return (
    <div className="space-y-6">
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">▶ 売買シミュレーター</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <label className="block col-span-2 md:col-span-1">
            <span className="hud-label">対象銘柄</span>
            <select className="hud-input mt-1" value={stockId} onChange={(e) => onSelectStock(e.target.value)}>
              <option value="">選択してください</option>
              {stocks.map((s) => (
                <option key={s.id} value={s.id}>{s.code} {s.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="hud-label">アクション</span>
            <select className="hud-input mt-1" value={action} onChange={(e) => setAction(e.target.value as SimAction)}>
              {ACTIONS.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="hud-label">株数{action === "sellAll" ? "（全株）" : ""}</span>
            <input
              className="hud-input mt-1"
              type="number"
              step="1"
              value={action === "sellAll" ? String(heldShares(stockId) || "") : shares}
              onChange={(e) => setShares(e.target.value)}
              disabled={action === "sellAll"}
              placeholder={action === "sellAll" ? "全株自動" : ""}
            />
          </label>
          <label className="block">
            <span className="hud-label">価格</span>
            <input className="hud-input mt-1" type="number" step="0.1" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="block">
            <span className="hud-label">現金増減（任意）</span>
            <input className="hud-input mt-1" type="number" step="1000" value={cashDelta} onChange={(e) => setCashDelta(e.target.value)} placeholder="入金/出金" />
          </label>
          <label className="block col-span-2 md:col-span-1">
            <span className="hud-label">メモ</span>
            <input className="hud-input mt-1" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </div>
        <p className="text-arcdim text-xs mt-2">
          現在の現金：¥{fmt(cash)}　/　保有株数（対象）：{stockId ? heldShares(stockId) : "—"}
        </p>
      </section>

      {!sim ? (
        <section className="hud-panel p-4">
          <p className="text-arcdim text-sm">銘柄・株数・価格を入力するとシミュレーション結果を表示します、ボス。</p>
        </section>
      ) : (
        <>
          {/* Before / After */}
          <section className="hud-panel p-4 overflow-x-auto">
            <h2 className="hud-label mb-3">Before / After 比較</h2>
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="hud-label text-left">
                  <th className="pb-2 pr-4 font-normal">指標</th>
                  <th className="pb-2 pr-4 font-normal">Before</th>
                  <th className="pb-2 pr-4 font-normal">After</th>
                </tr>
              </thead>
              <tbody>
                {before && after && (
                  <>
                    <CmpRow label="総評価額" b={`¥${fmt(before.totalValue)}`} a={`¥${fmt(after.totalValue)}`} />
                    <CmpRow label="現金比率" b={pctf(before.cashRatio)} a={pctf(after.cashRatio)} color={after.cashRatio < 0.1 ? "text-danger" : cmpColor(before.cashRatio, after.cashRatio, true)} />
                    <CmpRow label="含み損益" b={`¥${fmt(before.pnl)}`} a={`¥${fmt(after.pnl)}`} color={cmpColor(before.pnl, after.pnl, true)} />
                    <CmpRow label="損益率" b={`${before.pnlPct.toFixed(2)}%`} a={`${after.pnlPct.toFixed(2)}%`} color={cmpColor(before.pnlPct, after.pnlPct, true)} />
                    <CmpRow label="保有銘柄数" b={`${before.holdingCount}`} a={`${after.holdingCount}`} />
                    <CmpRow label="最大集中銘柄" b={before.maxPosition ? `${before.maxPosition.name} ${pctf(before.maxPosition.ratio)}` : "—"} a={after.maxPosition ? `${after.maxPosition.name} ${pctf(after.maxPosition.ratio)}` : "—"} color={cmpColor(before.maxPosition?.ratio ?? 0, after.maxPosition?.ratio ?? 0, false)} />
                    <CmpRow label="テーマ集中率" b={before.byTheme[0] ? `${before.byTheme[0].key} ${pctf(before.byTheme[0].ratio)}` : "—"} a={after.byTheme[0] ? `${after.byTheme[0].key} ${pctf(after.byTheme[0].ratio)}` : "—"} color={cmpColor(before.byTheme[0]?.ratio ?? 0, after.byTheme[0]?.ratio ?? 0, false)} />
                    <CmpRow label="Grade A以上比率" b={pctf(saRatio(before.byGrade))} a={pctf(saRatio(after.byGrade))} color={cmpColor(saRatio(before.byGrade), saRatio(after.byGrade), true)} />
                    <CmpRow label="平均Score" b={before.scoreAvg != null ? before.scoreAvg.toFixed(1) : "—"} a={after.scoreAvg != null ? after.scoreAvg.toFixed(1) : "—"} color={cmpColor(before.scoreAvg ?? 0, after.scoreAvg ?? 0, true)} />
                    <CmpRow label="危険アラート数" b={`${before.warnings.length}`} a={`${after.warnings.length}`} color={cmpColor(before.warnings.length, after.warnings.length, false)} />
                  </>
                )}
              </tbody>
            </table>
            <p className="text-arcdim text-xs mt-2">改善=<span className="text-arc">シアン</span> / 悪化=<span className="text-danger">赤</span> / 中立=白</p>
          </section>

          {/* JARVIS 判定 */}
          <section className="hud-panel p-4 border-arc/40 shadow-arc">
            <h2 className="hud-label mb-3">◎ JARVIS 判定</h2>
            <ul className="space-y-1.5 text-sm font-mono text-arc leading-relaxed">
              {comments.map((c, i) => (
                <li key={i}>・{c}</li>
              ))}
            </ul>
            <button className="hud-btn mt-4" onClick={reflect} disabled={busy}>
              {busy ? "反映中…" : "この構成を保有株へ反映"}
            </button>
          </section>
        </>
      )}

      {/* 履歴 */}
      <section className="hud-panel p-4 overflow-x-auto">
        <h2 className="hud-label mb-3">シミュレーション履歴 ({history.length})</h2>
        {history.length === 0 ? (
          <p className="text-arcdim text-sm">履歴なし。反映すると記録されます。</p>
        ) : (
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {["日付", "銘柄", "操作", "株数", "価格", "Score", "現金比率", "コメント"].map((h) => (
                  <th key={h} className="pb-2 pr-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-t border-line/60">
                  <td className="py-2 pr-3">{r.date}</td>
                  <td className="py-2 pr-3">{r.stockName} <span className="opacity-60">({r.stockCode})</span></td>
                  <td className="py-2 pr-3">{ACTIONS.find((a) => a.key === r.action)?.label ?? r.action}</td>
                  <td className="py-2 pr-3">{r.shares}</td>
                  <td className="py-2 pr-3">¥{fmt(r.price)}</td>
                  <td className="py-2 pr-3">
                    {r.beforeSummary.scoreAvg?.toFixed(0) ?? "—"}→{r.afterSummary.scoreAvg?.toFixed(0) ?? "—"}
                  </td>
                  <td className="py-2 pr-3">
                    {pctf(r.beforeSummary.cashRatio)}→{pctf(r.afterSummary.cashRatio)}
                  </td>
                  <td className="py-2 pr-3 whitespace-normal max-w-md text-arcdim">{r.jarvisComment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function CmpRow({ label, b, a, color = "" }: { label: string; b: string; a: string; color?: string }) {
  return (
    <tr className="border-t border-line/50">
      <td className="py-1.5 pr-4 text-arcdim">{label}</td>
      <td className="py-1.5 pr-4 text-[#cfeaff]">{b}</td>
      <td className={`py-1.5 pr-4 ${color || "text-[#cfeaff]"}`}>{a}</td>
    </tr>
  );
}
