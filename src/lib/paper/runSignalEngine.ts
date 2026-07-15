/**
 * 日次シグナルエンジンのオーケストレーション（Phase 1 / Task 4）。
 *
 * アプリ起動中に1回：候補系列を取得 → 保留注文を翌営業日始値で約定 →
 * キルスイッチ評価 → （発動していなければ）新規シグナル生成 → 注文キュー/口座を永続化。
 * 実発注は一切行わない。純粋な判定・約定・記録は signalEngine / paperBroker に委譲。
 */
import type { SeriesPoint } from "@/lib/analytics/priceCache";
import { fetchJQuantsSeries, describeSeriesFailure } from "@/lib/pricing/jquantsClient";
import { getProviderMode, getJQuantsCredentials } from "@/lib/pricing/settings";
import { loadScreenerSnapshot } from "@/lib/screener/screenerRepository";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { STRATEGIES } from "@/lib/strategy/strategies";
import { loadPaperAccount, savePaperAccount, loadPaperBrokerSettings, saveValuationSnapshot } from "./paperRepository";
import { evaluateKillSwitch, type KillSwitchState } from "./paperBroker";
import { fillPendingOrders, generateDailyOrders, type FillLogEntry } from "./signalEngine";
import { loadOrderQueue, saveOrderQueue, loadSignalEngineSettings, enabledStrategyIds } from "./signalEngineRepository";

const SCREENER_TOP = 12;
const MAX_ENTRY_UNIVERSE = 15;
const HISTORY_YEARS = 2; // B=200日線等の指標ウォームアップに十分な履歴

/** ローカル(JST)日付で YYYY-MM-DD 化（UTC 変換の1日ずれ＝購読範囲400 を避ける）。 */
const fmtLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dedupe(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of codes) {
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

export interface RunSignalEngineResult {
  ran: boolean;
  reason?: string;
  fills: FillLogEntry[];
  substituteFills: number;
  generated: string[];
  blocked: boolean; // キルスイッチで生成停止
  killSwitch: KillSwitchState;
  queueSize: number;
  positions: number;
  fetchFailed: number;
  message: string;
}

export async function runSignalEngine(opts?: {
  now?: Date;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<RunSignalEngineResult> {
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();
  const account0 = loadPaperAccount();

  if (getProviderMode() !== "jquants-ready") {
    return { ran: false, reason: "manual-mode", fills: [], substituteFills: 0, generated: [], blocked: false, killSwitch: account0.killSwitch, queueSize: loadOrderQueue().length, positions: account0.positions.length, fetchFailed: 0, message: "手入力モードです。設定で J-Quants モードに切り替えてください。" };
  }

  const brokerSettings = loadPaperBrokerSettings();
  const engineSettings = loadSignalEngineSettings();
  const queue = loadOrderQueue();

  // ユニバース: エントリー候補（スクリーナー上位＋ウォッチ）＋ 保有・保留の銘柄（約定/手仕舞い評価用）。
  const snap = loadScreenerSnapshot();
  const top = (snap?.rows ?? []).slice(0, SCREENER_TOP).map((r) => r.code);
  const watch = (await getStockRepository().list()).map((s) => s.code);
  const entryCodes = dedupe([...top, ...watch]).slice(0, MAX_ENTRY_UNIVERSE);
  const allCodes = dedupe([...entryCodes, ...account0.positions.map((p) => p.code), ...queue.map((o) => o.code)]);

  const toStr = fmtLocalDate(now);
  const fromStr = fmtLocalDate(new Date(now.getFullYear() - HISTORY_YEARS, now.getMonth(), now.getDate()));
  const creds = getJQuantsCredentials();

  const seriesByCode = new Map<string, SeriesPoint[]>();
  let fetchFailed = 0;
  let firstFail: { code: string; reason?: "auth" | "rate"; httpStatus?: number; message?: string } | null = null;
  for (let i = 0; i < allCodes.length; i++) {
    const res = await fetchJQuantsSeries(allCodes[i], fromStr, toStr, creds, { requireOpen: true });
    if (res.ok && res.series.length > 0) seriesByCode.set(allCodes[i], res.series);
    else {
      fetchFailed++;
      if (!res.ok && !firstFail) firstFail = { code: allCodes[i], reason: res.reason, httpStatus: res.httpStatus, message: res.message };
    }
    opts?.onProgress?.(i + 1, allCodes.length);
    if (opts?.signal?.aborted) break;
  }

  // 1) 保留注文を翌営業日始値で約定。
  const fill = fillPendingOrders({ orders: queue, seriesByCode, account: account0, now: nowIso });
  let account = fill.account;

  // 2) キルスイッチ評価（最新終値でマーク）。表示と同一基準にするため priceByCode を永続化する。
  const priceByCode = new Map<string, number | null>();
  const valuationPrices: Record<string, number> = {};
  let valuationAsOf = "";
  seriesByCode.forEach((series, code) => {
    const closes = series.filter((p) => p.adjClose != null);
    const last = closes.length ? closes[closes.length - 1] : null;
    const px = last ? (last.adjClose as number) : null;
    priceByCode.set(code, px);
    if (last && typeof px === "number" && px > 0) {
      valuationPrices[code] = px;
      if (last.date > valuationAsOf) valuationAsOf = last.date; // priced 銘柄の最遅終値日
    }
  });
  const killSwitch = evaluateKillSwitch(account, brokerSettings, priceByCode, nowIso);
  account = { ...account, killSwitch };

  // 3) 新規シグナル生成（キルスイッチ発動中は blocked）。
  const gen = generateDailyOrders({
    strategies: STRATEGIES,
    enabledIds: enabledStrategyIds(engineSettings),
    seriesByCode,
    entryCodes,
    account,
    settings: brokerSettings,
    killSwitchActive: killSwitch.active,
    existingOrders: fill.remaining,
  });

  // 4) 永続化（キュー＝残保留＋新規注文 / 口座 / 値洗いスナップショット）。
  const newQueue = [...fill.remaining, ...gen.orders];
  saveOrderQueue(newQueue);
  savePaperAccount({ ...account, updatedAt: nowIso });
  saveValuationSnapshot({ asOf: valuationAsOf || toStr, prices: valuationPrices });

  const filledCount = fill.log.filter((l) => l.outcome === "filled").length;
  const failNote = firstFail ? `／取得失敗 ${fetchFailed}（${describeSeriesFailure(firstFail, firstFail.code)}）` : fetchFailed ? `／取得失敗 ${fetchFailed}` : "";
  const message = killSwitch.active
    ? `キルスイッチ発動中: 生成停止。約定 ${filledCount} 件${failNote}`
    : `約定 ${filledCount} 件・新規注文 ${gen.orders.length} 件${failNote}`;

  return {
    ran: true,
    fills: fill.log,
    substituteFills: fill.substituteFills,
    generated: gen.log,
    blocked: gen.blocked,
    killSwitch,
    queueSize: newQueue.length,
    positions: account.positions.length,
    fetchFailed,
    message,
  };
}
