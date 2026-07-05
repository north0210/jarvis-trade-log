/**
 * スクリーナーの永続化（localStorage・regenerable）。
 *
 * - ユニバース（軽量マスタ）と、スクリーナー結果スナップショット（Top-Nランキング）を保持。
 * - キー文字列は K 経由（KEY_REGISTRY 登録・バックアップ対象外）。
 * - load は破損データでも例外を投げず安全にフォールバック（UI を壊さない）。
 */
import { K } from "@/lib/storage/keys";
import type { UniverseEntry } from "./universe";
import type { ScreenerRow } from "./technical";

const UNIVERSE_KEY = K.marketUniverse;
const SNAPSHOT_KEY = K.screenerSnapshot;

/** スクリーナー結果のスナップショット。 */
export interface ScreenerSnapshot {
  /** 生成日時（ISO）。「いつ時点」を表示するため。 */
  generatedAt: string;
  /** 生成時のユニバース件数（「何社中」を表示するため）。 */
  universeCount: number;
  /** Top-N ランキング。 */
  rows: ScreenerRow[];
}

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 容量超過等は握りつぶす（regenerable のため致命ではない）。
  }
}

/** ユニバースを保存する。 */
export function saveUniverse(entries: UniverseEntry[]): void {
  write(UNIVERSE_KEY, JSON.stringify(entries));
}

/** ユニバースを読み込む（未保存/破損時は空配列）。 */
export function loadUniverse(): UniverseEntry[] {
  const raw = read(UNIVERSE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UniverseEntry[]) : [];
  } catch {
    return [];
  }
}

/** スナップショットを保存する。 */
export function saveScreenerSnapshot(snap: ScreenerSnapshot): void {
  write(SNAPSHOT_KEY, JSON.stringify(snap));
}

/** スナップショット形状の妥当性を検証する。 */
function isValidSnapshot(v: unknown): v is ScreenerSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.generatedAt === "string" &&
    typeof o.universeCount === "number" &&
    Array.isArray(o.rows)
  );
}

/** スナップショットを読み込む（未保存/破損/形状不正時は null＝安全フォールバック）。 */
export function loadScreenerSnapshot(): ScreenerSnapshot | null {
  const raw = read(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isValidSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
