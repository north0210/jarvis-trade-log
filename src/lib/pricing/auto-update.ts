/**
 * 自動スケジュール価格更新（フロント側）。
 *
 * アプリを開いている間だけ setInterval で updateAllPrices() を定期実行する。
 * バックグラウンド常駐・サーバー定期実行は行わない（タブを閉じれば停止）。
 *
 * 設定: localStorage key = jarvis-trade-log:auto-update-settings
 *   { enabled, intervalMinutes, lastAutoUpdateAt }
 *
 * ・多重実行防止（running フラグ＋単一 timer）
 * ・手入力モード / J-Quants 未設定時はスキップ
 * ・複数タブ同期は未対応
 */
import { updateAllPrices } from "./priceUpdater";
import { getProviderMode } from "./settings";

const KEY = "jarvis-trade-log:auto-update-settings";

export const INTERVAL_OPTIONS = [15, 30, 60, 120] as const;

export interface AutoUpdateSettings {
  enabled: boolean;
  intervalMinutes: number;
  lastAutoUpdateAt: string | null;
}

const DEFAULTS: AutoUpdateSettings = {
  enabled: false,
  intervalMinutes: 30,
  lastAutoUpdateAt: null,
};

export function getAutoUpdateSettings(): AutoUpdateSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<AutoUpdateSettings>;
    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULTS.enabled,
      intervalMinutes:
        typeof p.intervalMinutes === "number" ? p.intervalMinutes : DEFAULTS.intervalMinutes,
      lastAutoUpdateAt: typeof p.lastAutoUpdateAt === "string" ? p.lastAutoUpdateAt : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setAutoUpdateSettings(patch: Partial<AutoUpdateSettings>): AutoUpdateSettings {
  const merged = { ...getAutoUpdateSettings(), ...patch };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

// ---- ランタイム（メモリ・単一インスタンス） ----
let timer: ReturnType<typeof setInterval> | null = null;
let running = false; // 多重実行防止
let lastMessage: string | null = null;
const listeners = new Set<() => void>();

/** 自動更新の状態変化（開始/完了）を購読する。UI 再描画に使用。 */
export function subscribeAutoUpdate(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function notify() {
  listeners.forEach((l) => l());
}

export function getAutoUpdateRuntime(): { running: boolean; lastMessage: string | null } {
  return { running, lastMessage };
}

/** タイマー稼働中か（＝ON かつ動作条件を満たす）。 */
export function isAutoUpdateActive(): boolean {
  return timer !== null;
}

/** 次回予定時刻（ISO）。無効/未実行なら null。 */
export function getNextAutoUpdateAt(): string | null {
  const s = getAutoUpdateSettings();
  if (!s.enabled || !s.lastAutoUpdateAt) return null;
  return new Date(
    new Date(s.lastAutoUpdateAt).getTime() + s.intervalMinutes * 60 * 1000
  ).toISOString();
}

async function runOnce(): Promise<void> {
  if (running) return; // 多重実行防止
  // 手入力モードでは実行しない（J-Quants 未設定時は updateAllPrices 側で失敗 → メッセージ）
  if (getProviderMode() !== "jquants-ready") {
    lastMessage = "手入力モードのため自動更新をスキップしました";
    return;
  }
  running = true;
  notify();
  try {
    const r = await updateAllPrices();
    setAutoUpdateSettings({ lastAutoUpdateAt: r.at });
    lastMessage = r.ok
      ? "自動価格更新が完了しました"
      : "自動更新に失敗しました。手入力モードを確認してください";
  } catch {
    lastMessage = "自動更新に失敗しました。手入力モードを確認してください";
  } finally {
    running = false;
    notify();
  }
}

/** 手動トリガ（テスト・即時実行用）。多重実行はガードされる。 */
export function runAutoUpdateNow(): Promise<void> {
  return runOnce();
}

/** 設定に従いスケジュールを開始する（既存タイマーは停止してから）。 */
export function startAutoUpdate(): void {
  stopAutoUpdate();
  const s = getAutoUpdateSettings();
  if (!s.enabled) return;
  if (getProviderMode() !== "jquants-ready") return; // 手入力モードでは起動しない
  timer = setInterval(() => {
    void runOnce();
  }, s.intervalMinutes * 60 * 1000);
}

export function stopAutoUpdate(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 設定変更後に呼び出してスケジュールを再構築する。 */
export function restartAutoUpdate(): void {
  startAutoUpdate();
}
