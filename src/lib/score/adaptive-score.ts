/**
 * Adaptive Score（Phase 29・ラッパー方式）。
 * 既存 scoreStock() は変更せず基準スコアとして利用し、Factor分析の寄与度に応じて
 * ±15点の範囲で補正する。score.ts 本体・ScoreResult は一切変更しない。
 */
import type { Stock } from "@/lib/types";
import { scoreStock, type ScoreResult } from "@/lib/score";
import { stockFactors, type FactorAnalysis, type FactorKey } from "@/lib/analytics/factor-analysis";
import { K } from "@/lib/storage/keys";

export interface FactorWeights {
  value: number;
  growth: number;
  quality: number;
  momentum: number;
  risk: number;
  discipline: number;
}

export interface AdaptiveScoreSettings {
  enabled: boolean;
  factorWeights: FactorWeights;
}

// 既存 scoreStock の配分に近い既定（成長・収益質を重め）
export const DEFAULT_ADAPTIVE_SETTINGS: AdaptiveScoreSettings = {
  enabled: false,
  factorWeights: { value: 50, growth: 70, quality: 60, momentum: 40, risk: 50, discipline: 50 },
};

export interface AdaptiveScoreResult {
  score: number;
  grade: ScoreResult["grade"];
  recommendation: string;
  reasons: string[];
  baseScore: number;
  adjustment: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const MAX_ADJ = 15;

const REC: Record<ScoreResult["grade"], string> = {
  S: "積極監視",
  A: "買い候補",
  B: "押し目待ち",
  C: "様子見",
  D: "見送り",
};
function gradeOf(score: number): ScoreResult["grade"] {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

const STOCK_KEYS: FactorKey[] = ["value", "growth", "quality", "momentum"];
const LABELS: Record<FactorKey, string> = {
  value: "Value",
  growth: "Growth",
  quality: "Quality",
  momentum: "Momentum",
};

/** 基準スコアに Factor 寄与ベースの補正（±15）を加えた適応スコアを返す。 */
export function adaptiveScoreStock(
  stock: Stock,
  factor: FactorAnalysis,
  weights: FactorWeights
): AdaptiveScoreResult {
  const base = scoreStock(stock);
  const sf = stockFactors(stock);
  const contribByKey = new Map(factor.factors.map((f) => [f.key, f.contribution]));

  const reasons: string[] = [...base.reasons];
  let raw = 0;

  for (const key of STOCK_KEYS) {
    const exposure = (sf[key] - 50) / 50; // −1〜1
    const contrib = contribByKey.get(key) ?? 0; // −1〜1
    const w = weights[key] / 100;
    const term = contrib * exposure * w * MAX_ADJ;
    raw += term;
    if (Math.abs(term) >= 1)
      reasons.push(
        `Adaptive: ${LABELS[key]}寄与(${(contrib * 100).toFixed(0)}%)×エクスポージャ${sf[key].toFixed(0)} → ${term >= 0 ? "+" : ""}${term.toFixed(1)}pt`
      );
  }

  // 環境ファクター（全銘柄共通）: 規律・リスク
  const dTerm = ((factor.disciplineFactor.score - 70) / 30) * (weights.discipline / 100) * 5;
  if (Math.abs(dTerm) >= 1) {
    raw += dTerm;
    reasons.push(`Adaptive: 規律スコア${factor.disciplineFactor.score} → ${dTerm >= 0 ? "+" : ""}${dTerm.toFixed(1)}pt`);
  }
  const riskMap: Record<string, number> = { S: 1, A: 0.5, B: 0, C: -0.7, D: -1 };
  const rTerm = (riskMap[factor.riskFactor.grade] ?? 0) * (weights.risk / 100) * 5;
  if (Math.abs(rTerm) >= 1) {
    raw += rTerm;
    reasons.push(`Adaptive: リスクGrade${factor.riskFactor.grade} → ${rTerm >= 0 ? "+" : ""}${rTerm.toFixed(1)}pt`);
  }

  const adjustment = Math.round(clamp(raw, -MAX_ADJ, MAX_ADJ));
  const score = clamp(base.score + adjustment, 0, 100);
  const grade = gradeOf(score);
  if (adjustment === 0) reasons.push("Adaptive: 顕著な補正なし（基準スコアを採用）");

  return { score, grade, recommendation: REC[grade], reasons, baseScore: base.score, adjustment };
}

// ---- 設定永続化 ----
const KEY = K.adaptiveScoreSettings;

export function getAdaptiveScoreSettings(): AdaptiveScoreSettings {
  if (typeof window === "undefined") return { ...DEFAULT_ADAPTIVE_SETTINGS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_ADAPTIVE_SETTINGS };
    const p = JSON.parse(raw) as Partial<AdaptiveScoreSettings>;
    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : false,
      factorWeights: { ...DEFAULT_ADAPTIVE_SETTINGS.factorWeights, ...(p.factorWeights ?? {}) },
    };
  } catch {
    return { ...DEFAULT_ADAPTIVE_SETTINGS };
  }
}

export function setAdaptiveScoreSettings(patch: Partial<AdaptiveScoreSettings>): AdaptiveScoreSettings {
  const merged: AdaptiveScoreSettings = {
    ...getAdaptiveScoreSettings(),
    ...patch,
    factorWeights: { ...getAdaptiveScoreSettings().factorWeights, ...(patch.factorWeights ?? {}) },
  };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}
