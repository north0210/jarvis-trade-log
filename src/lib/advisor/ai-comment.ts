/**
 * Phase 55 (v1.3): 外部AIコメント（完全ローカル・自動API接続なし）。
 * Advisor/Risk/Portfolio/Backtest 要約から「AI用プロンプト」を生成し、
 * ユーザーが外部AIへ貼り付けて得た回答を保存・履歴管理する。APIキー不要。
 * 外部AIコメントは参考情報であり、売買判断はユーザー自身が行う。
 */
import type { AdvisorReport } from "./advisorTypes";
import type { RiskReport } from "@/lib/risk/risk-engine";
import type { PortfolioAnalysis } from "@/lib/analysis/portfolio";
import { K } from "@/lib/storage/keys";

const KEY = K.aiComments;

export const AI_COMMENT_DISCLAIMER = "外部AIコメントは参考情報です。売買判断はユーザー自身で行ってください。";

export interface AiCommentRecord {
  id: string;
  createdAt: string;
  prompt: string;
  answer: string;
  read: boolean;
}

export interface PromptInput {
  advisor: AdvisorReport;
  risk: RiskReport | null;
  portfolio: PortfolioAnalysis;
  btAvgCagr: number | null;
}

/** 外部AIへ渡すプロンプトを整形（機微情報は含めない）。 */
export function buildAdvisorPrompt(input: PromptInput): string {
  const { advisor, risk, portfolio, btAvgCagr } = input;
  const c = advisor.counts;
  const top = [...advisor.byCategory.strongBuy, ...advisor.byCategory.buy]
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 5)
    .map((i) => `- ${i.code} ${i.name}（合成${i.composite}/${i.grade}）理由: ${i.reasons.join(", ")}`)
    .join("\n");
  const warn = [...advisor.byCategory.danger, ...advisor.byCategory.sellCandidate]
    .slice(0, 5)
    .map((i) => `- ${i.code} ${i.name}（${i.grade}）理由: ${i.reasons.join(", ")}`)
    .join("\n");

  return [
    "あなたは投資の判断補助を行うアシスタントです。以下はローカル株式管理アプリ(JARVIS Trade Log)の要約です。",
    "売買を断定せず、リスクと規律の観点で気づきを日本語で簡潔に述べてください。投資助言ではなく参考意見として。",
    "",
    `【ポートフォリオ】総資産 ¥${Math.round(portfolio.totalAssets).toLocaleString("ja-JP")} / 現金比率 ${(portfolio.cashRatio * 100).toFixed(0)}% / 保有 ${portfolio.holdingCount}銘柄`,
    portfolio.maxPosition ? `最大集中: ${portfolio.maxPosition.name} ${(portfolio.maxPosition.ratio * 100).toFixed(0)}%` : "",
    risk ? `【リスク】Grade ${risk.riskGrade} / Score ${risk.riskScore} / 破産確率 ${(risk.ruinProbability * 100).toFixed(1)}% / 最大DD ${risk.maxDrawdown.toFixed(1)}%` : "【リスク】データ不足",
    btAvgCagr != null ? `【バックテスト】平均CAGR ${btAvgCagr.toFixed(1)}%` : "【バックテスト】未実行",
    `【Advisor件数】StrongBuy ${c.strongBuy} / Buy ${c.buy} / Watch ${c.watch} / Hold ${c.hold} / 一部利確 ${c.partialTP} / 縮小 ${c.reduce} / 売却候補 ${c.sellCandidate} / 危険 ${c.danger}`,
    "",
    "【買い候補 Top5】",
    top || "（なし）",
    "",
    "【警戒候補】",
    warn || "（なし）",
    "",
    "上記を踏まえ、(1)ポートフォリオ全体の所見 (2)注意すべき点 (3)規律面の助言 を各2〜3行でお願いします。",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * ローカル生成のAI風コメント（完全ローカル・外部送信なし・断定禁止）。
 * 銘柄内部データ（Advisor/Risk/Portfolio/BT）のみを用いる。判断補助・投資助言ではない。
 */
export function generateTemplateComment(input: PromptInput): string {
  const { advisor, risk, portfolio, btAvgCagr } = input;
  const c = advisor.counts;
  const lines: string[] = [];

  // ポートフォリオ所見
  if (portfolio.maxPosition && portfolio.maxPosition.ratio >= 0.4) {
    lines.push(`${portfolio.maxPosition.name} への集中が${(portfolio.maxPosition.ratio * 100).toFixed(0)}%と高めです。分散を検討してください。`);
  } else {
    lines.push(`現金比率は${(portfolio.cashRatio * 100).toFixed(0)}%です。余力と集中度のバランスを保っています。`);
  }

  // リスク所見
  if (risk) {
    if (risk.riskGrade === "D" || risk.riskGrade === "C") lines.push(`リスクは Grade ${risk.riskGrade}。守りを厚めに、規律を優先してください。`);
    else lines.push(`リスクは Grade ${risk.riskGrade}。過度な楽観は禁物ですが、概ね許容範囲です。`);
    if (risk.ruinProbability >= 0.05) lines.push(`破産確率が${(risk.ruinProbability * 100).toFixed(1)}%と高めです。ポジションサイズの抑制を。`);
  }

  // BT/優位性
  const btTop = [...advisor.byCategory.strongBuy, ...advisor.byCategory.buy].find((i) => i.bt);
  if (btTop && btTop.bt) {
    const b = btTop.bt;
    const pfTxt = b.pf != null ? `PF ${b.pf.toFixed(2)}` : "PF —";
    const ddTxt = b.maxDD != null ? `DD ${b.maxDD.toFixed(0)}%` : "DD —";
    lines.push(`${btTop.name} は過去検証で優位性があります（${pfTxt} / ${ddTxt}）。${b.expectedValue != null && b.expectedValue > 0 ? "期待値はプラス圏です。" : "期待値は慎重に確認してください。"}`);
    if (b.maxDD != null && b.maxDD >= 20) lines.push("PFは良好ですがDDはやや大きめです。想定内か再確認を。");
  } else if (btAvgCagr != null) {
    lines.push(`バックテスト平均CAGRは${btAvgCagr.toFixed(1)}%。個別BT未実行の銘柄は市場平均で評価しています。`);
  }

  // 候補件数所見
  if (c.strongBuy + c.buy > 0) lines.push(`買い候補は${c.strongBuy + c.buy}件。優位性はありますが、確実性はありません。`);
  if (c.sellCandidate + c.danger > 0) lines.push(`警戒候補は${c.sellCandidate + c.danger}件。感情ではなくルールで判断してください。`);

  lines.push("利益は市場が与えます。損失は我々が許可します。規律を維持してください。");
  lines.push("※ 本コメントは判断補助であり、投資助言ではありません。");
  return lines.join("\n");
}

function read(): AiCommentRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? (p as AiCommentRecord[]) : [];
  } catch {
    return [];
  }
}
function write(list: AiCommentRecord[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
}

export function listAiComments(): AiCommentRecord[] {
  return read().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function saveAiComment(prompt: string, answer: string, at: string): AiCommentRecord {
  const rec: AiCommentRecord = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    createdAt: at,
    prompt,
    answer,
    read: true,
  };
  write([rec, ...read()]);
  return rec;
}
export function removeAiComment(id: string): void {
  write(read().filter((r) => r.id !== id));
}
export function aiCommentCount(): number {
  return read().length;
}
