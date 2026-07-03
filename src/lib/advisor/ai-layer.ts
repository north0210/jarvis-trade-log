/**
 * Phase 58 (v1.6): JARVIS External Intelligence Layer.
 * 内部データ（facts）からAIコメントを生成する統一レイヤー。
 * - OFF: 生成しない
 * - Template: 完全ローカル生成（外部送信なし）
 * - 外部プロバイダ(OpenAI/Claude/Gemini/Local): APIキー/エンドポイント設定時のみ推論要求。失敗時は Template へフォールバック。
 * ニュース/RSS/外部情報は利用しない。断定・未来予測はしない。判断補助・投資助言ではない。
 */
import { getAiConfig, effectiveAiMode, type AiConfig, type CommentStyle } from "./advisor-ai-settings";

export type AiTarget = "advisor" | "risk" | "portfolio" | "watchlist" | "report" | "montecarlo" | "backtest" | "dashboard";

export interface AiContext {
  title: string;
  facts: string[]; // 内部データから組み立てた事実（人間可読）
}

export interface AiResult {
  text: string;
  source: "template" | "provider" | "fallback" | "off";
}

const STYLE_OPENING: Record<CommentStyle, string> = {
  conservative: "守りを優先し、規律を維持してください。",
  balanced: "優位性はありますが、確実性はありません。",
  aggressive: "優位性が見られます。ただし過信は禁物です。",
};

/** 全AIコメント共通の固定フッター（断定禁止・投資助言ではない）。 */
export const FIXED_COMMENTS = [
  "推奨は判断補助です。",
  "利益は保証できません。",
  "優位性は未来を保証しません。",
  "感情ではなく規律で判断してください。",
  "利益は市場が与えます。損失は我々が許可します。",
];

/** ローカル生成（Template）。facts を要約し、スタイルに応じた所見＋固定コメントを付す。 */
export function templateComment(ctx: AiContext, style: CommentStyle): string {
  const lines: string[] = [];
  lines.push(`【${ctx.title}】`);
  for (const f of ctx.facts.slice(0, 8)) lines.push(`・${f}`);
  lines.push(STYLE_OPENING[style]);
  for (const c of FIXED_COMMENTS) lines.push(c);
  lines.push("※ 本コメントは判断補助であり、投資助言ではありません。");
  return lines.join("\n");
}

function buildPrompt(ctx: AiContext, style: CommentStyle): { system: string; user: string } {
  const system =
    "あなたは株式運用の判断補助アシスタントです。以下の内部データ要約のみを用い、日本語で簡潔に所見を述べてください。" +
    "売買を断定せず、未来を予測せず、投資助言をしないでください。ニュースや外部情報は参照しないでください。" +
    `文体は${style}（慎重/標準/積極）。最後に「本コメントは判断補助であり投資助言ではありません」と明記してください。`;
  const user = `【${ctx.title}】\n${ctx.facts.map((f) => `- ${f}`).join("\n")}`;
  return { system, user };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await p;
  } finally {
    clearTimeout(t);
  }
}

/** 外部プロバイダ呼び出し（ブラウザから・ユーザー鍵）。失敗は例外 → 呼び出し側で Template フォールバック。 */
async function callProvider(cfg: AiConfig, ctx: AiContext): Promise<string> {
  const { system, user } = buildPrompt(ctx, cfg.style);
  const temperature = cfg.temperature;
  const max = cfg.maxTokens;

  if (cfg.provider === "openai" || cfg.provider === "local") {
    const url = cfg.provider === "local" ? cfg.endpoint : "https://api.openai.com/v1/chat/completions";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
    const res = await withTimeout(
      fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: cfg.provider === "local" ? "local-model" : "gpt-4o-mini", messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature, max_tokens: max }),
      }),
      20000
    );
    if (!res.ok) throw new Error(`provider ${res.status}`);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("empty");
    return text.trim();
  }

  if (cfg.provider === "claude") {
    const res = await withTimeout(
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-3-5-haiku-latest", max_tokens: max, temperature, system, messages: [{ role: "user", content: user }] }),
      }),
      20000
    );
    if (!res.ok) throw new Error(`provider ${res.status}`);
    const j = await res.json();
    const text = j?.content?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) throw new Error("empty");
    return text.trim();
  }

  if (cfg.provider === "gemini") {
    const res = await withTimeout(
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${system}\n\n${user}` }] }], generationConfig: { temperature, maxOutputTokens: max } }),
      }),
      20000
    );
    if (!res.ok) throw new Error(`provider ${res.status}`);
    const j = await res.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) throw new Error("empty");
    return text.trim();
  }

  throw new Error("unsupported provider");
}

/** 統一生成。OFF→null。Template→ローカル。外部→呼び出し、失敗時は Template フォールバック。 */
export async function generateAiComment(ctx: AiContext): Promise<AiResult | null> {
  const eff = effectiveAiMode();
  if (eff === "off") return null;
  const cfg = getAiConfig();
  if (eff === "template") return { text: templateComment(ctx, cfg.style), source: "template" };
  // provider
  try {
    const text = await callProvider(cfg, ctx);
    return { text: `${text}`, source: "provider" };
  } catch {
    return { text: templateComment(ctx, cfg.style), source: "fallback" };
  }
}
