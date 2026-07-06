"use client";

/**
 * 東証全銘柄スクリーナー + JARVIS おすすめランキング。
 * J-Quants から日付一括で全銘柄を取得→技術スコアで粗選別→上位50のみ財務取得→フルスコア。
 * 判断補助であり投資助言ではありません。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import { getProviderMode, getJQuantsCredentials } from "@/lib/pricing/settings";
import { runScreener, type ScreenerPhase } from "@/lib/screener/screenerRun";
import { loadScreenerSnapshot, type ScreenerSnapshot } from "@/lib/screener/screenerRepository";
import type { ScreenerRow } from "@/lib/screener/technical";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { planRegister } from "@/lib/screener/register";
import {
  getScreenerAutoSettings,
  setScreenerAutoSettings,
  subscribeScreenerAuto,
  getScreenerAutoRuntime,
  type ScreenerFrequency,
} from "@/lib/screener/screenerAuto";

const PHASE_LABEL: Record<ScreenerPhase, string> = {
  universe: "上場一覧",
  bars: "価格系列",
  fins: "財務指標",
};

type Msg = { tone: "ok" | "err"; text: string } | null;

export default function ScreenerPage() {
  const [snap, setSnap] = useState<ScreenerSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ phase: ScreenerPhase; done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const abortRef = useRef<AbortController | null>(null);

  // フィルタ
  const [fMarket, setFMarket] = useState("");
  const [fSector, setFSector] = useState("");
  const [fGrade, setFGrade] = useState("");
  const [fundOnly, setFundOnly] = useState(false);

  const [registered, setRegistered] = useState<Set<string>>(new Set());
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoFreq, setAutoFreq] = useState<ScreenerFrequency>("daily");
  const [autoRuntime, setAutoRuntime] = useState(getScreenerAutoRuntime());

  useEffect(() => {
    setSnap(loadScreenerSnapshot());
    getStockRepository()
      .list()
      .then((stocks) => setRegistered(new Set(stocks.map((s) => s.code))));
    const a = getScreenerAutoSettings();
    setAutoEnabled(a.enabled);
    setAutoFreq(a.frequency);
    // 自動更新の実行状況を購読（完了時に snapshot を再読込）
    const unsub = subscribeScreenerAuto(() => {
      const rt = getScreenerAutoRuntime();
      setAutoRuntime(rt);
      if (!rt.running) setSnap(loadScreenerSnapshot());
    });
    return unsub;
  }, []);

  const toggleAuto = (enabled: boolean) => {
    setAutoEnabled(enabled);
    setScreenerAutoSettings({ enabled });
  };
  const changeFreq = (frequency: ScreenerFrequency) => {
    setAutoFreq(frequency);
    setScreenerAutoSettings({ frequency });
  };

  const addToWatchlist = async (row: ScreenerRow) => {
    if (!snap) return;
    const plan = planRegister(row, registered, { priceAsOf: snap.priceAsOf, generatedAt: snap.generatedAt });
    if (plan.skip || !plan.input) return;
    await getStockRepository().create(plan.input);
    setRegistered((prev) => new Set(prev).add(row.code)); // 即「登録済み」へ
    setMsg({ tone: "ok", text: `${row.name}（${row.code}）をウォッチリストに追加しました。` });
  };

  const run = async () => {
    if (getProviderMode() === "manual") {
      setMsg({ tone: "err", text: "手入力モードです。設定画面で J-Quants モードに切り替えてください。" });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress(null);
    setMsg({ tone: "ok", text: "スクリーニング実行中です、ボス…" });
    const r = await runScreener(getJQuantsCredentials(), {
      signal: controller.signal,
      onProgress: (phase, done, total) => setProgress({ phase, done, total }),
    });
    setRunning(false);
    setProgress(null);
    abortRef.current = null;
    setSnap(loadScreenerSnapshot());
    setMsg({ tone: r.ok ? "ok" : "err", text: r.message });
  };

  const rows = useMemo(() => snap?.rows ?? [], [snap]);
  const markets = useMemo(() => Array.from(new Set(rows.map((r) => r.market).filter(Boolean))).sort(), [rows]);
  const sectors = useMemo(() => Array.from(new Set(rows.map((r) => r.sector).filter(Boolean))).sort(), [rows]);
  const grades = useMemo(() => Array.from(new Set(rows.map((r) => r.grade))).sort(), [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!fMarket || r.market === fMarket) &&
          (!fSector || r.sector === fSector) &&
          (!fGrade || r.grade === fGrade) &&
          (!fundOnly || r.fundamentalsAvailable)
      ),
    [rows, fMarket, fSector, fGrade, fundOnly]
  );

  return (
    <div className="space-y-6">
      <PageIntro
        title="🔭 全銘柄スクリーナー（JARVIS おすすめ）"
        description="東証全銘柄を技術スコアで粗選別し、上位のみ財務を加えたフルスコアでランキングします。判断補助であり投資助言ではありません。"
        helpKey="pf"
      />

      <section className="hud-panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button className="hud-btn" onClick={run} disabled={running}>
            {running ? "実行中…" : "スクリーニング更新"}
          </button>
          {running && (
            <>
              {progress && (
                <span className="text-arc text-xs">
                  {PHASE_LABEL[progress.phase]} {progress.done}/{progress.total}
                </span>
              )}
              <button className="hud-btn" onClick={() => abortRef.current?.abort()}>中断</button>
            </>
          )}
        </div>
        <p className="text-xs text-caution mt-2">
          ⚠ 初回・全更新は<strong>約18分</strong>かかります（無料プランは 5リクエスト/分・全営業日ぶんを順次取得）。
          実行中は「中断」で安全に停止できます（中断時は保存されません）。
        </p>
        {msg && (
          <p className={`text-sm font-mono mt-2 ${msg.tone === "ok" ? "text-profit" : "text-danger"}`}>{msg.text}</p>
        )}
      </section>

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-2">◇ 自動更新（起動時チェック）</h2>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autoEnabled} onChange={(e) => toggleAuto(e.target.checked)} />
            <span className="text-sm">アプリ起動時に自動更新</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="hud-label">頻度</span>
            <select className="hud-input" value={autoFreq} onChange={(e) => changeFreq(e.target.value as ScreenerFrequency)} disabled={!autoEnabled}>
              <option value="daily">毎日</option>
              <option value="weekly">毎週</option>
            </select>
          </label>
          {autoRuntime.running && (
            <span className="text-arc text-xs">
              自動更新中… {autoRuntime.phase === "probe" ? "確認" : autoRuntime.phase === "universe" ? "上場一覧" : autoRuntime.phase === "bars" ? "価格系列" : "財務指標"} {autoRuntime.done}/{autoRuntime.total}
            </span>
          )}
        </div>
        <p className="text-xs text-arcdim mt-2">
          起動時に前回より新しい取得可能日があれば自動でランキングを更新します（bars はフル再取得・財務は再利用）。既定 OFF。
          <strong className="text-caution"> Free プランでは約12週遅延データのため鮮度向上は限定的です。最新化には Light 以上をご検討ください。</strong>
        </p>
      </section>

      {!snap ? (
        <section className="hud-panel p-4">
          <p className="text-arcdim text-sm">まだ実行されていません。「スクリーニング更新」を押してください（初回は約18分）。</p>
        </section>
      ) : (
        <section className="hud-panel p-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="hud-label">
              ランキング（{snap.generatedAt.slice(0, 10)} 時点・{snap.universeCount}社中／表示 {filtered.length}件）
            </h2>
            <div className="flex flex-wrap gap-2 text-xs">
              <select className="hud-input" value={fMarket} onChange={(e) => setFMarket(e.target.value)}>
                <option value="">市場（全て）</option>
                {markets.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select className="hud-input" value={fSector} onChange={(e) => setFSector(e.target.value)}>
                <option value="">セクター（全て）</option>
                {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="hud-input" value={fGrade} onChange={(e) => setFGrade(e.target.value)}>
                <option value="">評価（全て）</option>
                {grades.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <label className="flex items-center gap-1 text-arcdim">
                <input type="checkbox" checked={fundOnly} onChange={(e) => setFundOnly(e.target.checked)} />
                財務取得済のみ
              </label>
            </div>
          </div>

          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {["#", "コード", "銘柄名", "セクター", "市場", "現在値", "RSI", "MACD",
                  <HelpTooltip key="sc" termKey="pf" label="スコア" />, "評価", "PER", "PBR", "ROE", "営業%", "売上成長%", "財務", "登録", ""].map((h, i) => (
                  <th key={i} className="pb-2 pr-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r: ScreenerRow, i) => (
                <tr key={r.code} className="border-t border-line/60">
                  <td className="py-1 pr-3 text-arcdim">{i + 1}</td>
                  <td className="py-1 pr-3">{r.code}</td>
                  <td className="py-1 pr-3">{r.name}</td>
                  <td className="py-1 pr-3 text-arcdim">{r.sector || "—"}</td>
                  <td className="py-1 pr-3 text-arcdim">{r.market || "—"}</td>
                  <td className="py-1 pr-3">{r.price ?? "—"}</td>
                  <td className="py-1 pr-3">{r.rsi ?? "—"}</td>
                  <td className="py-1 pr-3">{r.macd}</td>
                  <td className="py-1 pr-3 text-arc">{r.score}</td>
                  <td className="py-1 pr-3">{r.grade}</td>
                  <td className="py-1 pr-3">{r.per ?? "—"}</td>
                  <td className="py-1 pr-3">{r.pbr ?? "—"}</td>
                  <td className="py-1 pr-3">{r.roe ?? "—"}</td>
                  <td className="py-1 pr-3">{r.operatingMargin ?? "—"}</td>
                  <td className="py-1 pr-3">{r.salesGrowth ?? "—"}</td>
                  <td className="py-1 pr-3 text-[10px] text-arcdim">
                    {r.fundamentalsAvailable
                      ? `${r.fundamentalsBasis === "FY" ? "本決算" : r.fundamentalsBasis === "quarter" ? "四半期" : ""}${r.fundamentalsAsOf ? ` ${r.fundamentalsAsOf.slice(0, 10)}` : ""}`
                      : "未取得"}
                  </td>
                  <td className="py-1 pr-3">
                    {registered.has(r.code) ? (
                      <span className="text-arcdim text-xs">登録済み</span>
                    ) : (
                      <button className="hud-btn text-xs px-2 py-0.5" onClick={() => addToWatchlist(r)}>+ 追加</button>
                    )}
                  </td>
                  <td className="py-1 pr-3">
                    <Link href="/stocks" className="hud-btn text-xs px-2 py-0.5">銘柄管理へ</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-arcdim mt-3">
            ※ 判断補助であり投資助言ではありません。技術上位のみ財務を取得（二段構え）。
            財務は決算開示ベース（本決算/年次を優先・遅延あり）。ROE は EPS/BPS 近似で公表値と微差が出得ます。
          </p>
        </section>
      )}
    </div>
  );
}
