/**
 * AI分析コメントの設定（localStorage）。
 *   key: jarvis-trade-log:ai-comment-settings
 *   { enabled }
 *
 * ※ APIキーはここに保存しない（env のみ）。保存するのは ON/OFF のみ。
 */
import { K } from "@/lib/storage/keys";

const KEY = K.aiCommentSettings;

export interface AICommentSettings {
  enabled: boolean;
}

const DEFAULTS: AICommentSettings = { enabled: false };

export function getAICommentSettings(): AICommentSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<AICommentSettings>;
    return { enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULTS.enabled };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setAICommentSettings(patch: Partial<AICommentSettings>): AICommentSettings {
  const merged = { ...getAICommentSettings(), ...patch };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}
