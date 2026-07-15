"use client";

/**
 * 日次シグナル（ペーパートレード）— Phase 1 / Task 4。
 * 鮮度確定後に3戦略（既定 C/B 有効・A 無効）を評価してシグナル生成 → 注文キュー（K永続化）→
 * 翌営業日始値で仮想約定 → 成績記録。キルスイッチ発動中は生成停止。実発注は一切行わない。
 * 判断補助であり投資助言ではありません。
 */
import { useEffect, useMemo, useState } from "react";
import PageIntro from "@/components/PageIntro";
import { getProviderMode } from "@/lib/pricing/settings";
import { STRATEGIES } from "@/lib/strategy/strategies";
import { loadPaperAccount, savePaperAccount, loadPaperBrokerSettings, loadValuationSnapshot, valuationPriceMap, type ValuationSnapshot } from "@/lib/paper/paperRepository";
import { computeEquity, resumeKillSwitch, type PaperAccount, type PaperBrokerSettings } from "@/lib/paper/paperBroker";
import { loadOrderQueue } from "@/lib/paper/signalEngineRepository";
import {
  loadSignalEngineSettings,
  saveSignalEngineSettings,
  type SignalEngineSettings,
} from "@/lib/paper/signalEngineRepository";
import { runSignalEngine, type RunSignalEngineResult } from "@/lib/paper/runSignalEngine";
import type { PaperOrder } from "@/lib/paper/paperBroker";

const yen = (n: number) => `${n < 0 ? "-" : ""}¥${Math.abs(Math.round(n)).toLocaleString("ja-JP")}`;

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "profit" | "danger" }) {
  const color = tone === "profit" ? "text-profit" : tone === "danger" ? "text-danger" : "text-arc";
  return (
    <div className="hud-panel p-3">
      <p className="hud-label">{label}</p>
      <p className={`font-mono text-lg mt-1 ${color}`}>{value}</p>
    </div>
  );
}

export default function SignalsPage() {
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [settings, setSettings] = useState<PaperBrokerSettings | null>(null);
  const [engine, setEngine] = useState<SignalEngineSettings | null>(null);
  const [queue, setQueue] = useState<PaperOrder[]>([]);
  const [valuation, setValuation] = useState<ValuationSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<RunSignalEngineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setAccount(loadPaperAccount());
    setSettings(loadPaperBrokerSettings());
    setEngine(loadSignalEngineSettings());
    setQueue(loadOrderQueue());
    setValuation(loadValuationSnapshot());
  };

  useEffect(() => {
    refresh();
  }, []);

  // キルスイッチ評価と同一の値洗い価格（エンジンが永続化した priceByCode 相当）で総資産/DDを算出。
  // エンジン未実行/価格未取得の建玉は建値評価にフォールバックする。
  const equity = useMemo(() => {
    if (!account || !settings) return null;
    return computeEquity(account, settings, valuationPriceMap(valuation));
  }, [account, settings, valuation]);

  // 表示ラベルを動的化: 全建玉を値洗い済みなら評価日を明示、未取得があれば建値評価＋件数を明示。
  const equityLabel =
    equity && equity.fallbackCount === 0
      ? valuation
        ? `総資産(${valuation.asOf}終値評価)`
        : "総資産(建値評価)"
      : `総資産(建値評価・価格未取得${equity?.fallbackCount ?? 0}銘柄)`;

  const toggleStrategy = (id: string, on: boolean) => {
    setEngine(saveSignalEngineSettings({ strategyEnabled: { [id]: on } }));
  };
  const toggleAuto = (on: boolean) => {
    setEngine(saveSignalEngineSettings({ autoEnabled: on }));
  };

  const resume = () => {
    const acc = loadPaperAccount();
    savePaperAccount({ ...acc, killSwitch: resumeKillSwitch(), updatedAt: new Date().toISOString() });
    refresh();
  };

  const run = async () => {
    if (getProviderMode() !== "jquants-ready") {
      setError("J-Quantsモードに切り替えてください（設定 → 価格プロバイダ）。実データ取得が必要です。");
      return;
    }
    setError(null);
    setRunning(true);
    setProgress({ done: 0, total: 1 });
    const r = await runSignalEngine({ onProgress: (done, total) => setProgress({ done, total }) });
    setRunning(false);
    setProgress(null);
    setResult(r);
    refresh();
    if (!r.ran) setError(r.message);
  };

  const ks = account?.killSwitch;

  return (
    <div className="space-y-6">
      <PageIntro
        title="🛰 日次シグナル（ペーパートレード）"
        description="C（主役）・B（観察用）を既定で評価し、翌営業日始値で仮想約定します。A は既定OFF。実発注は行いません。判断補助であり投資助言ではありません。"
        helpKey="pf"
      />

      {ks?.active && (
        <section className="hud-panel p-4 border-danger/50">
          <p className="text-danger font-mono text-sm">⛔ キルスイッチ発動中：シグナル生成を停止しています。</p>
          <p className="text-arcdim text-xs mt-1">{ks.reason}</p>
          <button className="hud-btn mt-2" onClick={resume}>停止を解除して再開</button>
        </section>
      )}

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">◇ 対象戦略・自動実行</h2>
        <div className="flex flex-wrap items-center gap-4">
          {STRATEGIES.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={engine?.strategyEnabled[s.id] ?? false} onChange={(e) => toggleStrategy(s.id, e.target.checked)} />
              <span>{s.name}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm ml-auto">
            <input type="checkbox" checked={engine?.autoEnabled ?? false} onChange={(e) => toggleAuto(e.target.checked)} />
            <span>アプリ起動時に自動実行</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <button className="hud-btn" onClick={run} disabled={running}>
            {running ? (progress ? `処理中 ${progress.done}/${progress.total}` : "実行中…") : "本日のシグナル生成＋約定"}
          </button>
          <span className="text-arcdim text-xs">
            当日終値で判定 → 翌営業日始値で仮想約定（手数料0）。注文キューは永続化され、夜間生成→翌朝約定の再起動を跨ぎます。
          </span>
        </div>
        {result && <p className="text-arc text-sm font-mono mt-2">{result.message}</p>}
        {error && <p className="text-caution text-sm font-mono mt-2">{error}</p>}
      </section>

      {equity && account && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Metric label="運用資金" value={yen(equity.capitalYen)} />
          <Metric label="現金残高" value={yen(account.cash)} tone={account.cash >= 0 ? "neutral" : "danger"} />
          <Metric label="確定損益" value={yen(equity.realizedPnlYen)} tone={equity.realizedPnlYen >= 0 ? "profit" : "danger"} />
          <Metric label={equityLabel} value={yen(equity.equityYen)} tone={equity.equityYen >= equity.capitalYen ? "profit" : "danger"} />
          <Metric label="ドローダウン" value={`${equity.drawdownPct.toFixed(1)}%`} tone={equity.drawdownPct >= 0 ? "profit" : "danger"} />
        </div>
      )}

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-2">◇ 注文キュー（翌営業日始値で約定予定）</h2>
        {queue.length === 0 ? (
          <p className="text-arcdim text-sm">保留中の注文はありません。</p>
        ) : (
          <ul className="space-y-1 text-sm font-mono">
            {queue.map((o, i) => (
              <li key={`${o.strategyId}:${o.code}:${o.side}:${i}`} className="flex flex-wrap gap-x-3">
                <span className={o.side === "buy" ? "text-profit" : "text-danger"}>{o.side === "buy" ? "買" : "売"}</span>
                <span className="text-arc">{o.code}</span>
                <span className="text-arcdim">{o.strategyId}</span>
                <span>{o.shares}株</span>
                <span className="text-arcdim">シグナル日 {o.signalDate}</span>
                <span className="text-arcdim">{o.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-2">◇ 保有ポジション（仮想）</h2>
          {!account || account.positions.length === 0 ? (
            <p className="text-arcdim text-sm">保有ポジションはありません。</p>
          ) : (
            <ul className="space-y-1 text-sm font-mono">
              {account.positions.map((p) => (
                <li key={p.id} className="flex flex-wrap gap-x-3">
                  <span className="text-arc">{p.code}</span>
                  <span className="text-arcdim">{p.strategyId}</span>
                  <span>{p.shares}株</span>
                  <span className="text-arcdim">@{Math.round(p.entryPrice)}</span>
                  <span className="text-arcdim">{p.entryDate}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="hud-panel p-4">
          <h2 className="hud-label mb-2">◇ 確定取引（直近）</h2>
          {!account || account.closedTrades.length === 0 ? (
            <p className="text-arcdim text-sm">確定した取引はまだありません。</p>
          ) : (
            <ul className="space-y-1 text-sm font-mono">
              {account.closedTrades.slice(-12).reverse().map((t) => (
                <li key={t.id} className="flex flex-wrap gap-x-3">
                  <span className="text-arc">{t.code}</span>
                  <span className="text-arcdim">{t.strategyId}</span>
                  <span className={t.pnlYen >= 0 ? "text-profit" : "text-danger"}>{yen(t.pnlYen)}（{t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%）</span>
                  <span className="text-arcdim">{t.exitReason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {result && (result.fills.length > 0 || result.generated.length > 0) && (
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-2">◇ 実行ログ</h2>
          <div className="grid lg:grid-cols-2 gap-4 text-xs font-mono">
            <div>
              <p className="text-arcdim mb-1">約定（保留注文の消化）</p>
              {result.fills.length === 0 ? <p className="text-arcdim">なし</p> : (
                <ul className="space-y-0.5">{result.fills.map((f, i) => <li key={i}>{f.outcome}: {f.code} {f.side} {f.reason}</li>)}</ul>
              )}
            </div>
            <div>
              <p className="text-arcdim mb-1">生成シグナル</p>
              {result.generated.length === 0 ? <p className="text-arcdim">なし</p> : (
                <ul className="space-y-0.5">{result.generated.map((g, i) => <li key={i}>{g}</li>)}</ul>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
