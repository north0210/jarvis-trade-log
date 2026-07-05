/**
 * J-Quants API V2 の純粋ヘルパ（fetch / window に依存しない）。
 *
 * V2 仕様（公式ドキュメント準拠・2025-12 リリース）:
 *   - 認証: `x-api-key: <APIキー>` ヘッダ 1 本（V1 のトークン交換は廃止）。
 *   - ベース: https://api.jquants.com/v2
 *   - 株価四本値: GET /equities/bars/daily（code|date 必須、from/to/pagination_key 任意）
 *   - レスポンス: { data: V2DailyBar[], pagination_key?: string }
 *   - フィールド略号: Date / Code / O H L C / AdjO AdjH AdjL AdjC / Vo / AdjVo / Va / AdjFactor …
 *
 * ここは通信・整形の「対応表」を 1 箇所に集約し、route / テストの単一の真実とする。
 */

export const JQUANTS_V2_BASE = "https://api.jquants.com/v2";
export const DAILY_BARS_PATH = "/equities/bars/daily";

/** V2 株価四本値の 1 レコード（使用フィールドのみ。他は無視）。 */
export interface V2DailyBar {
  Date?: string; // YYYY-MM-DD
  Code?: string;
  C?: number | null; // 終値（調整前）
  AdjC?: number | null; // 調整済み終値
  Vo?: number | null; // 取引高（調整前）
}

/** アプリ内部で扱う日足の 1 点（priceCache.SeriesPoint と同形）。 */
export interface InternalBar {
  date: string;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
}

/** provider.ts の JQuantsQuote と同形（RSI/出来高算出用の系列を含む）。 */
export interface DerivedQuote {
  code: string;
  current_price: number | null;
  previous_close: number | null;
  change: number | null;
  change_rate: number | null;
  volume: number | null;
  date: string | null;
  closes: number[]; // 古い→新しい順
  volumes: number[]; // 古い→新しい順
}

/** 銘柄コードを J-Quants 形式（5桁）へ変換する（4桁 → 末尾0付与）。 */
export function toJQuantsCode(code: string): string {
  const c = code.trim();
  return c.length === 4 ? `${c}0` : c;
}

/**
 * APIキーを解決する（env 優先 → リクエスト由来）。空文字は未設定として扱う。
 * env は route（サーバ側）で `process.env.JQUANTS_API_KEY` を渡す。
 */
export function pickApiKey(
  envKey: string | undefined | null,
  bodyKey: string | undefined | null
): string | null {
  const e = typeof envKey === "string" ? envKey.trim() : "";
  if (e) return e;
  const b = typeof bodyKey === "string" ? bodyKey.trim() : "";
  return b ? b : null;
}

/** V2 レコード → 内部日足へ変換（終値は C 優先・無ければ AdjC）。 */
export function mapDailyBar(bar: V2DailyBar): InternalBar {
  return {
    date: bar.Date ?? "",
    close: bar.C ?? bar.AdjC ?? null,
    adjClose: bar.AdjC ?? null,
    volume: bar.Vo ?? null,
  };
}

/** V2 レコード配列 → 日付昇順の内部日足（無効日付・終値null は除外）。 */
export function mapDailyBars(bars: V2DailyBar[]): InternalBar[] {
  return bars
    .map(mapDailyBar)
    .filter((x) => x.date && x.close != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

const isFiniteNum = (v: number | null): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * 内部日足（未整列可）から最新クオートを導出する。データ無しは null。
 * closes/volumes は RSI・出来高・MACD 算出用に有限値のみを昇順で返す。
 */
export function deriveQuote(code: string, bars: InternalBar[]): DerivedQuote | null {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return null;

  const latest = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const close = latest.close;
  const prevClose = prev ? prev.close : null;
  const change = close != null && prevClose != null ? close - prevClose : null;
  const changeRate = change != null && prevClose ? (change / prevClose) * 100 : null;

  const closes = sorted.map((d) => d.close).filter(isFiniteNum);
  const volumes = sorted.map((d) => d.volume).filter(isFiniteNum);

  return {
    code,
    current_price: close,
    previous_close: prevClose,
    change,
    change_rate: changeRate,
    volume: latest.volume,
    date: latest.date || null,
    closes,
    volumes,
  };
}

/** 日足バーの取得 URL を組み立てる（pagination_key 任意）。 */
export function buildDailyBarsUrl(params: {
  code: string;
  from?: string;
  to?: string;
  paginationKey?: string;
}): string {
  const q = new URLSearchParams();
  q.set("code", toJQuantsCode(params.code));
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.paginationKey) q.set("pagination_key", params.paginationKey);
  return `${JQUANTS_V2_BASE}${DAILY_BARS_PATH}?${q.toString()}`;
}
