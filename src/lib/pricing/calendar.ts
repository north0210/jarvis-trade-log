/**
 * 取引カレンダーに基づく「期待される最新データ日（expectedAsOf）」の算出（PriceProvider 層）。
 *
 * J-Quants /markets/calendar の営業日集合を用い、JST の現在時刻から
 * 「今どの営業日までのデータが配信済みか」を厳密に判定する。
 * カレンダーは localStorage に 24h キャッシュ（K レジストリ経由）。
 *
 * ★ プラン差分は EXPECTED_LAG_TRADING_DAYS で一元制御する:
 *    - Light: 0（当日 16:30 配信後は当日まで取得可）
 *    - Free : 旧「12週遅延」相当（≈60 営業日）。値を戻すだけで Free 復帰できる構造。
 */
import { K } from "@/lib/storage/keys";
import { fetchJQuantsCalendar } from "./jquantsClient";
import type { JQuantsCredentials } from "./provider";
import type { V2CalendarRecord } from "./jquantsV2";

// ---- 名前付き定数（一元定義） ----
export const PUBLISH_TIME_JST = "16:30";
export const PUBLISH_BUFFER_MIN = 60;
/** 期待される最新データの遅延（営業日数）。Light=0 / Free≈60。 */
export const EXPECTED_LAG_TRADING_DAYS = 0;
export const CALENDAR_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * カレンダー未取得（静的フォールバック）時の欠落許容（営業日数）。
 * 祝日を土日判定で拾えないぶん、最大 2 営業日の遅れは stale 扱いしない。
 */
export const STATIC_FALLBACK_TOLERANCE_TRADING_DAYS = 2;

const CALENDAR_KEY = K.marketCalendar;
/** 営業日とみなす HolDiv（1=通常営業日・2=東証半日立会日）。 */
const TRADING_HOLDIV = new Set(["1", "2"]);

const pad = (n: number) => String(n).padStart(2, "0");
const utcYmd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "HH:MM" を分に変換。 */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** now（UTC 実体）を JST 壁時計へ変換し、日付(YYYY-MM-DD)と 0時からの分を返す。 */
export function jstParts(now: Date): { ymd: string; minutes: number } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC+9
  const ymd = `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
  const minutes = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  return { ymd, minutes };
}

/** "YYYY-MM-DD" を UTC 深夜の Date へ（曜日計算専用）。 */
function ymdToUTC(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/** 月〜金なら true（0=日, 6=土）。 */
function isWeekday(d: Date): boolean {
  const wd = d.getUTCDay();
  return wd >= 1 && wd <= 5;
}

/** ymd から n 平日ぶん過去へ戻した日付（土日はスキップ・静的 tolerance 計算用）。 */
function shiftBackWeekdays(ymd: string, n: number): string {
  let d = ymdToUTC(ymd);
  let rem = n;
  while (rem > 0) {
    d = new Date(d.getTime() - DAY_MS);
    if (isWeekday(d)) rem--;
  }
  return utcYmd(d);
}

/** カレンダー生レコード → 営業日（HolDiv∈{1,2}）の昇順配列。 */
export function parseTradingDays(records: V2CalendarRecord[]): string[] {
  return records
    .filter((r) => r.Date && TRADING_HOLDIV.has(r.HolDiv ?? ""))
    .map((r) => r.Date as string)
    .sort();
}

/**
 * 期待される最新データ日を計算する（純関数・時刻は注入）。
 * - 当日が営業日 かつ JST が 16:30+buffer 以降 → 当日を「配信済み最新」とする。
 * - それ以外（配信前 or 当日が非営業日）→ 直近の過去営業日。
 * - さらに EXPECTED_LAG_TRADING_DAYS ぶん過去の営業日へ下げる（Light=0）。
 */
export function computeExpectedAsOf(now: Date, tradingDays: string[], lagTradingDays = EXPECTED_LAG_TRADING_DAYS): string {
  const tds = tradingDays;
  if (tds.length === 0) return "";
  const { ymd, minutes } = jstParts(now);
  const todayTrading = tds.includes(ymd);
  const publishCutoff = timeToMinutes(PUBLISH_TIME_JST) + PUBLISH_BUFFER_MIN;
  const published = todayTrading && minutes >= publishCutoff;

  let baseIdx: number;
  if (published) {
    baseIdx = tds.indexOf(ymd);
  } else {
    baseIdx = -1;
    for (let i = tds.length - 1; i >= 0; i--) {
      if (tds[i] < ymd) {
        baseIdx = i;
        break;
      }
    }
  }
  if (baseIdx < 0) return tds[0];
  const idx = Math.max(0, baseIdx - Math.max(0, lagTradingDays));
  return tds[idx];
}

// ---- キャッシュ（localStorage・24h TTL・K 経由） ----

export interface TradingCalendarCache {
  fetchedAt: string; // ISO
  tradingDays: string[];
}

/** キャッシュを読む（破損時は null）。TTL 判定は呼び出し側。 */
export function loadTradingCalendar(): TradingCalendarCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CALENDAR_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<TradingCalendarCache>;
    if (typeof p.fetchedAt === "string" && Array.isArray(p.tradingDays)) {
      return { fetchedAt: p.fetchedAt, tradingDays: p.tradingDays as string[] };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveTradingCalendar(cache: TradingCalendarCache): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CALENDAR_KEY, JSON.stringify(cache));
  } catch {
    /* 容量超過等は無視（regenerable） */
  }
}

/** キャッシュが TTL 内か。 */
export function isCalendarFresh(cache: TradingCalendarCache | null, now: Date): boolean {
  return !!cache && now.getTime() - Date.parse(cache.fetchedAt) < CALENDAR_TTL_MS;
}

/**
 * 期待される最新データ日を静的に推定する（カレンダー無しのフォールバック）。
 * 土日のみ除外し、直近の平日を返す（祝日は判定できない → 欠落は tolerance で吸収）。
 * 配信時刻（16:30+buffer）前は当日を除外して前平日へ下げる。
 */
export function staticExpectedAsOf(now: Date): string {
  const { ymd, minutes } = jstParts(now);
  const publishCutoff = timeToMinutes(PUBLISH_TIME_JST) + PUBLISH_BUFFER_MIN;
  let d = ymdToUTC(ymd);
  const published = isWeekday(d) && minutes >= publishCutoff;
  if (!published) d = new Date(d.getTime() - DAY_MS);
  while (!isWeekday(d)) d = new Date(d.getTime() - DAY_MS);
  return utcYmd(d);
}

/** expectedAsOf の由来。calendar=鮮度内 / calendar-stale=期限切れ流用 / static=静的退避。 */
export type ExpectedAsOfSource = "calendar" | "calendar-stale" | "static";

export interface ExpectedAsOfResult {
  /** 期待される最新データ日（YYYY-MM-DD）。 */
  date: string;
  source: ExpectedAsOfSource;
  /** stale 判定時に許容する欠落営業日数（static のみ 2、他は 0）。 */
  toleranceTradingDays: number;
}

/**
 * 期待される最新データ日を由来つきで解決する（フォールバック内蔵）。
 * 1) 鮮度内キャッシュ → カレンダー計算（tolerance 0）
 * 2) 期限切れキャッシュ → そのまま流用（stale-while-error, warn, tolerance 0）
 * 3) キャッシュ皆無 → 静的な土日判定へ退避（warn, tolerance 2）
 */
export function resolveExpectedAsOf(now: Date = new Date()): ExpectedAsOfResult {
  const cache = loadTradingCalendar();
  if (cache && cache.tradingDays.length > 0) {
    const date = computeExpectedAsOf(now, cache.tradingDays);
    if (isCalendarFresh(cache, now)) {
      return { date, source: "calendar", toleranceTradingDays: 0 };
    }
    // stale-while-error: 期限切れでも既存の営業日集合で判定する（鍵・個人情報は出さない）。
    console.warn("[calendar] 取引カレンダーが期限切れ（stale-while-error）: 既存の営業日集合で判定します");
    return { date, source: "calendar-stale", toleranceTradingDays: 0 };
  }
  // フォールバック: 静的な土日判定（祝日ぶんは tolerance で許容）。
  console.warn("[calendar] 取引カレンダー未取得: 静的な土日判定へ退避（最大 2 営業日の欠落は stale 扱いしない）");
  return {
    date: staticExpectedAsOf(now),
    source: "static",
    toleranceTradingDays: STATIC_FALLBACK_TOLERANCE_TRADING_DAYS,
  };
}

/**
 * 期待される最新データ日（フォールバック内蔵の薄いラッパ）。
 * 由来・tolerance が必要なら resolveExpectedAsOf を使う。
 */
export function expectedAsOf(now: Date): string {
  return resolveExpectedAsOf(now).date;
}

export interface StalenessResult {
  /** 保有データが期待鮮度に届いていない（更新が必要）か。 */
  stale: boolean;
  /** 期待される最新データ日（YYYY-MM-DD）。 */
  expected: string;
  /** fresh とみなす下限日（expected を tolerance 営業日ぶん戻した日）。 */
  threshold: string;
  source: ExpectedAsOfSource;
  toleranceTradingDays: number;
}

/**
 * 保有データ日 currentAsOf が期待鮮度に対して stale か判定する（純判定）。
 * - fresh 条件: currentAsOf >= threshold（= expected を tolerance 営業日戻した日）。
 * - currentAsOf 無し（未取得）→ 常に stale。
 * - static フォールバック時は tolerance=2 営業日ぶん緩和（祝日の取りこぼし対策）。
 */
export function isDataStale(currentAsOf: string | null, now: Date = new Date()): StalenessResult {
  const { date: expected, source, toleranceTradingDays } = resolveExpectedAsOf(now);
  const threshold = toleranceTradingDays > 0 && expected ? shiftBackWeekdays(expected, toleranceTradingDays) : expected;
  const stale = !currentAsOf || (!!expected && currentAsOf < threshold);
  return { stale, expected, threshold, source, toleranceTradingDays };
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 取引カレンダーを取得してキャッシュする（過去120日〜先14日）。
 * 共有＋サーバ側リミッタ経由（fetchJQuantsCalendar が acquire）。失敗時は false。
 */
export async function refreshTradingCalendar(
  credentials: JQuantsCredentials | null,
  now: Date = new Date()
): Promise<boolean> {
  const from = fmtDate(new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000));
  const to = fmtDate(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000));
  const res = await fetchJQuantsCalendar(from, to, credentials);
  if (!res.ok || !res.calendar) return false;
  const tradingDays = parseTradingDays(res.calendar);
  if (tradingDays.length === 0) return false;
  saveTradingCalendar({ fetchedAt: now.toISOString(), tradingDays });
  return true;
}

/**
 * 取引カレンダーが鮮度内なら何もせず、そうでなければ 1 回だけ取得を試みる。
 * 取得失敗（レート/認証/オフライン）は握りつぶし、判定側は 2-2 フォールバックへ委ねる。
 * 返り値: 呼び出し後にカレンダーが利用可能（鮮度内 or 取得成功）か。
 */
export async function ensureTradingCalendar(
  credentials: JQuantsCredentials | null,
  now: Date = new Date()
): Promise<boolean> {
  if (isCalendarFresh(loadTradingCalendar(), now)) return true;
  return refreshTradingCalendar(credentials, now);
}
