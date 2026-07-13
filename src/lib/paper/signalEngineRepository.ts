/**
 * シグナル生成エンジンの永続化（localStorage・K レジストリ経由）— Phase 1 / Task 4。
 * - 注文キュー（PaperOrder[]）: 夜間生成→翌営業日始値約定までの未約定注文。
 *   生成と約定がセッションを跨ぐため **必ず永続化**（アプリ再起動対策）。
 * - シグナル生成設定: 自動実行ON/OFF・戦略別の有効/無効（既定 C/B 有効・A 無効）。
 * load は破損時に安全フォールバック（キュー=空 / 設定=既定）。
 */
import { K } from "@/lib/storage/keys";
import type { PaperOrder } from "./paperBroker";

const QUEUE_KEY = K.paperOrderQueue;
const SETTINGS_KEY = K.signalEngineSettings;

// 戦略ID（strategies.ts と一致）。
export const STRATEGY_ID_TREND_FOLLOW = "trend-follow"; // A
export const STRATEGY_ID_PULLBACK = "pullback"; // B
export const STRATEGY_ID_RELATIVE_MOMENTUM = "relative-momentum"; // C

export interface SignalEngineSettings {
  /** アプリ起動時に自動でシグナル生成＋約定を行うか（既定 false）。 */
  autoEnabled: boolean;
  /** 戦略ID → 有効フラグ（既定: C/B 有効・A 無効）。 */
  strategyEnabled: Record<string, boolean>;
}

export const DEFAULT_SIGNAL_ENGINE_SETTINGS: SignalEngineSettings = {
  autoEnabled: false,
  strategyEnabled: {
    [STRATEGY_ID_RELATIVE_MOMENTUM]: true, // C 主役
    [STRATEGY_ID_PULLBACK]: true, // B 観察用
    [STRATEGY_ID_TREND_FOLLOW]: false, // A 既定OFF
  },
};

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
    /* 容量超過等は無視 */
  }
}

// ---- 注文キュー ----

function isOrder(v: unknown): v is PaperOrder {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.code === "string" &&
    typeof o.strategyId === "string" &&
    (o.side === "buy" || o.side === "sell") &&
    typeof o.signalDate === "string" &&
    typeof o.shares === "number"
  );
}

/** 注文キューを読み込む（未保存/破損時は空配列）。 */
export function loadOrderQueue(): PaperOrder[] {
  const raw = read(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOrder) : [];
  } catch {
    return [];
  }
}

/** 注文キューを保存する。 */
export function saveOrderQueue(orders: PaperOrder[]): void {
  write(QUEUE_KEY, JSON.stringify(orders));
}

// ---- 設定 ----

/** 設定を読み込む（欠損は既定で補完・戦略フラグは既定にマージ）。 */
export function loadSignalEngineSettings(): SignalEngineSettings {
  const raw = read(SETTINGS_KEY);
  if (!raw) return { autoEnabled: false, strategyEnabled: { ...DEFAULT_SIGNAL_ENGINE_SETTINGS.strategyEnabled } };
  try {
    const p = JSON.parse(raw) as Partial<SignalEngineSettings>;
    const merged: Record<string, boolean> = { ...DEFAULT_SIGNAL_ENGINE_SETTINGS.strategyEnabled };
    if (p.strategyEnabled && typeof p.strategyEnabled === "object") {
      for (const [id, on] of Object.entries(p.strategyEnabled)) {
        if (typeof on === "boolean") merged[id] = on;
      }
    }
    return { autoEnabled: p.autoEnabled === true, strategyEnabled: merged };
  } catch {
    return { autoEnabled: false, strategyEnabled: { ...DEFAULT_SIGNAL_ENGINE_SETTINGS.strategyEnabled } };
  }
}

/** 設定を部分更新して保存し、更新後の全体を返す。 */
export function saveSignalEngineSettings(patch: Partial<SignalEngineSettings>): SignalEngineSettings {
  const cur = loadSignalEngineSettings();
  const merged: SignalEngineSettings = {
    autoEnabled: patch.autoEnabled ?? cur.autoEnabled,
    strategyEnabled: { ...cur.strategyEnabled, ...(patch.strategyEnabled ?? {}) },
  };
  write(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

/** 有効な戦略IDの集合。 */
export function enabledStrategyIds(settings: SignalEngineSettings): Set<string> {
  return new Set(Object.entries(settings.strategyEnabled).filter(([, on]) => on).map(([id]) => id));
}
