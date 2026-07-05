/**
 * J-Quants 認証トークンのキャッシュ（localStorage）。
 * 期限切れ時のみ再認証させ、API 負荷・レート制限を軽減する。
 *
 *   key: jarvis-trade-log:jquants-token-cache
 *   保存項目: idToken / refreshToken / expiresAt / createdAt
 *
 * ※ idToken の有効期限は概ね24時間。安全側で 23 時間を TTL とする。
 *    認証情報そのもの（メール/パスワード）はここには保存しない。
 */
import { K } from "@/lib/storage/keys";

// 🔒 認証トークンのキャッシュキー。バックアップ・エクスポート対象外（security）。
const KEY = K.jquantsTokenCache;
const TTL_MS = 23 * 60 * 60 * 1000;

export interface TokenCache {
  idToken: string;
  refreshToken: string;
  expiresAt: string; // ISO datetime
  createdAt: string; // ISO datetime
}

export function getTokenCache(): TokenCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TokenCache) : null;
  } catch {
    return null;
  }
}

/** 期限内の idToken を返す。無い/期限切れなら null。 */
export function getValidIdToken(): string | null {
  const c = getTokenCache();
  if (!c) return null;
  if (new Date(c.expiresAt).getTime() <= Date.now()) return null;
  return c.idToken;
}

/** 取得したトークンを保存する（createdAt/expiresAt を採番）。 */
export function saveTokens(t: { idToken: string; refreshToken?: string }): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const cache: TokenCache = {
    idToken: t.idToken,
    refreshToken: t.refreshToken ?? getTokenCache()?.refreshToken ?? "",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  };
  window.localStorage.setItem(KEY, JSON.stringify(cache));
}

export function clearTokenCache(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
