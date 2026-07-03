/**
 * AI分析コメント Route Handler（サーバ側）。
 *
 * フロントから直接 LLM を叩かず、この Route を経由する（APIキーの秘匿）。
 * APIキーは env のみから読む（直書き・localStorage 保存は禁止）:
 *   ANTHROPIC_API_KEY を優先、無ければ OPENAI_API_KEY。両方無ければ fallback 指示を返す。
 *
 * ※ env 未設定でも build/lint は通る（実行時のみ参照）。
 *
 * body:
 *   { action: "status" }  → { ok, provider }
 *   { stock, scoreResult, alerts, comparisonSummary } → { ok, comment, provider } または { ok:false, fallback:true }
 */
import { NextResponse } from "next/server";

interface InStock {
  code?: string;
  name?: string;
  per?: number | null;
  pbr?: number | null;
  roe?: number | null;
  operating_margin?: number | null;
  sales_growth?: number | null;
  rsi?: number | null;
  macd?: string;
  current_price?: number | null;
  status?: string;
}
interface InScore {
  score?: number;
  grade?: string;
  recommendation?: string;
}
interface InAlert {
  label?: string;
  level?: string;
}
interface Body {
  action?: string;
  stock?: InStock;
  scoreResult?: InScore;
  alerts?: InAlert[];
  comparisonSummary?: string;
}

const SYSTEM_PROMPT = [
  "あなたはJARVIS Trade Logの投資分析AIです。",
  "日本語で、冷静・簡潔・実務的に分析してください。",
  "断定的な投資助言は避けてください。「買え」「必ず上がる」などの断定は禁止です。",
  "最終判断は「買い候補」「押し目待ち」「様子見」「見送り」「危険」のいずれかで表現してください。",
  "出力は300文字以内。JARVISの口調で、最後は「ボス」と添えても構いません。",
].join("\n");

const fmt = (v: number | null | undefined) => (v == null ? "-" : String(v));

function resolveProvider(): "anthropic" | "openai" | "none" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

function buildUserPrompt(b: Body): string {
  const s = b.stock ?? {};
  const sc = b.scoreResult ?? {};
  const lines = [
    `銘柄: ${s.name ?? "-"} (${s.code ?? "-"}) / 状態: ${s.status ?? "-"}`,
    `Score: ${fmt(sc.score)} / Grade: ${sc.grade ?? "-"} / Recommendation: ${sc.recommendation ?? "-"}`,
    `PER: ${fmt(s.per)} / PBR: ${fmt(s.pbr)} / ROE: ${fmt(s.roe)}%`,
    `営業利益率: ${fmt(s.operating_margin)}% / 売上成長率: ${fmt(s.sales_growth)}%`,
    `RSI: ${fmt(s.rsi)} / MACD: ${s.macd ?? "-"} / 現在価格: ${fmt(s.current_price)}`,
    `Alert: ${(b.alerts ?? []).map((a) => a.label).filter(Boolean).join(" / ") || "なし"}`,
  ];
  if (b.comparisonSummary) lines.push(`比較結果: ${b.comparisonSummary}`);
  lines.push("上記データをもとに、300文字以内で分析コメントを作成してください。");
  return lines.join("\n");
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(key: string, user: string): Promise<string> {
  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: user }],
      }),
    },
    15000
  );
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? []).map((c) => c.text ?? "").join("").trim();
  if (!text) throw new Error("Anthropic: 空の応答");
  return text;
}

async function callOpenAI(key: string, user: string): Promise<string> {
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
    },
    15000
  );
  if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI: 空の応答");
  return text;
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const provider = resolveProvider();

  if (body.action === "status") {
    return NextResponse.json({ ok: true, provider });
  }

  if (provider === "none") {
    return NextResponse.json({
      ok: false,
      fallback: true,
      provider,
      message: "LLM APIキーが未設定です（env に ANTHROPIC_API_KEY か OPENAI_API_KEY を設定）",
    });
  }

  try {
    const user = buildUserPrompt(body);
    const comment =
      provider === "anthropic"
        ? await callAnthropic(process.env.ANTHROPIC_API_KEY as string, user)
        : await callOpenAI(process.env.OPENAI_API_KEY as string, user);
    return NextResponse.json({ ok: true, provider, comment });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      fallback: true,
      provider,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
