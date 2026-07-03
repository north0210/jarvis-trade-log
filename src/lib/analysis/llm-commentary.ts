/**
 * LLM 分析コメントのクライアント層。
 * /api/ai-comment（サーバ）を呼び、成功時は LLM コメント、
 * 失敗・未設定・タイムアウト時は generateJarvisComment()（ローカルテンプレ）へ fallback する。
 */
import type { Stock } from "@/lib/types";
import type { ScoreResult } from "@/lib/score";
import type { Alert } from "@/lib/alerts";
import { generateJarvisComment } from "./commentary";

export interface LLMCommentInput {
  stock: Stock;
  scoreResult: ScoreResult;
  alerts: Alert[];
  comparisonSummary?: string;
}

export interface LLMCommentResult {
  text: string;
  source: "llm" | "template";
  message?: string;
}

const TIMEOUT_MS = 20000;

export async function generateJarvisLLMComment(input: LLMCommentInput): Promise<LLMCommentResult> {
  const fallback = (message?: string): LLMCommentResult => ({
    text: generateJarvisComment(input.stock, input.scoreResult, input.alerts),
    source: "template",
    message,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/ai-comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stock: input.stock,
        scoreResult: input.scoreResult,
        alerts: input.alerts,
        comparisonSummary: input.comparisonSummary,
      }),
      signal: controller.signal,
    });
    const data = (await res.json()) as { ok?: boolean; comment?: string; message?: string };
    if (data.ok && data.comment) {
      return { text: data.comment, source: "llm" };
    }
    return fallback(data.message);
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** 設定画面用: サーバ側で構成されている Provider を取得（キーは返さない）。 */
export async function getLLMProviderStatus(): Promise<{ provider: "anthropic" | "openai" | "none" }> {
  try {
    const res = await fetch("/api/ai-comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "status" }),
    });
    const data = (await res.json()) as { provider?: "anthropic" | "openai" | "none" };
    return { provider: data.provider ?? "none" };
  } catch {
    return { provider: "none" };
  }
}
