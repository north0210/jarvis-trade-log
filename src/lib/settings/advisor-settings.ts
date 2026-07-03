/**
 * Phase 52 (v1.1最終): JARVIS Advisor 重み設定（完全ローカル）。
 * 7指標の重みをユーザー調整可能にする。エンジンは重みを合計で正規化して適用するため、
 * 実質「合計100固定」で扱われる。types.ts は変更しない（本モジュールで型を保持）。
 */
import { ADVISOR_WEIGHTS, type AdvisorWeights } from "@/lib/advisor/advisorTypes";

const KEY = "jarvis-trade-log:advisor-weights";

export type PresetKey = "conservative" | "balanced" | "aggressive" | "dividend" | "growth" | "swing" | "shortTerm";

export interface Preset {
  key: PresetKey;
  label: string;
  weights: AdvisorWeights;
}

export const PRESETS: Preset[] = [
  { key: "conservative", label: "Conservative（慎重）", weights: { score: 25, risk: 30, backtest: 15, montecarlo: 15, volume: 5, strategy: 5, discipline: 5 } },
  { key: "balanced", label: "Balanced（標準）", weights: { ...ADVISOR_WEIGHTS } },
  { key: "aggressive", label: "Aggressive（積極）", weights: { score: 35, risk: 10, backtest: 10, montecarlo: 5, volume: 20, strategy: 15, discipline: 5 } },
  { key: "dividend", label: "Dividend（安定配当）", weights: { score: 30, risk: 25, backtest: 15, montecarlo: 10, volume: 5, strategy: 10, discipline: 5 } },
  { key: "growth", label: "Growth（成長）", weights: { score: 40, risk: 10, backtest: 15, montecarlo: 5, volume: 15, strategy: 10, discipline: 5 } },
  { key: "swing", label: "Swing（スイング）", weights: { score: 25, risk: 15, backtest: 10, montecarlo: 5, volume: 25, strategy: 15, discipline: 5 } },
  { key: "shortTerm", label: "ShortTerm（短期）", weights: { score: 20, risk: 15, backtest: 5, montecarlo: 5, volume: 35, strategy: 15, discipline: 5 } },
];

export const WEIGHT_KEYS: (keyof AdvisorWeights)[] = ["score", "risk", "backtest", "montecarlo", "volume", "strategy", "discipline"];

export const WEIGHT_META: Record<keyof AdvisorWeights, { label: string; help: string }> = {
  score: { label: "Score", help: "総合優位性評価。JARVIS標準 30%。推奨範囲 20〜40%。" },
  risk: { label: "Risk", help: "リスク管理重視度。標準 20%。推奨 15〜30%。" },
  backtest: { label: "Backtest", help: "過去検証重視度。標準 15%。推奨 10〜25%。" },
  montecarlo: { label: "MonteCarlo", help: "破産確率など将来分布の重視度。標準 10%。推奨 5〜15%。" },
  volume: { label: "Volume", help: "出来高重視。標準 10%。推奨 5〜20%。" },
  strategy: { label: "Strategy", help: "主戦略適合の重視度。標準 10%。推奨 5〜20%。" },
  discipline: { label: "Discipline", help: "規律遵守の重視度。標準 5%。推奨 5〜15%。" },
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function getAdvisorWeights(): AdvisorWeights {
  if (typeof window === "undefined") return { ...ADVISOR_WEIGHTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...ADVISOR_WEIGHTS };
    const p = JSON.parse(raw) as Partial<AdvisorWeights>;
    return {
      score: num(p.score, ADVISOR_WEIGHTS.score),
      risk: num(p.risk, ADVISOR_WEIGHTS.risk),
      backtest: num(p.backtest, ADVISOR_WEIGHTS.backtest),
      montecarlo: num(p.montecarlo, ADVISOR_WEIGHTS.montecarlo),
      volume: num(p.volume, ADVISOR_WEIGHTS.volume),
      strategy: num(p.strategy, ADVISOR_WEIGHTS.strategy),
      discipline: num(p.discipline, ADVISOR_WEIGHTS.discipline),
    };
  } catch {
    return { ...ADVISOR_WEIGHTS };
  }
}

export function setAdvisorWeights(w: AdvisorWeights): AdvisorWeights {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(w));
  return w;
}

export function resetAdvisorWeights(): AdvisorWeights {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
  return { ...ADVISOR_WEIGHTS };
}

export function sumWeights(w: AdvisorWeights): number {
  return WEIGHT_KEYS.reduce((a, k) => a + w[k], 0);
}

/** 合計100へ比例正規化（整数・端数は Score で調整）。 */
export function normalizeTo100(w: AdvisorWeights): AdvisorWeights {
  const s = sumWeights(w);
  if (s <= 0) return { ...ADVISOR_WEIGHTS };
  const scaled = {} as AdvisorWeights;
  for (const k of WEIGHT_KEYS) scaled[k] = Math.round((w[k] / s) * 100);
  const diff = 100 - sumWeights(scaled);
  scaled.score = Math.max(0, scaled.score + diff);
  return scaled;
}

/** 適用時の正規化%（表示用）。 */
export function appliedPercents(w: AdvisorWeights): AdvisorWeights {
  return normalizeTo100(w);
}

/** 現在の重みが一致するプリセット名（なければ Custom）。 */
export function detectPreset(w: AdvisorWeights): string {
  const match = PRESETS.find((p) => WEIGHT_KEYS.every((k) => p.weights[k] === w[k]));
  return match ? match.label : "Custom（カスタム）";
}

/** 設定変更時の JARVIS コメント。 */
export function weightComment(w: AdvisorWeights): string {
  const p = appliedPercents(w);
  if (p.risk + p.discipline + p.montecarlo >= 50) return "かなり慎重です。";
  if (p.risk >= 25 || p.discipline >= 15) return "規律重視型の設定です。";
  if (p.score + p.volume >= 55 || p.risk <= 12) return "少々積極的な設定です、ボス。";
  return "バランス型の設定です。";
}
