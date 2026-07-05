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
export const FINS_SUMMARY_PATH = "/fins/summary";

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

/** APIキーの取得経路（診断用・値は含めない）。 */
export type ApiKeySource = "env" | "input" | null;

/**
 * APIキーを解決する（env 優先 → リクエスト由来）。空白のみは未設定として扱う。
 * 取得経路（env / 画面入力 / なし）も返し、env 空値の横取りを診断可能にする。
 * env は route（サーバ側）で `process.env.JQUANTS_API_KEY` を渡す。
 */
export function resolveApiKey(
  envKey: string | undefined | null,
  bodyKey: string | undefined | null
): { key: string | null; source: ApiKeySource } {
  const e = typeof envKey === "string" ? envKey.trim() : "";
  if (e) return { key: e, source: "env" };
  const b = typeof bodyKey === "string" ? bodyKey.trim() : "";
  if (b) return { key: b, source: "input" };
  return { key: null, source: null };
}

/** APIキーのみを解決する（後方互換）。 */
export function pickApiKey(
  envKey: string | undefined | null,
  bodyKey: string | undefined | null
): string | null {
  return resolveApiKey(envKey, bodyKey).key;
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

/**
 * サブスクリプション範囲外エラー（400）のメッセージから対象期間を抽出する。
 * 例: "Your subscription covers the following dates: 2024-04-12 ~ 2026-04-12. ..."
 * 見つからなければ null。
 */
export function parseSubscriptionRange(message: string): { from: string; to: string } | null {
  const m = message.match(/(\d{4}-\d{2}-\d{2})\s*[~〜]\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  return { from: m[1], to: m[2] };
}

const dateToMs = (d: string): number =>
  Date.parse(d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d);
const msToDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * 要求窓 [from,to] を購読カバレッジ終端に合わせてクランプする。
 * - coverageEnd が無い、または to がカバレッジ内（to<=coverageEnd）なら無変更。
 * - to がカバレッジ外なら、**窓の幅を保ったまま**終端を coverageEnd に寄せる
 *   （例: 直近120日要求 → [coverageEnd-120日, coverageEnd]）。
 * これにより無料プランは最新の取得可能データを、有料プランは今日までを自然に取得する。
 */
export function clampToCoverage(
  from: string,
  to: string,
  coverageEnd: string | null
): { from: string; to: string; clamped: boolean } {
  if (!coverageEnd) return { from, to, clamped: false };
  if (dateToMs(to) <= dateToMs(coverageEnd)) return { from, to, clamped: false };
  const widthMs = Math.max(0, dateToMs(to) - dateToMs(from));
  const newTo = coverageEnd.slice(0, 10);
  const newFrom = msToDate(dateToMs(coverageEnd) - widthMs);
  return { from: newFrom, to: newTo, clamped: true };
}

/**
 * V2 財務情報（/fins/summary）の 1 レコード（生ワイヤ型）。
 * ※ 数値項目も **文字列で返り、空欄は空文字 ""**（fundamentals.ts でパースする）。
 */
export interface V2FinRecord {
  DiscDate?: string; // 開示日 YYYY-MM-DD
  Code?: string; // 5桁
  DocType?: string; // 例 "3QFinancialStatements_Consolidated_IFRS"
  CurPerType?: string; // 1Q/2Q/3Q/4Q/5Q/FY
  CurPerSt?: string; // 会計期間開始
  CurPerEn?: string; // 会計期間終了
  Sales?: string; // 売上高
  OP?: string; // 営業利益
  OdP?: string; // 経常利益（IFRS/米国基準は空）
  NP?: string; // 当期純利益
  TA?: string; // 総資産
  Eq?: string; // 純資産
  EPS?: string; // 一株当たり当期純利益
  BPS?: string; // 一株当たり純資産
  ShOutFY?: string; // 期末発行済株式数
}

/** 財務情報の取得 URL を組み立てる（code 指定・pagination_key 任意）。 */
export function buildFinsUrl(params: { code: string; paginationKey?: string }): string {
  const q = new URLSearchParams();
  q.set("code", toJQuantsCode(params.code));
  if (params.paginationKey) q.set("pagination_key", params.paginationKey);
  return `${JQUANTS_V2_BASE}${FINS_SUMMARY_PATH}?${q.toString()}`;
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
