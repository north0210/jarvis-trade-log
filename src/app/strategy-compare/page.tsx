"use client";

/**
 * 戦略比較（シグナルシミュレータ）— Phase 1 / Task 3・Stage B。
 * 3戦略（A/B/C）×スクリーナー上位＋ウォッチリストを、翌営業日始値約定の新シミュレータで一括比較。
 * 前半/後半のアウトオブサンプル検証つき。既存BT画面・エンジンは非改造（本画面は独立）。
 * 判断補助であり投資助言ではありません。
 */
import { useEffect, useMemo, useState } from "react";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getProviderMode, getJQuantsCredentials } from "@/lib/pricing/settings";
import { fetchJQuantsSeries, describeSeriesFailure } from "@/lib/pricing/jquantsClient";
import type { SeriesPoint } from "@/lib/analytics/priceCache";
import { loadScreenerSnapshot } from "@/lib/screener/screenerRepository";
import { STRATEGIES } from "@/lib/strategy/strategies";
import {
  runStrategyComparison,
  type StrategyComparisonResult,
  type SimMetrics,
} from "@/lib/backtest/signalSimulator";
import { loadStrategyComparison, saveStrategyComparison } from "@/lib/backtest/signalComparisonRepository";
import { JQUANTS_EFFECTIVE_RPM } from "@/lib/pricing/serverRateLimiter";

const MAX_UNIVERSE = 15;
const SCREENER_TOP = 12;

const PERIODS = [
  { key: "3", label: "3年", years: 3 },
  { key: "5", label: "5年", years: 5 },
];

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number) => `${n.toFixed(1)}%`;
const pf = (n: number | null) => (n != null ? n.toFixed(2) : "—");
const exp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const days = (n: number | null) => (n != null ? `${n.toFixed(1)}日` : "—");

/** スクリーナー上位＋ウォッチリストのコードを重複排除して返す（最大 MAX_UNIVERSE）。 */
async function buildUniverse(): Promise<string[]> {
  const snap = loadScreenerSnapshot();
  const top = (snap?.rows ?? []).slice(0, SCREENER_TOP).map((r) => r.code);
  const watch = (await getStockRepository().list()).map((s) => s.code);
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const c of [...top, ...watch]) {
    if (c && !seen.has(c)) {
      seen.add(c);
      codes.push(c);
    }
    if (codes.length >= MAX_UNIVERSE) break;
  }
  return codes;
}

function MetricCell({ value, tone }: { value: string; tone?: "profit" | "danger" | "neutral" }) {
  const color = tone === "profit" ? "text-profit" : tone === "danger" ? "text-danger" : "text-arc";
  return <td className={`px-3 py-1.5 text-right font-mono ${color}`}>{value}</td>;
}

function MetricsTable({ title, sub, rows }: { title: string; sub?: string; rows: { name: string; m: SimMetrics }[] }) {
  return (
    <section className="hud-panel p-4 overflow-x-auto">
      <h3 className="hud-label mb-1">{title}</h3>
      {sub && <p className="text-arcdim text-xs mb-2">{sub}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-arcdim text-xs">
            <th className="px-3 py-1.5 text-left">戦略</th>
            <th className="px-3 py-1.5 text-right">取引数</th>
            <th className="px-3 py-1.5 text-right">勝率</th>
            <th className="px-3 py-1.5 text-right">PF</th>
            <th className="px-3 py-1.5 text-right">最大DD</th>
            <th className="px-3 py-1.5 text-right">期待値</th>
            <th className="px-3 py-1.5 text-right">平均保有</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ name, m }) => (
            <tr key={name} className="border-t border-arc/15">
              <td className="px-3 py-1.5 text-left">{name}</td>
              <MetricCell value={`${m.tradeCount}`} tone="neutral" />
              <MetricCell value={m.tradeCount ? pct(m.winRate * 100) : "—"} tone="neutral" />
              <MetricCell value={pf(m.profitFactor)} tone={m.profitFactor != null && m.profitFactor >= 1 ? "profit" : "danger"} />
              <MetricCell value={m.tradeCount ? pct(m.maxDrawdownPct) : "—"} tone="danger" />
              <MetricCell value={m.tradeCount ? exp(m.expectancyPct) : "—"} tone={m.expectancyPct >= 0 ? "profit" : "danger"} />
              <MetricCell value={days(m.avgHoldingDays)} tone="neutral" />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function StrategyComparePage() {
  const [periodKey, setPeriodKey] = useState("5");
  const [universe, setUniverse] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StrategyComparisonResult | null>(null);

  useEffect(() => {
    setResult(loadStrategyComparison());
    buildUniverse().then(setUniverse);
  }, []);

  const run = async () => {
    if (getProviderMode() !== "jquants-ready") {
      setError("J-Quantsモードに切り替えてください（設定 → 価格プロバイダ）。実データ取得が必要です。");
      return;
    }
    const codes = await buildUniverse();
    setUniverse(codes);
    if (codes.length === 0) {
      setError("対象銘柄がありません。先にスクリーナーを実行するか、ウォッチリストに銘柄を登録してください。");
      return;
    }
    setError(null);

    const years = PERIODS.find((p) => p.key === periodKey)?.years ?? 5;
    const to = new Date();
    const from = new Date(to.getFullYear() - years, to.getMonth(), to.getDate());
    const fromStr = fmtDate(from);
    const toStr = fmtDate(to);

    setRunning(true);
    setProgress({ done: 0, total: codes.length });
    const creds = getJQuantsCredentials();
    const perCode: { code: string; series: SeriesPoint[] }[] = [];
    let failed = 0;
    let emptyInRange = 0; // 取得成功だが対象期間にデータ無し（プラン期間外の可能性）
    let firstFail: { code: string; reason?: "auth" | "rate"; httpStatus?: number; message?: string } | null = null;
    for (let i = 0; i < codes.length; i++) {
      // requireOpen: 始値なし旧キャッシュは再取得（対象＝この比較ユニバースのみ）。
      const res = await fetchJQuantsSeries(codes[i], fromStr, toStr, creds, { requireOpen: true });
      if (res.ok && res.series.length > 0) {
        perCode.push({ code: codes[i], series: res.series });
      } else {
        failed++;
        if (res.ok) emptyInRange++;
        else if (!firstFail) firstFail = { code: codes[i], reason: res.reason, httpStatus: res.httpStatus, message: res.message };
      }
      setProgress({ done: i + 1, total: codes.length });
    }

    if (perCode.length === 0) {
      setRunning(false);
      // 真因（401/403/429/404/その他）を区別して表示。エラー0で全て空なら期間外の可能性。
      if (firstFail) {
        setError(`日足データを取得できませんでした — ${describeSeriesFailure(firstFail, firstFail.code)}`);
      } else {
        setError(
          "対象期間に日足データがありませんでした（J-Quants プランの取得可能期間外の可能性）。期間を短くして再試行してください。"
        );
      }
      return;
    }

    // 実効比較期間 = 実際に取得できた系列の日付レンジ（プラン範囲/クランプ後の真の窓）。
    let effFrom: string | null = null;
    let effTo: string | null = null;
    for (const { series } of perCode) {
      for (const p of series) {
        if (effFrom === null || p.date < effFrom) effFrom = p.date;
        if (effTo === null || p.date > effTo) effTo = p.date;
      }
    }
    const useFrom = effFrom ?? fromStr;
    const useTo = effTo ?? toStr;

    const base = runStrategyComparison(STRATEGIES, perCode, useFrom, useTo, new Date().toISOString());
    const r = { ...base, requestedFrom: fromStr, requestedTo: toStr };
    saveStrategyComparison(r);
    setResult(r);
    setRunning(false);
    if (failed > 0) {
      const note = firstFail
        ? describeSeriesFailure(firstFail, firstFail.code)
        : `${emptyInRange} 銘柄は対象期間にデータなし（期間外の可能性）`;
      setError(`${perCode.length}/${codes.length} 銘柄で比較（${failed} 銘柄スキップ）。${note}`);
    }
  };

  const totalSubstitute = useMemo(
    () => (result ? result.entries.reduce((a, e) => a + e.substituteFills, 0) : 0),
    [result]
  );
  const totalLapses = useMemo(() => (result ? result.entries.reduce((a, e) => a + e.lapses, 0) : 0), [result]);
  const clampNote = useMemo(() => {
    if (!result?.requestedFrom || !result?.requestedTo) return null;
    const adjusted = result.from > result.requestedFrom || result.to < result.requestedTo;
    if (!adjusted) return null;
    return `プラン取得可能範囲に合わせて実効期間を ${result.from} 〜 ${result.to} に調整しました（要求: ${result.requestedFrom} 〜 ${result.requestedTo}）。`;
  }, [result]);

  return (
    <div className="space-y-6">
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">⚖ 戦略比較（シグナルシミュレータ / 翌営業日始値約定）</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="hud-label">期間</span>
            <select className="hud-input mt-1 w-28" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} disabled={running}>
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </label>
          <button className="hud-btn" onClick={run} disabled={running}>
            {running ? (progress ? `取得中 ${progress.done}/${progress.total}` : "実行中…") : "比較を実行"}
          </button>
          <span className="text-arcdim text-xs">対象 {universe.length} 銘柄（スクリーナー上位＋ウォッチリスト・最大{MAX_UNIVERSE}）</span>
        </div>
        <p className="text-arcdim text-xs mt-2">
          3戦略（A/B/C）を同一条件で一括比較します。シグナルは調整後終値で判定し、翌営業日始値で仮想約定（手数料0・端数切捨て）。
          始値が無い日は終値で代用約定します。初回・全更新は数分程度（約{JQUANTS_EFFECTIVE_RPM}リクエスト/分）。
        </p>
        {error && <p className="text-caution text-sm mt-2 font-mono">{error}</p>}
      </section>

      {result && (
        <>
          <section className="hud-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-arc font-mono">
                実効比較期間: {result.from} 〜 {result.to}（前半/後半 分割日: {result.mid}）
              </span>
              <span className="text-arcdim font-mono text-xs">
                ユニバース {result.universeCount} 銘柄 ／ 代用約定 {totalSubstitute} 件 ／ 失効 {totalLapses} 件
              </span>
            </div>
            {clampNote && <p className="text-arc text-xs mt-2 font-mono">ℹ {clampNote}</p>}
            <p className="text-caution text-xs mt-2">
              ⚠ {STRATEGIES[0].disclaimer} 期待値は1トレード平均リターン、指標は等ウェイト（%）で算出。
              長期参照の戦略（B=200日線等）はウォームアップ分だけ評価開始が後ろにずれます（前半の取引数が少なくなります）。
            </p>
          </section>

          <MetricsTable title="全期間" sub={`${result.from} 〜 ${result.to}`} rows={result.entries.map((e) => ({ name: e.strategyName, m: e.full }))} />
          <div className="grid lg:grid-cols-2 gap-4">
            <MetricsTable title="前半（アウトオブサンプル）" sub={`${result.from} 〜 ${result.mid}`} rows={result.entries.map((e) => ({ name: e.strategyName, m: e.firstHalf }))} />
            <MetricsTable title="後半（アウトオブサンプル）" sub={`${result.mid} 〜 ${result.to}`} rows={result.entries.map((e) => ({ name: e.strategyName, m: e.secondHalf }))} />
          </div>
        </>
      )}
    </div>
  );
}
