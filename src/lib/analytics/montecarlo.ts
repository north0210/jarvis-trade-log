/**
 * モンテカルロ分析（完全ローカル）。
 * 確定取引の1取引損益をブートストラップ再標本化し、資産推移分布・最大DD・
 * 破産確率・信頼区間などを推定する。Backtest（実現損益）の結果を土台とする。
 *
 * ※ 乱数はブラウザ実行時の Math.random を使用（アプリ実行時のみ動作）。
 */

/** 1パス分の損益列を生成するサンプラー。 */
export type PathSampler = (pool: number[], horizon: number) => number[];

/** 通常リサンプリング（IID・復元抽出）。 */
export const iidSampler: PathSampler = (pool, H) => {
  const out: number[] = [];
  for (let i = 0; i < H; i++) out.push(pool[(Math.random() * pool.length) | 0]);
  return out;
};

/** ブロックブートストラップ（連続 blockSize 件を塊で抽出し系列相関を保持）。 */
export function blockSampler(blockSize: number): PathSampler {
  const k = Math.max(1, Math.floor(blockSize));
  return (pool, H) => {
    const out: number[] = [];
    while (out.length < H) {
      const start = (Math.random() * pool.length) | 0;
      for (let j = 0; j < k && out.length < H; j++) out.push(pool[(start + j) % pool.length]);
    }
    return out;
  };
}

export interface MonteCarloInput {
  pnls: number[]; // 1取引あたり実現損益（円）の母集団
  capital: number; // 基準資産（%・破産判定の分母）
  runs: number; // シミュレーション回数
  horizon?: number; // 1パスの取引数（既定 = pnls.length）
  sampler?: PathSampler; // 既定は通常リサンプリング（IID）
}

export interface FanPoint {
  step: number;
  p5: number;
  p50: number;
  p95: number;
}

export interface DDBucket {
  bucket: string;
  count: number;
}

export interface MonteCarloResult {
  runs: number;
  horizon: number;
  capital: number;
  expectedPnl: number;
  expectedReturnPct: number;
  medianPnl: number;
  medianReturnPct: number;
  ci5Pnl: number;
  ci95Pnl: number;
  ci5Pct: number;
  ci95Pct: number;
  worstPnl: number;
  bestPnl: number;
  ddMean: number;
  ddMedian: number;
  dd95: number; // 最大DDの95パーセンタイル(%)
  probDDover30: number; // 最大DD>30%となる確率
  ruinProb: number; // 資産が0以下に到達する確率
  halveProb: number; // 資産が半減する確率
  maxLossStreakMean: number;
  probStreakGE5: number; // 5連敗以上の確率
  fan: FanPoint[];
  ddHistogram: DDBucket[];
  comments: string[];
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** 昇順ソート済み配列の分位点（線形補間）。 */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });

function empty(runs: number, horizon: number, capital: number): MonteCarloResult {
  return {
    runs,
    horizon,
    capital,
    expectedPnl: 0,
    expectedReturnPct: 0,
    medianPnl: 0,
    medianReturnPct: 0,
    ci5Pnl: 0,
    ci95Pnl: 0,
    ci5Pct: 0,
    ci95Pct: 0,
    worstPnl: 0,
    bestPnl: 0,
    ddMean: 0,
    ddMedian: 0,
    dd95: 0,
    probDDover30: 0,
    ruinProb: 0,
    halveProb: 0,
    maxLossStreakMean: 0,
    probStreakGE5: 0,
    fan: [],
    ddHistogram: [],
    comments: ["取引履歴が不足しているため、モンテカルロ分析を実行できません。売却を記録してください、ボス。"],
  };
}

export function runMonteCarlo({ pnls, capital, runs, horizon, sampler }: MonteCarloInput): MonteCarloResult {
  const H = horizon ?? pnls.length;
  const cap = capital > 0 ? capital : 1_000_000;
  if (pnls.length === 0 || H === 0 || runs <= 0) return empty(runs, H, cap);
  const sample = sampler ?? iidSampler;

  const finals: number[] = [];
  const ddPcts: number[] = [];
  const streaks: number[] = [];
  const stepEquities: number[][] = Array.from({ length: H }, () => []);
  let ruin = 0;
  let halve = 0;

  for (let r = 0; r < runs; r++) {
    let cum = 0;
    let peak = cap;
    let maxDD = 0;
    let streak = 0;
    let maxStreak = 0;
    let ruined = false;
    let halved = false;
    const path = sample(pnls, H);
    for (let i = 0; i < H; i++) {
      const pnl = path[i];
      cum += pnl;
      const eq = cap + cum;
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
      if (eq <= 0) ruined = true;
      if (cum <= -cap / 2) halved = true;
      if (pnl < 0) {
        streak++;
        if (streak > maxStreak) maxStreak = streak;
      } else if (pnl > 0) {
        streak = 0;
      }
      stepEquities[i].push(eq);
    }
    finals.push(cum);
    ddPcts.push(maxDD);
    streaks.push(maxStreak);
    if (ruined) ruin++;
    if (halved) halve++;
  }

  finals.sort((a, b) => a - b);
  ddPcts.sort((a, b) => a - b);

  const expectedPnl = mean(finals);
  const medianPnl = quantile(finals, 0.5);
  const ci5Pnl = quantile(finals, 0.05);
  const ci95Pnl = quantile(finals, 0.95);
  const pctOf = (v: number) => (v / cap) * 100;

  // ファンチャート（最大40ステップに間引き）
  const maxPoints = 40;
  const stride = Math.max(1, Math.ceil(H / maxPoints));
  const fan: FanPoint[] = [];
  for (let i = 0; i < H; i += stride) {
    const s = stepEquities[i].slice().sort((a, b) => a - b);
    fan.push({ step: i + 1, p5: quantile(s, 0.05), p50: quantile(s, 0.5), p95: quantile(s, 0.95) });
  }
  // 末尾を必ず含める
  const last = stepEquities[H - 1].slice().sort((a, b) => a - b);
  if (fan.length === 0 || fan[fan.length - 1].step !== H)
    fan.push({ step: H, p5: quantile(last, 0.05), p50: quantile(last, 0.5), p95: quantile(last, 0.95) });

  // DD ヒストグラム
  const ranges: [number, number, string][] = [
    [0, 5, "0-5%"],
    [5, 10, "5-10%"],
    [10, 15, "10-15%"],
    [15, 20, "15-20%"],
    [20, 30, "20-30%"],
    [30, 50, "30-50%"],
    [50, Infinity, "50%+"],
  ];
  const ddHistogram: DDBucket[] = ranges.map(([lo, hi, label]) => ({
    bucket: label,
    count: ddPcts.filter((d) => d >= lo && d < hi).length,
  }));

  const probDDover30 = ddPcts.filter((d) => d > 30).length / runs;
  const ruinProb = ruin / runs;
  const halveProb = halve / runs;
  const maxLossStreakMean = mean(streaks);
  const probStreakGE5 = streaks.filter((s) => s >= 5).length / runs;
  const dd95 = quantile(ddPcts, 0.95);

  // JARVIS 所見
  const comments: string[] = [];
  comments.push(
    `期待収益は ¥${fmt(expectedPnl)}（${pctOf(expectedPnl) >= 0 ? "+" : ""}${pctOf(expectedPnl).toFixed(1)}%）、中央値 ¥${fmt(medianPnl)} です。`
  );
  comments.push(
    `95%信頼区間では収益率は ${pctOf(ci5Pnl) >= 0 ? "+" : ""}${pctOf(ci5Pnl).toFixed(1)}% 〜 ${pctOf(ci95Pnl) >= 0 ? "+" : ""}${pctOf(ci95Pnl).toFixed(1)}% に収まります。`
  );
  comments.push(`最大DD30%超が発生する確率は ${(probDDover30 * 100).toFixed(1)}%（DD95: ${dd95.toFixed(1)}%）です。`);
  comments.push(`資産半減確率は ${(halveProb * 100).toFixed(1)}%、破産確率は ${(ruinProb * 100).toFixed(1)}% です。`);
  if (ruinProb < 0.05 && halveProb < 0.1) comments.push("リスクは許容範囲です、ボス。");
  else comments.push("下振れリスクが大きめです。ポジションサイズの抑制を検討してください。");

  return {
    runs,
    horizon: H,
    capital: cap,
    expectedPnl,
    expectedReturnPct: pctOf(expectedPnl),
    medianPnl,
    medianReturnPct: pctOf(medianPnl),
    ci5Pnl,
    ci95Pnl,
    ci5Pct: pctOf(ci5Pnl),
    ci95Pct: pctOf(ci95Pnl),
    worstPnl: finals[0],
    bestPnl: finals[finals.length - 1],
    ddMean: mean(ddPcts),
    ddMedian: quantile(ddPcts, 0.5),
    dd95,
    probDDover30,
    ruinProb,
    halveProb,
    maxLossStreakMean,
    probStreakGE5,
    fan,
    ddHistogram,
    comments,
  };
}

export const RUN_OPTIONS = [100, 500, 1000, 3000, 5000, 10000];
