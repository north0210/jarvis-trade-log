/**
 * 売買ルール自動改善（完全ローカル・純関数＋却下永続化）。
 * 取引履歴・戦略・規律違反・ポートフォリオ要約から改善提案を生成する。
 * 既存の analyzeTrades を再利用し、alerts.ts / score.ts は変更しない。
 */
import type { Strategy, Trade } from "@/lib/types";
import type { StrategyInput } from "@/lib/storage/strategyRepository";
import { analyzeTrades } from "@/lib/analysis/trades";

export type Confidence = "low" | "medium" | "high";

export interface Improvement {
  id: string;
  strategyId: string;
  strategyName: string;
  title: string;
  reason: string;
  currentRule: string;
  suggestedRule: string;
  expectedEffect: string;
  risk: string;
  confidence: Confidence;
  createdAt: string;
  patch: Partial<StrategyInput>; // 適用時に Strategy へマージする差分
}

export interface PortfolioSummaryInput {
  maxRatio: number; // 最大集中比率 0〜1
  maxName: string | null;
}

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const conf = (n: number): Confidence => (n >= 10 ? "high" : n >= 5 ? "medium" : "low");

export function generateImprovements(
  trades: Trade[],
  strategies: Strategy[],
  portfolio: PortfolioSummaryInput,
  now: string
): Improvement[] {
  const out: Improvement[] = [];
  const byStrat = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!t.strategyId) continue;
    const arr = byStrat.get(t.strategyId) ?? [];
    arr.push(t);
    byStrat.set(t.strategyId, arr);
  }

  for (const s of strategies) {
    const ts = byStrat.get(s.id) ?? [];
    if (ts.length > 0) {
      const a = analyzeTrades(ts);

      // 1. 損切り幅改善
      if (s.maxLossRate != null && ts.length >= 3 && a.avgWin > 0 && Math.abs(a.avgLoss) > a.avgWin) {
        const next = Math.max(3, Math.round(s.maxLossRate - 2));
        if (next < s.maxLossRate)
          out.push({
            id: `${s.id}-maxloss`,
            strategyId: s.id,
            strategyName: s.name,
            title: "損切り幅の見直し",
            reason: `平均損失(¥${fmt(a.avgLoss)})が平均利益(¥${fmt(a.avgWin)})を上回っています。`,
            currentRule: `最大損失許容 ${s.maxLossRate}%`,
            suggestedRule: `最大損失許容 ${next}%`,
            expectedEffect: "損失の早期限定・損益比の改善",
            risk: "損切り発動頻度の増加（往復の損失）",
            confidence: conf(ts.length),
            createdAt: now,
            patch: { maxLossRate: next },
          });
      }

      // 2. RSI上限改善
      if (s.maxRsi != null && s.maxRsi > 70 && ts.length >= 3 && a.winRate < 0.5) {
        out.push({
          id: `${s.id}-maxrsi`,
          strategyId: s.id,
          strategyName: s.name,
          title: "RSI上限の引き下げ",
          reason: `勝率が ${(a.winRate * 100).toFixed(0)}% と低調です。過熱圏でのエントリが影響している可能性があります。`,
          currentRule: `RSI上限 ${s.maxRsi}`,
          suggestedRule: "RSI上限 70",
          expectedEffect: "高値掴みの抑制・勝率の改善",
          risk: "エントリ機会の減少",
          confidence: conf(ts.length),
          createdAt: now,
          patch: { maxRsi: 70 },
        });
      }

      // 3. Score条件改善
      const low = ts.filter((t) => t.scoreAtEntry != null && t.scoreAtEntry < 80);
      if (low.length >= 2) {
        const la = analyzeTrades(low);
        if ((la.winRate < 0.4 || la.totalRealizedPnl < 0) && (s.minScore == null || s.minScore < 80)) {
          out.push({
            id: `${s.id}-minscore`,
            strategyId: s.id,
            strategyName: s.name,
            title: "買い条件 Score の引き上げ",
            reason: `Score80未満の取引は勝率 ${(la.winRate * 100).toFixed(0)}%・損益 ¥${fmt(la.totalRealizedPnl)} と低調です。`,
            currentRule: `最低Score ${s.minScore ?? "未設定"}`,
            suggestedRule: "最低Score 80",
            expectedEffect: "低品質エントリの排除",
            risk: "候補数の減少",
            confidence: conf(low.length),
            createdAt: now,
            patch: { minScore: 80 },
          });
        }
      }
    }
  }

  // 4. 集中リスク改善（ポートフォリオ要約から）
  if (portfolio.maxRatio >= 0.4 && strategies.length > 0) {
    const target = strategies.find((s) => s.maxPositionRate == null || s.maxPositionRate > 30) ?? strategies[0];
    out.push({
      id: `${target.id}-maxpos`,
      strategyId: target.id,
      strategyName: target.name,
      title: "最大保有比率の引き下げ",
      reason: `最大集中銘柄が ${(portfolio.maxRatio * 100).toFixed(1)}% に達しています${portfolio.maxName ? `（${portfolio.maxName}）` : ""}。`,
      currentRule: `最大保有比率 ${target.maxPositionRate != null ? `${target.maxPositionRate}%` : "未設定"}`,
      suggestedRule: "最大保有比率 30%",
      expectedEffect: "集中リスクの低減",
      risk: "分散による上値追随の鈍化",
      confidence: trades.length >= 5 ? "medium" : "low",
      createdAt: now,
      patch: { maxPositionRate: 30 },
    });
  }

  return out;
}

export function improverComments(improvements: Improvement[], trades: Trade[]): string[] {
  const out: string[] = [];
  if (trades.length < 5) out.push("取引件数が少ないため、改善提案の信頼度は限定的です。");
  if (improvements.some((i) => i.title.includes("RSI")))
    out.push("RSI高値圏での成績が低下しています。やや熱狂に乗りすぎです、ボス。");
  if (improvements.some((i) => i.title.includes("Score")))
    out.push("低Score銘柄の成績が振るいません。買い基準の引き上げが有効かもしれません。");
  if (improvements.some((i) => i.title.includes("損切り")))
    out.push("損失の伸びが利益を上回っています。損切りは早きに如かず、です。");
  if (improvements.length === 0)
    out.push("現状の売買ルールは有効に機能しています。大きな改善点は見当たりません、ボス。");
  return out;
}

// ---- 却下（非表示）永続化 ----
const KEY = "jarvis-trade-log:rule-improvements";

interface Store {
  dismissed: string[];
}

function read(): Store {
  if (typeof window === "undefined") return { dismissed: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Store>) : {};
    return { dismissed: Array.isArray(p.dismissed) ? p.dismissed : [] };
  } catch {
    return { dismissed: [] };
  }
}

export function getDismissedImprovements(): string[] {
  return read().dismissed;
}

export function dismissImprovement(id: string): void {
  if (typeof window === "undefined") return;
  const s = read();
  if (!s.dismissed.includes(id)) s.dismissed.push(id);
  window.localStorage.setItem(KEY, JSON.stringify(s));
}
