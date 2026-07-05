/**
 * Phase 58 (v1.6): JARVIS External Intelligence Layer — AI設定（完全ローカル）。
 * 初期値 OFF。外部プロバイダは APIキー未設定時 Template へ自動フォールバック。
 * ニュース/RSS/外部情報は一切利用しない（銘柄内部データのみ）。判断補助・投資助言ではない。
 */

import { K } from "@/lib/storage/keys";

// advisor-ai-mode は ai-config に統合済みの旧キー（後方互換で読み書き継続・backup除外）。
const MODE_KEY = K.advisorAiMode;
const CONFIG_KEY = K.aiConfig;

export type AiMode = "off" | "template" | "openai" | "claude" | "gemini" | "local";
export type CommentStyle = "conservative" | "balanced" | "aggressive";
export type CommentDetail = "short" | "standard" | "detailed";

export const COMMENT_DETAILS: { key: CommentDetail; label: string }[] = [
  { key: "short", label: "短文" },
  { key: "standard", label: "標準" },
  { key: "detailed", label: "詳細" },
];

export const AI_MODES: { key: AiMode; label: string; note: string }[] = [
  { key: "off", label: "OFF", note: "AIコメントを表示しません（既定）。" },
  { key: "template", label: "Template（ローカル）", note: "内部データからローカル生成。外部送信なし。" },
  { key: "openai", label: "OpenAI", note: "APIキー未設定時は Template へ自動フォールバック。" },
  { key: "claude", label: "Claude", note: "APIキー未設定時は Template へ自動フォールバック。" },
  { key: "gemini", label: "Gemini", note: "APIキー未設定時は Template へ自動フォールバック。" },
  { key: "local", label: "Local LLM", note: "エンドポイント/キー未設定時は Template へ自動フォールバック。" },
];

export const COMMENT_STYLES: { key: CommentStyle; label: string }[] = [
  { key: "conservative", label: "Conservative（慎重）" },
  { key: "balanced", label: "Balanced（標準）" },
  { key: "aggressive", label: "Aggressive（積極）" },
];

export const TEMPERATURES = [0.1, 0.3, 0.5];
export const MAX_TOKENS = [100, 300, 500];

export interface AiConfig {
  provider: AiMode;
  apiKey: string; // ユーザー管理・localStorageのみ・外部送信は選択プロバイダへの推論要求のみ
  endpoint: string; // Local LLM 用（OpenAI互換）
  style: CommentStyle;
  detail: CommentDetail;
  temperature: number;
  maxTokens: number;
}

const DEFAULT_CONFIG: AiConfig = {
  provider: "off",
  apiKey: "",
  endpoint: "",
  style: "balanced",
  detail: "standard",
  temperature: 0.3,
  maxTokens: 300,
};

export function getAiConfig(): AiConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CONFIG };
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    // 後方互換: 旧 mode キーがあれば provider に反映
    const legacyMode = window.localStorage.getItem(MODE_KEY);
    const base = raw ? (JSON.parse(raw) as Partial<AiConfig>) : {};
    const provider = (base.provider ?? legacyMode ?? "off") as AiMode;
    return {
      provider: ["off", "template", "openai", "claude", "gemini", "local"].includes(provider) ? provider : "off",
      apiKey: typeof base.apiKey === "string" ? base.apiKey : "",
      endpoint: typeof base.endpoint === "string" ? base.endpoint : "",
      style: base.style === "conservative" || base.style === "aggressive" ? base.style : "balanced",
      detail: base.detail === "short" || base.detail === "detailed" ? base.detail : "standard",
      temperature: typeof base.temperature === "number" ? base.temperature : 0.3,
      maxTokens: typeof base.maxTokens === "number" ? base.maxTokens : 300,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function setAiConfig(patch: Partial<AiConfig>): AiConfig {
  const merged = { ...getAiConfig(), ...patch };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
    window.localStorage.setItem(MODE_KEY, merged.provider); // 後方互換
  }
  return merged;
}

// ---- 後方互換 API（v1.5 まで） ----
export function getAiMode(): AiMode {
  return getAiConfig().provider;
}
export function setAiMode(mode: AiMode): AiMode {
  return setAiConfig({ provider: mode }).provider;
}

/** 外部プロバイダが実際に呼べる状態か（キー/エンドポイント設定済み）。 */
export function providerReady(cfg: AiConfig): boolean {
  if (cfg.provider === "local") return cfg.endpoint.trim().length > 0;
  return ["openai", "claude", "gemini"].includes(cfg.provider) && cfg.apiKey.trim().length > 0;
}

/** 実効モード。off / template / provider（外部呼び出し可）。 */
export function effectiveAiMode(): "off" | "template" | "provider" {
  const cfg = getAiConfig();
  if (cfg.provider === "off") return "off";
  if (cfg.provider === "template") return "template";
  return providerReady(cfg) ? "provider" : "template"; // 未設定は Template fallback
}
