/**
 * Phase 55: リリース整備（完全ローカル）。
 * 免責同意フラグと初回起動チェックリストの状態を管理する。
 */

const KEY = "jarvis-trade-log:release-checklist";

export const DISCLAIMER_TEXT =
  "本アプリの分析結果は投資判断の補助であり、売買を推奨するものではありません。最終判断はユーザー自身で行ってください。";

export type ChecklistKey = "disclaimer" | "backup" | "jquants" | "notification" | "help" | "sample";

export interface ReleaseState {
  accepted: boolean; // 免責同意済み
  items: Record<ChecklistKey, boolean>;
}

export const CHECKLIST_ITEMS: { key: ChecklistKey; label: string; href: string }[] = [
  { key: "disclaimer", label: "免責事項を確認", href: "/help" },
  { key: "backup", label: "バックアップを作成", href: "/backup" },
  { key: "jquants", label: "J-Quants設定を確認", href: "/settings" },
  { key: "notification", label: "通知設定を確認", href: "/settings" },
  { key: "help", label: "使い方（Help）を確認", href: "/help" },
  { key: "sample", label: "サンプル銘柄で動作確認", href: "/stocks" },
];

const DEFAULT_STATE: ReleaseState = {
  accepted: false,
  items: { disclaimer: false, backup: false, jquants: false, notification: false, help: false, sample: false },
};

export function getReleaseState(): ReleaseState {
  if (typeof window === "undefined") return { accepted: false, items: { ...DEFAULT_STATE.items } };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { accepted: false, items: { ...DEFAULT_STATE.items } };
    const p = JSON.parse(raw) as Partial<ReleaseState>;
    const items = { ...DEFAULT_STATE.items, ...(p.items ?? {}) };
    return { accepted: p.accepted === true, items };
  } catch {
    return { accepted: false, items: { ...DEFAULT_STATE.items } };
  }
}

function write(state: ReleaseState): ReleaseState {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}

export function acceptDisclaimer(): ReleaseState {
  const s = getReleaseState();
  return write({ ...s, accepted: true, items: { ...s.items, disclaimer: true } });
}

export function setChecklistItem(key: ChecklistKey, value: boolean): ReleaseState {
  const s = getReleaseState();
  return write({ ...s, items: { ...s.items, [key]: value } });
}

/** 初回起動か（免責未同意）。 */
export function isFirstRun(): boolean {
  return !getReleaseState().accepted;
}

/** 完了項目数 / 総数。 */
export function checklistProgress(): { done: number; total: number } {
  const s = getReleaseState();
  const total = CHECKLIST_ITEMS.length;
  const done = CHECKLIST_ITEMS.filter((it) => s.items[it.key]).length;
  return { done, total };
}
