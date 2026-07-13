/**
 * スクリーナー日次/週次 自動更新（完全ローカル・ADR_001）。
 *
 * cron 不可のため「アプリ起動中に鮮度判定して1回だけ実行」方式（auto-report と同型）。
 * - 鮮度: 週末skip → 当該期間 未チェック → probe でアンカーが前進していれば更新。
 * - 差分: bars は毎回フル再取得（生系列は永続化しない）／fins は前回 snapshot から再利用。
 * - 多重防止: 期間キーによる重複抑止 ＋ TTL ロック（30分・複数タブ排他）。
 * - すべて共有＋サーバ側リミッタ経由（新規リミッタなし）。中断/破棄は runScreener の方針を継承。
 */
import { K } from "@/lib/storage/keys";
import { fetchJQuantsBarsByDate } from "@/lib/pricing/jquantsClient";
import { getJQuantsRateLimiter } from "@/lib/pricing/rateLimiter";
import { getProviderMode, getJQuantsCredentials } from "@/lib/pricing/settings";
import { isDataStale, ensureTradingCalendar } from "@/lib/pricing/calendar";
import { loadScreenerSnapshot, type ScreenerSnapshot } from "./screenerRepository";
import { runScreener, type ScreenerPhase } from "./screenerRun";
import type { ScreenerRow } from "./technical";
import type { Fundamentals } from "@/lib/pricing/fundamentals";

const SETTINGS_KEY = K.screenerAutoSettings;
const LOCK_TTL_MS = 30 * 60 * 1000; // 30分
/** 前回開示がこの日数以内なら fins を再利用（四半期更新のため約1四半期）。 */
const FINS_REUSE_MAX_AGE_DAYS = 90;

export type ScreenerFrequency = "daily" | "weekly";

export interface ScreenerAutoSettings {
  enabled: boolean;
  frequency: ScreenerFrequency;
  lastCheckedPeriod: string | null;
  lockUntil: string | null; // ISO
}

const DEFAULTS: ScreenerAutoSettings = { enabled: false, frequency: "daily", lastCheckedPeriod: null, lockUntil: null };

export function getScreenerAutoSettings(): ScreenerAutoSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<ScreenerAutoSettings>;
    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : false,
      frequency: p.frequency === "weekly" ? "weekly" : "daily",
      lastCheckedPeriod: typeof p.lastCheckedPeriod === "string" ? p.lastCheckedPeriod : null,
      lockUntil: typeof p.lockUntil === "string" ? p.lockUntil : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setScreenerAutoSettings(patch: Partial<ScreenerAutoSettings>): ScreenerAutoSettings {
  const merged = { ...getScreenerAutoSettings(), ...patch };
  if (typeof window !== "undefined") window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

// ---- 純関数（テスト対象） ----

/** 頻度に応じた期間キー（daily=YYYY-MM-DD, weekly=エポック起点の7日バケット）。 */
export function periodKeyOf(date: Date, freq: ScreenerFrequency): string {
  const utcDays = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  if (freq === "weekly") return `W${Math.floor(utcDays / 7)}`;
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** TTL ロックが有効か。 */
export function isLocked(settings: ScreenerAutoSettings, now: Date): boolean {
  return !!settings.lockUntil && Date.parse(settings.lockUntil) > now.getTime();
}

export type DueReason = "disabled" | "weekend" | "already-checked" | "locked" | "due";

/** 自動実行すべきか（API 前の純判定）。 */
export function screenerDue(settings: ScreenerAutoSettings, now: Date): { due: boolean; reason: DueReason } {
  if (!settings.enabled) return { due: false, reason: "disabled" };
  const dow = now.getDay();
  if (dow === 0 || dow === 6) return { due: false, reason: "weekend" };
  if (settings.lastCheckedPeriod === periodKeyOf(now, settings.frequency)) return { due: false, reason: "already-checked" };
  if (isLocked(settings, now)) return { due: false, reason: "locked" };
  return { due: true, reason: "due" };
}

function rowToFundamentals(r: ScreenerRow): Fundamentals {
  return {
    per: r.per ?? null,
    pbr: r.pbr ?? null,
    roe: r.roe ?? null,
    operatingMargin: r.operatingMargin ?? null,
    salesGrowth: r.salesGrowth ?? null,
    basis: r.fundamentalsBasis ?? null,
    asOf: r.fundamentalsAsOf ?? null,
  };
}

/**
 * 前回 snapshot から再利用する財務マップを作る。
 * fundamentalsAvailable かつ 開示日(asOf)が maxAgeDays 以内の code のみ再利用
 * （それより古い＝新四半期の開示が出ている可能性 → 再取得させる）。
 */
export function buildFinsReuseMap(
  snapshot: ScreenerSnapshot | null,
  now: Date,
  maxAgeDays = FINS_REUSE_MAX_AGE_DAYS
): Map<string, Fundamentals> {
  const map = new Map<string, Fundamentals>();
  if (!snapshot) return map;
  const cutoff = now.getTime() - maxAgeDays * 86400000;
  for (const r of snapshot.rows) {
    if (!r.fundamentalsAvailable) continue;
    if (r.fundamentalsAsOf && Date.parse(r.fundamentalsAsOf) < cutoff) continue; // 古い → 再取得
    map.set(r.code, rowToFundamentals(r));
  }
  return map;
}

// ---- 実行時ランタイム（UI 表示用・購読可能） ----

export interface ScreenerAutoRuntime {
  running: boolean;
  phase: ScreenerPhase | "probe" | null;
  done: number;
  total: number;
}
let runtime: ScreenerAutoRuntime = { running: false, phase: null, done: 0, total: 0 };
const listeners = new Set<() => void>();

export function getScreenerAutoRuntime(): ScreenerAutoRuntime {
  return runtime;
}
export function subscribeScreenerAuto(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setRuntime(r: ScreenerAutoRuntime): void {
  runtime = r;
  listeners.forEach((fn) => fn());
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

let running = false; // タブ内多重防止

export interface ScreenerAutoRunResult {
  ran: boolean;
  reason: string;
  message?: string;
}

/**
 * 自動更新の1回分を実行する（アプリ起動時にコントローラから呼ぶ）。
 * 鮮度・ロック・provider モードを検査し、probe でアンカー前進を確認してから更新する。
 */
export async function runScreenerAuto(opts?: { now?: Date; signal?: AbortSignal }): Promise<ScreenerAutoRunResult> {
  const now = opts?.now ?? new Date();
  if (running) return { ran: false, reason: "in-progress" };
  const settings = getScreenerAutoSettings();
  const due = screenerDue(settings, now);
  if (!due.due) return { ran: false, reason: due.reason };
  if (getProviderMode() !== "jquants-ready") return { ran: false, reason: "manual-mode" };

  running = true;
  // TTL ロック取得（複数タブ排他）
  setScreenerAutoSettings({ lockUntil: new Date(now.getTime() + LOCK_TTL_MS).toISOString() });
  setRuntime({ running: true, phase: "probe", done: 0, total: 1 });

  try {
    const credentials = getJQuantsCredentials();
    const snapshot = loadScreenerSnapshot();

    // 鮮度判定の前に取引カレンダーを最新化する（鮮度内なら no-op・失敗は静的判定へ退避）。
    // ゲート前に置くことで、fresh skip する場合でもカレンダーが取得され、
    // 起動時に UI の「(暫定・取引カレンダー未取得)」表示が確定・解消する（Task 0）。
    await ensureTradingCalendar(credentials, now);

    // 鮮度ゲート（取引カレンダー由来の expectedAsOf 判定）。
    // 既存 snapshot が期待鮮度に届いていれば probe API を叩かず skip する。
    //   例（Light）: 当日 16:30 配信前は「前営業日が最新」でも fresh 判定になり無駄打ちしない。
    //   カレンダー未取得時は静的な土日判定＋2営業日 tolerance に退避（calendar.ts / Task 2-2）。
    const staleness = isDataStale(snapshot?.priceAsOf ?? null, now);
    if (!staleness.stale) {
      setScreenerAutoSettings({ lastCheckedPeriod: periodKeyOf(now, settings.frequency) });
      return { ran: false, reason: "fresh", message: `最新データ ${staleness.expected} 時点（更新不要）` };
    }

    // probe: 最新アンカーを取得（共有リミッタ経由）。前進していなければフル更新しない。
    try {
      await getJQuantsRateLimiter().acquire(opts?.signal);
    } catch (e) {
      if (isAbort(e)) return { ran: false, reason: "aborted" };
      throw e;
    }
    const probe = await fetchJQuantsBarsByDate(fmtDate(now), credentials);
    if (!probe.ok) return { ran: false, reason: "probe-failed", message: probe.message };
    const anchor = probe.date ?? fmtDate(now);

    if (snapshot?.priceAsOf && anchor <= snapshot.priceAsOf) {
      // 新しい取得可能日が無い（祝日等）→ 当該期間はチェック済みにして skip
      setScreenerAutoSettings({ lastCheckedPeriod: periodKeyOf(now, settings.frequency) });
      return { ran: false, reason: "no-new-data" };
    }

    // 更新実行（fins 再利用・アンカーは probe 済みを再利用）
    const reuse = buildFinsReuseMap(snapshot, now);
    const result = await runScreener(credentials, {
      anchorDate: anchor,
      reuseFundamentals: reuse,
      signal: opts?.signal,
      onProgress: (phase, done, total) => setRuntime({ running: true, phase, done, total }),
    });

    if (result.ok) {
      setScreenerAutoSettings({ lastCheckedPeriod: periodKeyOf(now, settings.frequency) });
      return { ran: true, reason: "updated", message: result.message };
    }
    // 破棄（auth/rate/aborted）→ チェック済みにしない（翌起動で再試行）
    return { ran: false, reason: "discarded", message: result.message };
  } finally {
    setScreenerAutoSettings({ lockUntil: null }); // ロック解放
    setRuntime({ running: false, phase: null, done: 0, total: 0 });
    running = false;
  }
}
