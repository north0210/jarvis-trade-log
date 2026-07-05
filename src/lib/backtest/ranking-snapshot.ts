/**
 * 戦略ランキングスナップショット（Phase 39・完全ローカル）。
 * Phase 38 の一括バックテスト結果を日付付きで保存し、過去との推移比較を可能にする。
 */
import type { StrategyRankingRow, StrategyRankingSnapshot } from "@/lib/types";
import type { StrategyBatchResult } from "./strategy-batch";
import { K } from "@/lib/storage/keys";

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export type RankingSnapshotInput = Omit<StrategyRankingSnapshot, "id" | "createdAt">;

/** 一括BT結果からスナップショット内容を構築する。 */
export function buildRankingSnapshot(
  batch: StrategyBatchResult[],
  opts: { date: string; period: string; initialCapital: number; targetStockCount: number }
): RankingSnapshotInput {
  const rows: StrategyRankingRow[] = batch
    .map((b) => ({
      strategyId: b.strategyId,
      strategyName: b.strategyName,
      rank: b.rank,
      cagr: b.cagr,
      profitFactor: b.profitFactor,
      maxDrawdown: b.maxDrawdown,
      winRate: b.winRate,
      expectedValue: b.expectedValue,
      sharpe: b.sharpe,
      tradeCount: b.tradeCount,
    }))
    .sort((a, b) => a.rank - b.rank);

  const averageCagr = mean(rows.map((r) => r.cagr));
  const pfs = rows.map((r) => r.profitFactor).filter((x): x is number => x != null);
  const averagePf = pfs.length ? mean(pfs) : 0;
  const averageMaxDrawdown = mean(rows.map((r) => r.maxDrawdown));
  const averageWinRate = mean(rows.map((r) => r.winRate));
  const best = rows[0];
  const worst = rows[rows.length - 1];

  return {
    date: opts.date,
    period: opts.period,
    initialCapital: opts.initialCapital,
    targetStockCount: opts.targetStockCount,
    rankingResults: rows,
    bestStrategy: best?.strategyName ?? "—",
    worstStrategy: worst?.strategyName ?? "—",
    averageCagr,
    averagePf,
    averageMaxDrawdown,
    averageWinRate,
    jarvisComment: best
      ? `最強は${best.strategyName}（CAGR ${best.cagr.toFixed(1)}%）。平均CAGR ${averageCagr.toFixed(1)}% / 平均PF ${averagePf.toFixed(2)} / 平均最大DD ${averageMaxDrawdown.toFixed(1)}%。`
      : "対象戦略がありません。",
  };
}

// ---- Repository ----
const KEY = K.strategyRankingSnapshots;

export interface StrategyRankingSnapshotRepository {
  readonly name: string;
  list(): Promise<StrategyRankingSnapshot[]>;
  create(input: RankingSnapshotInput): Promise<StrategyRankingSnapshot>;
  update(id: string, input: RankingSnapshotInput): Promise<StrategyRankingSnapshot>;
  remove(id: string): Promise<void>;
}

class LocalRepo implements StrategyRankingSnapshotRepository {
  readonly name = "local-storage";
  private read(): StrategyRankingSnapshot[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(KEY);
      const p = raw ? JSON.parse(raw) : [];
      return Array.isArray(p) ? (p as StrategyRankingSnapshot[]) : [];
    } catch {
      return [];
    }
  }
  private write(list: StrategyRankingSnapshot[]) {
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(list));
  }
  private newId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  async list() {
    return this.read().sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt.localeCompare(a.createdAt)));
  }
  async create(input: RankingSnapshotInput) {
    const list = this.read();
    const snap: StrategyRankingSnapshot = { ...input, id: this.newId(), createdAt: new Date().toISOString() };
    list.push(snap);
    this.write(list);
    return snap;
  }
  async update(id: string, input: RankingSnapshotInput) {
    const list = this.read();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) throw new Error(`ランキングが見つかりません: ${id}`);
    const updated: StrategyRankingSnapshot = { ...input, id, createdAt: list[idx].createdAt };
    list[idx] = updated;
    this.write(list);
    return updated;
  }
  async remove(id: string) {
    this.write(this.read().filter((x) => x.id !== id));
  }
}

let instance: StrategyRankingSnapshotRepository | null = null;
export function getStrategyRankingSnapshotRepository(): StrategyRankingSnapshotRepository {
  if (!instance) instance = new LocalRepo();
  return instance;
}

// ---- 比較 ----
export interface RankingCompareRow {
  label: string;
  cur: string;
  prev: string;
  delta: string;
  better: boolean | null;
}
export interface RankChange {
  strategyName: string;
  curRank: number;
  prevRank: number | null;
  delta: number; // 正=順位上昇
}

const pctFmt = (n: number) => `${n.toFixed(1)}%`;

export function compareRanking(
  cur: StrategyRankingSnapshot,
  prev: StrategyRankingSnapshot | null
): { rows: RankingCompareRow[]; changes: RankChange[]; comments: string[] } {
  const metrics: { label: string; get: (s: StrategyRankingSnapshot) => number; fmt: (n: number) => string; higher: boolean }[] = [
    { label: "平均CAGR", get: (s) => s.averageCagr, fmt: pctFmt, higher: true },
    { label: "平均PF", get: (s) => s.averagePf, fmt: (n) => n.toFixed(2), higher: true },
    { label: "平均最大DD", get: (s) => s.averageMaxDrawdown, fmt: pctFmt, higher: false },
    { label: "平均勝率", get: (s) => s.averageWinRate * 100, fmt: pctFmt, higher: true },
  ];
  const rows: RankingCompareRow[] = metrics.map((m) => {
    const c = m.get(cur);
    const p = prev ? m.get(prev) : c;
    const diff = c - p;
    let better: boolean | null = null;
    if (prev && diff !== 0) better = m.higher ? diff > 0 : diff < 0;
    return {
      label: m.label,
      cur: m.fmt(c),
      prev: prev ? m.fmt(p) : "—",
      delta: prev ? `${diff >= 0 ? "+" : ""}${m.fmt(Math.abs(diff))}` : "—",
      better,
    };
  });

  const changes: RankChange[] = cur.rankingResults.map((r) => {
    const pr = prev?.rankingResults.find((x) => x.strategyId === r.strategyId) ?? null;
    return { strategyName: r.strategyName, curRank: r.rank, prevRank: pr?.rank ?? null, delta: pr ? pr.rank - r.rank : 0 };
  });

  const comments: string[] = [];
  if (!prev) {
    comments.push("前回スナップショットがありません。継続保存で推移を比較できます、ボス。");
  } else {
    // 最強戦略のCAGR変化
    const bestNow = cur.rankingResults[0];
    if (bestNow) {
      const bestPrev = prev.rankingResults.find((x) => x.strategyId === bestNow.strategyId);
      if (bestPrev) {
        const d = bestNow.cagr - bestPrev.cagr;
        if (Math.abs(d) >= 0.5)
          comments.push(`前回と比較して${bestNow.strategyName}のCAGRが${d >= 0 ? "改善" : "低下"}しています（${d >= 0 ? "+" : ""}${d.toFixed(1)}pt）。`);
      }
    }
    // DD拡大した戦略
    const ddUp = cur.rankingResults.find((r) => {
      const pr = prev.rankingResults.find((x) => x.strategyId === r.strategyId);
      return pr && r.maxDrawdown - pr.maxDrawdown >= 5;
    });
    if (ddUp) comments.push(`${ddUp.strategyName}は最大DDが拡大しています。攻撃性が上がっている可能性があります。`);
    // 順位変動
    const risen = changes.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta)[0];
    if (risen && risen.delta > 0) comments.push(`${risen.strategyName}が ${risen.delta} ランク上昇しました。`);
    if (comments.length === 0) comments.push("前回から大きな変化はありません。");
  }
  return { rows, changes, comments };
}
