/**
 * 日足系列のローカルキャッシュ（localStorage）＋期限ポリシー。
 * バックテストの日足取得コスト・レート制限を軽減する。
 *   key: jarvis-trade-log:price-cache:<code>
 *   policy key: jarvis-trade-log:cache-policy  → "30" | "90" | "none"
 *
 * ※ 大量銘柄・長期間で localStorage 容量が逼迫する場合は IndexedDB への移行を検討（将来）。
 */
import { K } from "@/lib/storage/keys";

export interface SeriesPoint {
  date: string;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
}

export type CachePolicy = "30" | "90" | "none";

interface CacheEntry {
  code: string;
  from: string;
  to: string;
  fetchedAt: string;
  series: SeriesPoint[];
}

// 動的プレフィックス（実キーは price-cache:<code>）。末尾コロン込みで登録済み。
const PREFIX = K.priceCache;
const POLICY_KEY = K.cachePolicy;

export function getCachePolicy(): CachePolicy {
  if (typeof window === "undefined") return "90";
  const v = window.localStorage.getItem(POLICY_KEY);
  return v === "30" || v === "90" || v === "none" ? v : "90";
}

export function setCachePolicy(p: CachePolicy): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(POLICY_KEY, p);
}

function ttlDays(p: CachePolicy): number | null {
  if (p === "30") return 30;
  if (p === "90") return 90;
  return null; // 無期限
}

/** キャッシュ取得。要求範囲を包含し、期限内なら返す。無ければ null。 */
export function getCachedSeries(code: string, from: string, to: string): SeriesPoint[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + code);
    if (!raw) return null;
    const e = JSON.parse(raw) as CacheEntry;
    // 範囲包含チェック
    if (e.from > from || e.to < to) return null;
    // 期限チェック
    const ttl = ttlDays(getCachePolicy());
    if (ttl != null) {
      const age = (Date.now() - new Date(e.fetchedAt).getTime()) / (24 * 60 * 60 * 1000);
      if (age > ttl) return null;
    }
    // 要求範囲で絞り込んで返す
    return e.series.filter((p) => p.date >= from && p.date <= to);
  } catch {
    return null;
  }
}

export function setCachedSeries(code: string, from: string, to: string, series: SeriesPoint[]): void {
  if (typeof window === "undefined") return;
  const entry: CacheEntry = { code, from, to, fetchedAt: new Date().toISOString(), series };
  try {
    window.localStorage.setItem(PREFIX + code, JSON.stringify(entry));
  } catch {
    // 容量超過等は無視（キャッシュ無しで動作継続）
  }
}

export function clearPriceCache(): void {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  keys.forEach((k) => window.localStorage.removeItem(k));
}
