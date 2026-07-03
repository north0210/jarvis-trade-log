/**
 * モンテカルロ高度化（Phase 26・完全ローカル）。
 * 既存 runMonteCarlo / blockSampler を再利用し、
 *  - ブロックブートストラップ vs 通常リサンプリングの比較
 *  - 戦略別リサンプリング
 *  - 複数戦略の合成シミュレーション＋寄与度
 * を提供する。
 */
import type { Stock, Strategy, Trade } from "@/lib/types";
import { estimateStrategyId } from "@/lib/analysis/strategyPerf";
import { runMonteCarlo, blockSampler, type MonteCarloResult } from "./montecarlo";

export type ResampleMode = "iid" | "block";

export interface StrategyPnls {
  id: string | null;
  name: string;
  pnls: number[];
}

/** 取引を戦略（設定 or 推定）でグルーピングして損益母集団を作る。 */
export function buildStrategyGroups(trades: Trade[], stocks: Stock[], strategies: Strategy[]): StrategyPnls[] {
  const nameById = new Map(strategies.map((s) => [s.id, s.name]));
  const groups = new Map<string, StrategyPnls>();
  for (const t of trades) {
    const id = estimateStrategyId(t, stocks, strategies);
    const key = id ?? "__none__";
    const name = id ? nameById.get(id) ?? "不明戦略" : "未分類";
    const g = groups.get(key) ?? { id, name, pnls: [] };
    g.pnls.push(t.realizedPnl);
    groups.set(key, g);
  }
  return Array.from(groups.values());
}

/** 通常 vs ブロックの結果と比較コメントを返す。 */
export function compareResampling(
  pnls: number[],
  capital: number,
  runs: number,
  blockSize: number
): { iid: MonteCarloResult; block: MonteCarloResult; comments: string[] } {
  const iid = runMonteCarlo({ pnls, capital, runs });
  const block = runMonteCarlo({ pnls, capital, runs, sampler: blockSampler(blockSize) });
  const comments: string[] = [];
  if (pnls.length > 0) {
    comments.push(
      `ブロックブートストラップでは最大DD95%が ${block.dd95.toFixed(0)}% です。通常リサンプリング（${iid.dd95.toFixed(0)}%）より${block.dd95 >= iid.dd95 ? "保守的" : "楽観的"}な結果です。`
    );
    comments.push(
      `資産半減確率: 通常 ${(iid.halveProb * 100).toFixed(1)}% / ブロック ${(block.halveProb * 100).toFixed(1)}%。`
    );
  }
  return { iid, block, comments };
}

export interface StrategyContribution {
  id: string | null;
  name: string;
  count: number;
  sumPnl: number;
  contributionPct: number; // 期待損益の寄与割合
  expectedReturnPct: number;
  ruinProb: number;
  dd95: number;
}

export interface CompositeResult {
  composite: MonteCarloResult;
  contributions: StrategyContribution[];
  comments: string[];
}

/** 複数戦略を合成した母集団でシミュレーションし、戦略別寄与度を算出する。 */
export function runCompositeMonteCarlo(
  groups: StrategyPnls[],
  opts: { capital: number; runs: number; mode: ResampleMode; blockSize: number }
): CompositeResult {
  const active = groups.filter((g) => g.pnls.length > 0);
  const pool = active.flatMap((g) => g.pnls);
  const sampler = opts.mode === "block" ? blockSampler(opts.blockSize) : undefined;
  const composite = runMonteCarlo({ pnls: pool, capital: opts.capital, runs: opts.runs, sampler });

  const totalSum = active.reduce((a, g) => a + g.pnls.reduce((x, y) => x + y, 0), 0);
  const contributions: StrategyContribution[] = active
    .map((g) => {
      const sumPnl = g.pnls.reduce((x, y) => x + y, 0);
      const r = runMonteCarlo({ pnls: g.pnls, capital: opts.capital, runs: Math.min(opts.runs, 500), sampler });
      return {
        id: g.id,
        name: g.name,
        count: g.pnls.length,
        sumPnl,
        contributionPct: totalSum !== 0 ? sumPnl / totalSum : 0,
        expectedReturnPct: r.expectedReturnPct,
        ruinProb: r.ruinProb,
        dd95: r.dd95,
      };
    })
    .sort((a, b) => b.sumPnl - a.sumPnl);

  const comments: string[] = [];
  if (contributions.length) {
    const top = contributions[0];
    if (top.contributionPct >= 0.5)
      comments.push(
        `${top.name}戦略が期待リターンの ${(top.contributionPct * 100).toFixed(0)}% を占めています。依存度が高いため注意が必要です。`
      );
    comments.push(
      `合成ポートフォリオの資産半減確率は ${(composite.halveProb * 100).toFixed(1)}% です。${composite.halveProb < 0.1 ? "現時点では許容範囲内です。" : "やや高めです。分散を検討してください。"}`
    );
    comments.push(`合成の期待リターンは ${composite.expectedReturnPct >= 0 ? "+" : ""}${composite.expectedReturnPct.toFixed(1)}%、DD95 ${composite.dd95.toFixed(1)}% です。`);
  } else {
    comments.push("戦略に紐付く取引がありません。売却時に戦略を選択すると合成分析が可能になります。");
  }
  return { composite, contributions, comments };
}
