/**
 * 戦略比較結果の永続化（localStorage・K レジストリ経由）— Phase 1 / Task 3・Stage B。
 * 最新の一括比較結果を1件保持し、画面再訪時に再取得なしで表示できるようにする。
 * load は破損/形状不正時に null（安全フォールバック）。
 */
import { K } from "@/lib/storage/keys";
import type { StrategyComparisonResult } from "./signalSimulator";

const KEY = K.strategyComparison;

function isValid(v: unknown): v is StrategyComparisonResult {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.generatedAt === "string" &&
    typeof o.from === "string" &&
    typeof o.to === "string" &&
    Array.isArray(o.entries)
  );
}

export function loadStrategyComparison(): StrategyComparisonResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStrategyComparison(result: StrategyComparisonResult): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(result));
  } catch {
    // 容量超過等は無視（再実行で再生成可能）。
  }
}
