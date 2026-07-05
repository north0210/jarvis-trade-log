/**
 * Phase 63 (v1.7.x): お気に入り銘柄（完全ローカル）。
 * 銘柄コードの集合を localStorage に保持（最大20件）。Dashboard の My Favorites 等で使用。
 */
const KEY = "jarvis-trade-log:favorites";
const MAX = 20;

export function listFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? (p as string[]) : [];
  } catch {
    return [];
  }
}

function write(codes: string[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(codes.slice(0, MAX)));
}

export function isFavorite(code: string): boolean {
  return listFavorites().includes(code);
}

/** お気に入りをトグル。上限20件（超過時は追加しない）。 */
export function toggleFavorite(code: string): string[] {
  const cur = listFavorites();
  if (cur.includes(code)) {
    const next = cur.filter((c) => c !== code);
    write(next);
    return next;
  }
  if (cur.length >= MAX) return cur; // 上限
  const next = [...cur, code];
  write(next);
  return next;
}

export const MAX_FAVORITES = MAX;
