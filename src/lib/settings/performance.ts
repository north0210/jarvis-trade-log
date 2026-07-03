/**
 * Phase 49（最適化）: パフォーマンスモード設定（完全ローカル）。
 * モンテカルロ等の計算負荷を Fast / Normal / Research で切替え、体感速度を調整する。
 * Dashboard 埋め込みMC（ホットパス）と、分析ページの本格MCで別々の回数を用いる。
 */

const KEY = "jarvis-trade-log:performance-mode";

export type PerformanceMode = "fast" | "normal" | "research";
export type LoadLevel = "low" | "medium" | "high";

export interface PerfProfile {
  mode: PerformanceMode;
  label: string;
  dashboardRuns: number; // Dashboard/派生ページの埋め込みMC回数（軽量）
  analysisRuns: number; // Risk/Report/MonteCarlo の本格MC回数
  load: LoadLevel;
  loadLabel: string;
  comment: string;
}

export const PERF_PROFILES: Record<PerformanceMode, PerfProfile> = {
  fast: {
    mode: "fast",
    label: "Fast（高速）",
    dashboardRuns: 300,
    analysisRuns: 1000,
    load: "low",
    loadLabel: "Low",
    comment: "高速分析モードです。日常運用向けです、ボス。",
  },
  normal: {
    mode: "normal",
    label: "Normal（標準）",
    dashboardRuns: 500,
    analysisRuns: 3000,
    load: "medium",
    loadLabel: "Medium",
    comment: "標準分析です。速度と精度の均衡を取っています。",
  },
  research: {
    mode: "research",
    label: "Research（研究）",
    dashboardRuns: 1000,
    analysisRuns: 10000,
    load: "high",
    loadLabel: "High",
    comment: "研究モードです。若干神経質ですが、統計家は喜ぶでしょう。",
  },
};

const DEFAULT_MODE: PerformanceMode = "normal";

export function getPerformanceMode(): PerformanceMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const v = window.localStorage.getItem(KEY);
  return v === "fast" || v === "normal" || v === "research" ? v : DEFAULT_MODE;
}

export function setPerformanceMode(mode: PerformanceMode): PerformanceMode {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, mode);
  return mode;
}

export function getPerfProfile(): PerfProfile {
  return PERF_PROFILES[getPerformanceMode()];
}

/** Dashboard/派生ページの埋め込みMC回数（ホットパス・軽量）。 */
export function getDashboardRuns(): number {
  return getPerfProfile().dashboardRuns;
}

/** Risk/Report/MonteCarlo の本格MC回数。 */
export function getAnalysisRuns(): number {
  return getPerfProfile().analysisRuns;
}
