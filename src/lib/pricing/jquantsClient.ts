/**
 * J-Quants Route Handler のクライアントラッパー（ブラウザ側）。
 * 実通信は /api/jquants（サーバ）に集約する。provider.ts と設定画面・一括更新が利用する。
 *
 * トークンキャッシュ:
 *   有効な idToken があれば Route へ渡して再認証を省略する。
 *   Route が新トークンを返した場合はキャッシュへ保存し、失敗時はキャッシュを破棄する。
 */
import type { JQuantsCredentials } from "./provider";
import { getValidIdToken, saveTokens, clearTokenCache } from "./tokenCache";
import { getCachedSeries, setCachedSeries, type SeriesPoint } from "@/lib/analytics/priceCache";

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
  message?: string;
  quotes?: JQuantsQuote[];
  series?: SeriesPoint[];
  token?: { idToken: string; refreshToken: string };
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

/** レスポンスのトークンをキャッシュへ反映する。 */
function syncTokenCache(res: JQuantsResponse): void {
  if (res.token) saveTokens(res.token);
  else if (!res.ok) clearTokenCache();
}

/** 接続テスト（認証のみ）。新トークンをキャッシュする。 */
export async function testJQuantsConnection(
  credentials: JQuantsCredentials | null
): Promise<JQuantsResponse> {
  const res = await callApi({ action: "test", credentials });
  syncTokenCache(res);
  return res;
}

/** 銘柄コード群のクオートを取得する。キャッシュ済み idToken を優先利用する。 */
export async function fetchJQuantsQuotes(
  codes: string[],
  credentials: JQuantsCredentials | null
): Promise<JQuantsResponse> {
  const idToken = getValidIdToken();
  const res = await callApi({ action: "quotes", codes, credentials, idToken });
  syncTokenCache(res);
  return res;
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

  const idToken = getValidIdToken();
  const res = await callApi({ action: "series", code, from, to, credentials, idToken });
  syncTokenCache(res);
  if (res.ok && res.series) {
    setCachedSeries(code, from, to, res.series);
    return { ok: true, series: res.series, cached: false };
  }
  return { ok: false, series: [], message: res.message, cached: false };
}
