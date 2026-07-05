/**
 * 一括価格更新サービス。
 *
 * 登録銘柄を PriceProvider（JQuantsPriceProvider）経由で取得し、
 * current_price / rsi / macd / 出来高を StockRepository へ反映する。
 *
 * ・取得・レート制限（5req/分）・進捗・中断は Provider 層に集約（本モジュールは薄いループ）。
 * ・失敗しても全体は止めない（銘柄単位でスキップ・部分成功）。
 * ・認証失敗・レート制限・ユーザー中断は途中で停止し、既更新分は保持する。
 * ・更新結果を簡易ログ（localStorage）に記録する。
 */
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getProviderMode, getJQuantsCredentials, setJQuantsStatus } from "./settings";
import { getPriceProvider, type FetchProgress, type BulkStop, type Quote } from "./provider";
import { K } from "@/lib/storage/keys";
import type { Stock } from "@/lib/types";

const LOG_KEY = K.priceUpdateLog;
const MAX_LOG = 20;

export interface PriceUpdateLog {
  date: string; // ISO datetime
  successCount: number;
  failedCount: number;
  message: string;
}

export interface BulkUpdateResult {
  ok: boolean;
  successCount: number;
  failedCount: number;
  rsiCount: number;
  message: string;
  at: string; // ISO datetime
}

/** 一括更新のオプション（進捗・中断）。 */
export interface BulkUpdateOptions {
  onProgress?: (p: FetchProgress) => void;
  signal?: AbortSignal;
}

export function getUpdateLog(): PriceUpdateLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PriceUpdateLog[]) : [];
  } catch {
    return [];
  }
}

export function getLatestUpdateLog(): PriceUpdateLog | null {
  const log = getUpdateLog();
  return log.length ? log[log.length - 1] : null;
}

function appendLog(record: PriceUpdateLog): void {
  if (typeof window === "undefined") return;
  const log = getUpdateLog();
  log.push(record);
  while (log.length > MAX_LOG) log.shift();
  window.localStorage.setItem(LOG_KEY, JSON.stringify(log));
}

/** 中断理由・件数から利用者向けメッセージを組み立てる。 */
function messageFor(stopped: BulkStop | null, success: number, total: number, failed: number): string {
  switch (stopped) {
    case "aborted":
      return `${success}/${total} 更新（ユーザー中断）`;
    case "rate":
      return `${success}/${total} 更新（レート制限で中断）`;
    case "auth":
      return "認証に失敗しました（APIキーを確認してください）。";
    default:
      return failed === 0 ? "価格更新が完了しました" : `${success}/${total} 更新（一部失敗）`;
  }
}

/** Quote を Stock 更新値へ反映する（欠損は既存値を維持）。 */
function applyQuote(rest: Omit<Stock, "id">, q: Quote): Omit<Stock, "id"> {
  return {
    ...rest,
    current_price: q.price,
    rsi: q.rsi ?? rest.rsi,
    macd: q.macd && q.macd !== "不明" ? q.macd : rest.macd,
    volume: q.volume ?? rest.volume,
    relativeVolume: q.relativeVolume ?? rest.relativeVolume,
    volumeTrend: q.volume != null ? q.volumeTrend ?? rest.volumeTrend : rest.volumeTrend,
    price_updated_at: q.asOf,
  };
}

/** 全登録銘柄の価格・指標を J-Quants から一括更新する（進捗・中断対応）。 */
export async function updateAllPrices(opts?: BulkUpdateOptions): Promise<BulkUpdateResult> {
  const at = new Date().toISOString();
  const repo = getStockRepository();
  const stocks = await repo.list();

  if (getProviderMode() !== "jquants-ready") {
    return { ok: false, successCount: 0, failedCount: 0, rsiCount: 0, message: "手入力モードです。設定画面で J-Quants モードに切り替えてください。", at };
  }
  if (stocks.length === 0) {
    return { ok: false, successCount: 0, failedCount: 0, rsiCount: 0, message: "対象銘柄がありません。", at };
  }

  const provider = getPriceProvider(stocks, "jquants-ready", getJQuantsCredentials());
  const result = await provider.fetchQuotesBulk(
    stocks.map((s) => s.code),
    { onProgress: opts?.onProgress, signal: opts?.signal }
  );

  // 取得できた銘柄を逐次反映（部分成功）。
  const byCode = new Map(result.quotes.map((q) => [q.code, q]));
  let success = 0;
  let rsiCount = 0;
  for (const s of stocks) {
    const q = byCode.get(s.code);
    if (!q) continue;
    if (q.rsi != null) rsiCount++;
    const { id, ...rest } = s;
    await repo.update(id, applyQuote(rest, q));
    success++;
  }
  const failedCount = stocks.length - success;
  const message = messageFor(result.stopped, success, stocks.length, failedCount);

  setJQuantsStatus({
    status: result.stopped === "auth" ? "error" : "connected",
    at,
    message: result.stopped === "auth" ? "認証エラー" : "接続成功",
  });
  appendLog({ date: at, successCount: success, failedCount, message });

  const ok = result.stopped === null && failedCount === 0;
  return { ok, successCount: success, failedCount, rsiCount, message, at };
}

/** 個別銘柄の価格・指標を J-Quants から更新する。 */
export async function updateStockPrice(id: string): Promise<{ ok: boolean; message: string }> {
  const repo = getStockRepository();
  const stocks = await repo.list();
  const s = stocks.find((x) => x.id === id);
  if (!s) return { ok: false, message: "銘柄が見つかりません。" };
  if (getProviderMode() !== "jquants-ready") return { ok: false, message: "手入力モードです（設定でJ-Quantsへ切替）。" };

  const at = new Date().toISOString();
  const provider = getPriceProvider(stocks, "jquants-ready", getJQuantsCredentials());
  const result = await provider.fetchQuotesBulk([s.code]);
  const q = result.quotes.find((x) => x.code === s.code);

  setJQuantsStatus({
    status: result.stopped === "auth" ? "error" : q ? "connected" : "error",
    at,
    message: q ? "接続成功" : result.stopped === "auth" ? "認証エラー" : "取得失敗",
  });

  if (!q) {
    const msg =
      result.stopped === "auth"
        ? "認証に失敗しました（APIキーを確認してください）。"
        : result.stopped === "rate"
        ? "レート制限に達しました。時間をおいて再試行してください。"
        : "価格データを取得できませんでした。";
    return { ok: false, message: msg };
  }

  const { id: _id, ...rest } = s;
  void _id;
  await repo.update(id, applyQuote(rest, q));
  return { ok: true, message: `${s.name} を更新しました（価格/RSI/MACD/出来高）。ファンダ(PER/PBR/ROE等)は手入力です。` };
}
