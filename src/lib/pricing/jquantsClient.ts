/**
 * J-Quants Route Handler のクライアントラッパー（ブラウザ側）。
 * 実通信は /api/jquants（サーバ）に集約する。provider.ts と設定画面・一括更新が利用する。
 *
 * 認証（V2）: credentials.apiKey を body に載せて Route へ渡す。
 *   Route 側で env（JQUANTS_API_KEY）優先 → body.apiKey の順に解決する。
 *   V1 のトークンキャッシュ（idToken）は廃止（tokenCache.ts は @deprecated 残置）。
 */
import type { JQuantsCredentials } from "./provider";
import { getCachedSeries, setCachedSeries, type SeriesPoint } from "@/lib/analytics/priceCache";
import type { V2FinRecord, V2MasterRecord, V2CalendarRecord } from "./jquantsV2";
import { getJQuantsRateLimiter } from "./rateLimiter";

export interface JQuantsQuote {
  code: string;
  current_price: number | null;
  previous_close: number | null;
  change: number | null;
  change_rate: number | null;
  volume: number | null; // 将来拡張（現状 Stock 型に保存しない）
  date: string | null;
  closes: number[]; // RSI 自動計算用の終値系列（古い→新しい順）
  volumes: number[]; // 出来高系列（古い→新しい順・Phase 42）
}

export interface JQuantsResponse {
  ok: boolean;
  status: "connected" | "error" | "unset";
  /** 失敗理由（認証/レート制限）。bulk 更新の中断判定に使用。 */
  reason?: "auth" | "rate";
  message?: string;
  quotes?: JQuantsQuote[];
  series?: SeriesPoint[];
  fins?: V2FinRecord[];
  master?: V2MasterRecord[];
  bars?: import("./jquantsV2").V2DailyBar[];
  calendar?: V2CalendarRecord[];
  pages?: number; // pagination の実ページ数（初回バッチ見積り用）
  date?: string; // bars-by-date で実際に取得した日付（クランプ後）
}

export interface SeriesResult {
  ok: boolean;
  series: SeriesPoint[];
  message?: string;
  cached: boolean;
}

async function callApi(body: unknown): Promise<JQuantsResponse> {
  try {
    const res = await fetch("/api/jquants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as JQuantsResponse;
  } catch (e) {
    return { ok: false, status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** 認証情報から V2 APIキーを取り出す。 */
function apiKeyOf(credentials: JQuantsCredentials | null): string | undefined {
  return credentials?.apiKey;
}

/** 接続テスト（APIキー認証の疎通確認）。共有リミッタ（5req/分）を消費する。 */
export async function testJQuantsConnection(
  credentials: JQuantsCredentials | null
): Promise<JQuantsResponse> {
  await getJQuantsRateLimiter().acquire();
  return callApi({ action: "test", apiKey: apiKeyOf(credentials) });
}

/** 銘柄コード群のクオートを取得する（V2・APIキー）。 */
export async function fetchJQuantsQuotes(
  codes: string[],
  credentials: JQuantsCredentials | null
): Promise<JQuantsResponse> {
  return callApi({ action: "quotes", codes, apiKey: apiKeyOf(credentials) });
}

/** 取引カレンダー（/markets/calendar）を取得する。共有リミッタ（単発）を消費。 */
export async function fetchJQuantsCalendar(
  from: string | undefined,
  to: string | undefined,
  credentials: JQuantsCredentials | null
): Promise<JQuantsResponse> {
  await getJQuantsRateLimiter().acquire();
  return callApi({ action: "calendar", from, to, apiKey: apiKeyOf(credentials) });
}

/** 上場銘柄マスタ（/equities/master・date スナップショット）を取得する。 */
export async function fetchJQuantsMaster(
  date: string | undefined,
  credentials: JQuantsCredentials | null
): Promise<JQuantsResponse> {
  return callApi({ action: "master", date, apiKey: apiKeyOf(credentials) });
}

/** 指定日の全銘柄株価（/equities/bars/daily?date=）を取得する。 */
export async function fetchJQuantsBarsByDate(
  date: string,
  credentials: JQuantsCredentials | null
): Promise<JQuantsResponse> {
  return callApi({ action: "bars-by-date", date, apiKey: apiKeyOf(credentials) });
}

/** 銘柄の財務情報（/fins/summary 生レコード）を取得する（V2・APIキー）。 */
export async function fetchJQuantsFins(
  code: string,
  credentials: JQuantsCredentials | null
): Promise<JQuantsResponse> {
  return callApi({ action: "fins", code, apiKey: apiKeyOf(credentials) });
}

/** 期間指定の日足系列を取得（キャッシュ優先）。 */
export async function fetchJQuantsSeries(
  code: string,
  from: string,
  to: string,
  credentials: JQuantsCredentials | null
): Promise<SeriesResult> {
  const cached = getCachedSeries(code, from, to);
  if (cached) return { ok: true, series: cached, cached: true };

  // キャッシュミス時のみ実通信 → 共有リミッタ（5req/分）を消費する。
  await getJQuantsRateLimiter().acquire();
  const res = await callApi({ action: "series", code, from, to, apiKey: apiKeyOf(credentials) });
  if (res.ok && res.series) {
    setCachedSeries(code, from, to, res.series);
    return { ok: true, series: res.series, cached: false };
  }
  return { ok: false, series: [], message: res.message, cached: false };
}
