/**
 * Phase 53: 表示ガード用の安全ユーティリティ（完全ローカル・純関数）。
 * NaN / 0除算 / null / 不正日付を安全側に倒し、画面が壊れないようにする。
 * 既存ロジックは変更せず、表示層での防御に用いる。
 */

/** 有限数でなければ fallback（既定 0）を返す。 */
export function safeNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** toFixed の安全版。非有限なら "—"。 */
export function safeFixed(v: unknown, digits = 1, dash = "—"): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : dash;
}

/** 割合(0-1)を % 表示。非有限なら "—"。 */
export function safePercent(v: unknown, digits = 1, dash = "—"): string {
  return typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : dash;
}

/** 0除算を避ける除算。分母が0/非有限なら fallback。 */
export function safeDivide(numer: number, denom: number, fallback = 0): number {
  return Number.isFinite(numer) && Number.isFinite(denom) && denom !== 0 ? numer / denom : fallback;
}

/** 配列でなければ空配列を返す。 */
export function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** ISO 日付を安全に "YYYY-MM-DD HH:mm" へ。不正なら dash。 */
export function safeDateLabel(iso: string | null | undefined, dash = "—"): string {
  if (!iso) return dash;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dash;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
