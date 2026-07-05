/**
 * 一括価格更新サービス（手動）。
 *
 * 登録銘柄を J-Quants（Route経由）から取得し、current_price / rsi を
 * StockRepository へ反映する。銘柄画面・設定画面の両ボタンから共用する。
 *
 * ・失敗しても全体は止めない（銘柄単位でスキップ）
 * ・レート制限・認証失敗時は ManualPriceProvider の値を維持（更新しない）
 * ・更新結果を簡易ログ（localStorage）に記録する
 *
 * ※ 自動スケジュール実行は未実装（本サービスは明示操作時のみ呼ばれる）。
 */
import { getStockRepository } from "@/lib/storage/stockRepository";
import { calculateRSI } from "@/lib/indicators/rsi";
import { computeVolumeMetrics } from "@/lib/indicators/volume";
import { computeMacdState } from "@/lib/indicators/macd";
import { getProviderMode, getJQuantsCredentials, setJQuantsStatus } from "./settings";
import { fetchJQuantsQuotes } from "./jquantsClient";
import { K } from "@/lib/storage/keys";

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

/** 全登録銘柄の価格・RSI を J-Quants から一括更新する。 */
export async function updateAllPrices(): Promise<BulkUpdateResult> {
  const at = new Date().toISOString();
  const repo = getStockRepository();
  const stocks = await repo.list();

  if (getProviderMode() !== "jquants-ready") {
    return {
      ok: false,
      successCount: 0,
      failedCount: 0,
      rsiCount: 0,
      message: "手入力モードです。設定画面で J-Quants モードに切り替えてください。",
      at,
    };
  }
  if (stocks.length === 0) {
    return { ok: false, successCount: 0, failedCount: 0, rsiCount: 0, message: "対象銘柄がありません。", at };
  }

  const res = await fetchJQuantsQuotes(stocks.map((s) => s.code), getJQuantsCredentials());

  setJQuantsStatus({
    status: res.status,
    at,
    message: res.message ?? (res.ok ? "接続成功" : "接続失敗"),
  });

  // 認証失敗・通信失敗・レート制限 → 手入力値を維持（fallback）し、失敗として記録
  if (!res.ok || !res.quotes) {
    const message = res.message ?? "一部銘柄の更新に失敗しました";
    appendLog({ date: at, successCount: 0, failedCount: stocks.length, message });
    return { ok: false, successCount: 0, failedCount: stocks.length, rsiCount: 0, message, at };
  }

  // 取得結果を current_price / rsi へ反映（RSI 不足時は既存値を維持）
  const byCode = new Map(res.quotes.map((q) => [q.code, q]));
  let success = 0;
  let rsiCount = 0;
  for (const s of stocks) {
    const q = byCode.get(s.code);
    if (q && q.current_price != null) {
      const rsi = calculateRSI(q.closes ?? []);
      if (rsi != null) rsiCount++;
      const vm = computeVolumeMetrics(q.volumes ?? []);
      const macd = computeMacdState(q.closes ?? []);
      const { id, ...rest } = s;
      await repo.update(id, {
        ...rest,
        current_price: q.current_price,
        rsi: rsi ?? rest.rsi,
        // MACD（系列から判定できた場合のみ更新）
        macd: macd !== "不明" ? macd : rest.macd,
        // 出来高指標（取得できた場合のみ更新）
        volume: vm.volume ?? rest.volume,
        relativeVolume: vm.relativeVolume ?? rest.relativeVolume,
        volumeTrend: vm.volume != null ? vm.volumeTrend : rest.volumeTrend,
        price_updated_at: q.date ?? at,
      });
      success++;
    }
  }
  const failedCount = stocks.length - success;
  const message = failedCount === 0 ? "価格更新が完了しました" : "一部銘柄の更新に失敗しました";
  appendLog({ date: at, successCount: success, failedCount, message });
  return { ok: true, successCount: success, failedCount, rsiCount, message, at };
}

/** 個別銘柄の価格・RSI・MACD・出来高を J-Quants から更新する。 */
export async function updateStockPrice(id: string): Promise<{ ok: boolean; message: string }> {
  const repo = getStockRepository();
  const stocks = await repo.list();
  const s = stocks.find((x) => x.id === id);
  if (!s) return { ok: false, message: "銘柄が見つかりません。" };
  if (getProviderMode() !== "jquants-ready") return { ok: false, message: "手入力モードです（設定でJ-Quantsへ切替）。" };

  const at = new Date().toISOString();
  const res = await fetchJQuantsQuotes([s.code], getJQuantsCredentials());
  setJQuantsStatus({ status: res.status, at, message: res.message ?? (res.ok ? "接続成功" : "接続失敗") });
  if (!res.ok || !res.quotes) return { ok: false, message: res.message ?? "取得に失敗しました。" };
  const q = res.quotes.find((x) => x.code === s.code);
  if (!q || q.current_price == null) return { ok: false, message: "価格データを取得できませんでした。" };

  const rsi = calculateRSI(q.closes ?? []);
  const vm = computeVolumeMetrics(q.volumes ?? []);
  const macd = computeMacdState(q.closes ?? []);
  const { id: _id, ...rest } = s;
  void _id;
  await repo.update(id, {
    ...rest,
    current_price: q.current_price,
    rsi: rsi ?? rest.rsi,
    macd: macd !== "不明" ? macd : rest.macd,
    volume: vm.volume ?? rest.volume,
    relativeVolume: vm.relativeVolume ?? rest.relativeVolume,
    volumeTrend: vm.volume != null ? vm.volumeTrend : rest.volumeTrend,
    price_updated_at: q.date ?? at,
  });
  return { ok: true, message: `${s.name} を更新しました（価格/RSI/MACD/出来高）。ファンダ(PER/PBR/ROE等)は手入力です。` };
}
