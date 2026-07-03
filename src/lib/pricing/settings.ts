/**
 * 価格 Provider の設定永続化（localStorage）。
 *
 * provider.ts は純粋に保つ（localStorage を直接触らない）ため、
 * モード・認証情報の保存はここに分離する。UI 層がこれを読み、
 * getPriceProvider() へ注入する。
 *
 *   key: jarvis-trade-log:price-provider-mode  → "manual" | "jquants-ready"
 *   key: jarvis-trade-log:jquants-settings     → { email, password }
 *
 * ※ 認証情報の直書きは禁止。値は必ずユーザー入力から取得する。
 */
import type { JQuantsCredentials, PriceProviderMode } from "./provider";

const MODE_KEY = "jarvis-trade-log:price-provider-mode";
const CRED_KEY = "jarvis-trade-log:jquants-settings";
const STATUS_KEY = "jarvis-trade-log:jquants-status";

/** 現在の Provider モード（未設定時は手入力）。 */
export function getProviderMode(): PriceProviderMode {
  if (typeof window === "undefined") return "manual";
  return window.localStorage.getItem(MODE_KEY) === "jquants-ready"
    ? "jquants-ready"
    : "manual";
}

export function setProviderMode(mode: PriceProviderMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MODE_KEY, mode);
}

/** J-Quants 認証情報（未保存なら null）。 */
export function getJQuantsCredentials(): JQuantsCredentials | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CRED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JQuantsCredentials>;
    if (typeof parsed.email === "string" && typeof parsed.password === "string") {
      return { email: parsed.email, password: parsed.password };
    }
    return null;
  } catch {
    return null;
  }
}

export function setJQuantsCredentials(cred: JQuantsCredentials): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CRED_KEY, JSON.stringify(cred));
}

/** J-Quants 接続状態の記録。 */
export type JQuantsStatus = "unset" | "connected" | "error";
export interface JQuantsStatusRecord {
  status: JQuantsStatus;
  at: string; // ISO datetime（最終接続/更新日時）
  message: string;
}

export function getJQuantsStatus(): JQuantsStatusRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STATUS_KEY);
    return raw ? (JSON.parse(raw) as JQuantsStatusRecord) : null;
  } catch {
    return null;
  }
}

export function setJQuantsStatus(record: JQuantsStatusRecord): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STATUS_KEY, JSON.stringify(record));
}

/**
 * Dashboard 表示用の Provider ステータスラベル。
 *   MANUAL / J-QUANTS READY / J-QUANTS CONNECTED / J-QUANTS ERROR
 */
export function providerModeLabel(
  mode: PriceProviderMode,
  status?: JQuantsStatusRecord | null
): string {
  if (mode === "manual") return "MANUAL";
  if (!status || status.status === "unset") return "J-QUANTS READY";
  if (status.status === "connected") return "J-QUANTS CONNECTED";
  return "J-QUANTS ERROR";
}
