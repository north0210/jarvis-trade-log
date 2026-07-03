/**
 * Phase 49: 通知しきい値設定（完全ローカル）。
 * Risk / Discipline / Volume などの通知・警告発火条件をユーザーが調整可能にする。
 * alerts.ts / score.ts / types.ts は変更しない。既存の固定値を初期値として踏襲。
 */

const KEY = "jarvis-trade-log:threshold-settings";

export type RiskGradeThreshold = "S" | "A" | "B" | "C" | "D";

export interface ThresholdSettings {
  /** この Grade 以下（含む）で危険通知。既定 D。 */
  riskGradeDanger: RiskGradeThreshold;
  /** 破産確率(%)がこの値以上で危険。既定 5。 */
  ruinProbabilityDanger: number;
  /** 資産半減確率(%)がこの値以上で危険。既定 10。 */
  halfCapitalProbabilityDanger: number;
  /** 最大DD(%)がこの値以上で警告。既定 30。 */
  drawdownWarning: number;
  /** 規律スコアがこの値未満で警告。既定 70。 */
  disciplineScoreWarning: number;
  /** 相対出来高がこの倍率以上で警告。既定 2.0。 */
  relativeVolumeWarning: number;
  /** 相対出来高がこの倍率以上で危険。既定 3.0。 */
  relativeVolumeDanger: number;
  /** RSIがこの値以上で過熱扱い。既定 80。 */
  rsiOverheat: number;
  /** 1銘柄比率(%)がこの値以上で警告。既定 40。 */
  oneStockWeightWarning: number;
  /** セクター/テーマ比率(%)がこの値以上で警告。既定 60。 */
  sectorWeightWarning: number;
}

export const DEFAULT_THRESHOLDS: ThresholdSettings = {
  riskGradeDanger: "D",
  ruinProbabilityDanger: 5,
  halfCapitalProbabilityDanger: 10,
  drawdownWarning: 30,
  disciplineScoreWarning: 70,
  relativeVolumeWarning: 2.0,
  relativeVolumeDanger: 3.0,
  rsiOverheat: 80,
  oneStockWeightWarning: 40,
  sectorWeightWarning: 60,
};

const GRADE_ORDER: Record<RiskGradeThreshold, number> = { S: 4, A: 3, B: 2, C: 1, D: 0 };

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function getThresholds(): ThresholdSettings {
  if (typeof window === "undefined") return { ...DEFAULT_THRESHOLDS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_THRESHOLDS };
    const p = JSON.parse(raw) as Partial<ThresholdSettings>;
    const grade = p.riskGradeDanger;
    return {
      riskGradeDanger: grade === "S" || grade === "A" || grade === "B" || grade === "C" || grade === "D" ? grade : DEFAULT_THRESHOLDS.riskGradeDanger,
      ruinProbabilityDanger: num(p.ruinProbabilityDanger, DEFAULT_THRESHOLDS.ruinProbabilityDanger),
      halfCapitalProbabilityDanger: num(p.halfCapitalProbabilityDanger, DEFAULT_THRESHOLDS.halfCapitalProbabilityDanger),
      drawdownWarning: num(p.drawdownWarning, DEFAULT_THRESHOLDS.drawdownWarning),
      disciplineScoreWarning: num(p.disciplineScoreWarning, DEFAULT_THRESHOLDS.disciplineScoreWarning),
      relativeVolumeWarning: num(p.relativeVolumeWarning, DEFAULT_THRESHOLDS.relativeVolumeWarning),
      relativeVolumeDanger: num(p.relativeVolumeDanger, DEFAULT_THRESHOLDS.relativeVolumeDanger),
      rsiOverheat: num(p.rsiOverheat, DEFAULT_THRESHOLDS.rsiOverheat),
      oneStockWeightWarning: num(p.oneStockWeightWarning, DEFAULT_THRESHOLDS.oneStockWeightWarning),
      sectorWeightWarning: num(p.sectorWeightWarning, DEFAULT_THRESHOLDS.sectorWeightWarning),
    };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function setThresholds(patch: Partial<ThresholdSettings>): ThresholdSettings {
  const merged = { ...getThresholds(), ...patch };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

export function resetThresholds(): ThresholdSettings {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
  return { ...DEFAULT_THRESHOLDS };
}

/** 指定 Grade が危険しきい値（以下）に達しているか。 */
export function isGradeDanger(grade: RiskGradeThreshold, threshold: RiskGradeThreshold): boolean {
  return GRADE_ORDER[grade] <= GRADE_ORDER[threshold];
}

/** 標準値からの乖離度合い（神経質/無難のコメント用）。過敏側=+、寛容側=-。 */
export function sensitivityBias(t: ThresholdSettings): number {
  let bias = 0;
  if (t.ruinProbabilityDanger < DEFAULT_THRESHOLDS.ruinProbabilityDanger) bias++;
  else if (t.ruinProbabilityDanger > DEFAULT_THRESHOLDS.ruinProbabilityDanger) bias--;
  if (t.halfCapitalProbabilityDanger < DEFAULT_THRESHOLDS.halfCapitalProbabilityDanger) bias++;
  else if (t.halfCapitalProbabilityDanger > DEFAULT_THRESHOLDS.halfCapitalProbabilityDanger) bias--;
  if (t.drawdownWarning < DEFAULT_THRESHOLDS.drawdownWarning) bias++;
  else if (t.drawdownWarning > DEFAULT_THRESHOLDS.drawdownWarning) bias--;
  if (t.disciplineScoreWarning > DEFAULT_THRESHOLDS.disciplineScoreWarning) bias++;
  else if (t.disciplineScoreWarning < DEFAULT_THRESHOLDS.disciplineScoreWarning) bias--;
  if (t.relativeVolumeDanger < DEFAULT_THRESHOLDS.relativeVolumeDanger) bias++;
  else if (t.relativeVolumeDanger > DEFAULT_THRESHOLDS.relativeVolumeDanger) bias--;
  if (t.rsiOverheat < DEFAULT_THRESHOLDS.rsiOverheat) bias++;
  else if (t.rsiOverheat > DEFAULT_THRESHOLDS.rsiOverheat) bias--;
  return bias;
}
