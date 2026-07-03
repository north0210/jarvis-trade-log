/**
 * Phase 51 (v1.1精緻化): JARVIS Advisor 型定義。
 * 9カテゴリ＋加重合成スコアで売買候補を提示する判断補助レイヤー。投資助言ではない。
 * 既存の score/alerts/risk/strategy/provider は変更しない。
 */

export type AdvisorCategory =
  | "strongBuy" // Strong Buy
  | "buy" // Buy
  | "watch" // Watch
  | "hold" // Hold
  | "partialTP" // Partial Take Profit
  | "reduce" // Reduce
  | "sellCandidate" // Sell Candidate
  | "danger" // Danger
  | "avoid"; // Avoid

export const CATEGORY_ORDER: AdvisorCategory[] = [
  "strongBuy",
  "buy",
  "watch",
  "hold",
  "partialTP",
  "reduce",
  "sellCandidate",
  "danger",
  "avoid",
];

export const CATEGORY_LABELS: Record<AdvisorCategory, string> = {
  strongBuy: "Strong Buy（強気候補）",
  buy: "Buy（買い候補）",
  watch: "Watch（監視）",
  hold: "Hold（保有継続）",
  partialTP: "Partial Take Profit（一部利確）",
  reduce: "Reduce（比率縮小）",
  sellCandidate: "Sell Candidate（売却候補）",
  danger: "Danger（危険）",
  avoid: "Avoid（見送り）",
};

export const CATEGORY_TONE: Record<AdvisorCategory, "good" | "info" | "caution" | "danger"> = {
  strongBuy: "good",
  buy: "good",
  watch: "info",
  hold: "info",
  partialTP: "caution",
  reduce: "caution",
  sellCandidate: "danger",
  danger: "danger",
  avoid: "info",
};

/** 合成評価グレード（A+ 等の段階つき）。 */
export type OverallGrade = "S" | "A+" | "A" | "B+" | "B" | "C" | "D";

/** 判定の重み（合計100）。 */
export interface AdvisorWeights {
  score: number;
  risk: number;
  backtest: number;
  montecarlo: number;
  volume: number;
  strategy: number;
  discipline: number;
}

export const ADVISOR_WEIGHTS: AdvisorWeights = {
  score: 30,
  risk: 20,
  backtest: 15,
  montecarlo: 10,
  volume: 10,
  strategy: 10,
  discipline: 5,
};

export interface AdvisorItem {
  code: string;
  name: string;
  category: AdvisorCategory;
  grade: OverallGrade; // 合成評価
  composite: number; // 0-100 合成スコア
  score: number; // 元 JARVIS Score
  held: boolean;
  reasons: string[]; // 根拠（断定しない）
  action: string; // 推奨行動の目安
  btGrade: OverallGrade | null; // 個別銘柄BTグレード（データ無しは null）
  btScore: number | null; // 個別銘柄BTスコア(0-100)
  bt: AdvisorBtDetail | null; // 個別銘柄BT詳細（表示用）
}

export interface AdvisorBtDetail {
  pf: number | null;
  maxDD: number | null;
  winRate: number | null;
  cagr: number | null;
  ruin: number | null;
  expectedValue: number | null;
  tradeCount: number | null;
  savedAt: string | null;
}

export interface AdvisorCounts {
  strongBuy: number;
  buy: number;
  watch: number;
  hold: number;
  partialTP: number;
  reduce: number;
  sellCandidate: number;
  danger: number;
  avoid: number;
}

export interface AdvisorReport {
  hasData: boolean;
  items: AdvisorItem[];
  byCategory: Record<AdvisorCategory, AdvisorItem[]>;
  counts: AdvisorCounts;
  comments: string[]; // JARVIS 所見
  disclaimer: string;
}
