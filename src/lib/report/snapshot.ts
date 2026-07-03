/**
 * レポートスナップショット（Phase 32・完全ローカル）。
 * 主要分析指標を集約して保存し、過去との比較・推移を可能にする。
 * 既存の各分析エンジンを再利用（変更しない）。
 */
import type { Holding, Journal, ReportSnapshot, Stock, Strategy, Trade } from "@/lib/types";
import { analyzePortfolio } from "@/lib/analysis/portfolio";
import { analyzeTrades } from "@/lib/analysis/trades";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateDiscipline } from "@/lib/discipline/rules";
import { evaluateRisk } from "@/lib/risk/risk-engine";
import { analyzeFactors } from "@/lib/analytics/factor-analysis";
import { analyzeMental } from "@/lib/mental/mental-analysis";
import { analyzeByStrategy } from "@/lib/analysis/strategyPerf";
import { getBacktestSummaries } from "@/lib/analytics/backtest-engine";
import { computeMarketRadar } from "@/lib/market/market-radar";
import { computeSectorHeatmap } from "@/lib/market/sector-heatmap";

export type SnapshotFields = Omit<ReportSnapshot, "id" | "date" | "period" | "createdAt">;

const yen = (n: number) => `${n >= 0 ? "+" : ""}¥${n.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}`;

/** 現在の全データからスナップショット指標を集約する。 */
export function computeSnapshotFields(
  stocks: Stock[],
  holdings: Holding[],
  journals: Journal[],
  trades: Trade[],
  strategies: Strategy[],
  cash: number
): SnapshotFields {
  const portfolio = analyzePortfolio(stocks, holdings, cash);
  const tradeStats = analyzeTrades(trades);
  const mc = trades.length ? runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: 500 }) : null;
  const backtest = runBacktest(trades);
  const discipline = evaluateDiscipline(stocks, holdings, trades, cash);
  const risk = mc ? evaluateRisk(portfolio, mc, backtest, discipline, trades) : null;
  const factor = analyzeFactors(stocks, trades, strategies, risk, discipline);
  const mental = trades.length ? analyzeMental(journals, trades) : null;
  const perf = analyzeByStrategy(trades, strategies);
  const btSummaries = getBacktestSummaries();

  const conc = portfolio.maxPosition?.ratio ?? 0;
  const theme = portfolio.byTheme[0]?.ratio ?? 0;
  let portfolioScore = 100;
  portfolioScore -= conc >= 0.4 ? 20 : conc >= 0.25 ? 8 : 0;
  portfolioScore -= theme >= 0.6 ? 20 : theme >= 0.4 ? 8 : 0;
  portfolioScore -= portfolio.cashRatio < 0.1 ? 10 : 0;
  portfolioScore = Math.max(0, Math.min(100, portfolioScore));

  const cagr = btSummaries.length ? btSummaries.reduce((a, s) => a + s.cagr, 0) / btSummaries.length : 0;

  const radar = stocks.length ? computeMarketRadar({ stocks, portfolio, risk, mc, discipline, mental, factor }) : null;
  const sector = stocks.length ? computeSectorHeatmap(stocks, holdings) : null;

  const riskGrade = risk?.riskGrade ?? "—";
  const jarvisSummary = `Risk ${riskGrade} / 規律 ${discipline.score} / メンタル ${mental?.mentalScore ?? "—"}。実現損益 ${yen(tradeStats.totalRealizedPnl)}、勝率 ${(tradeStats.winRate * 100).toFixed(0)}%。`;

  return {
    totalAssets: portfolio.totalAssets,
    totalPnl: portfolio.pnl,
    realizedPnl: tradeStats.totalRealizedPnl,
    winRate: tradeStats.winRate,
    riskGrade,
    riskScore: risk?.riskScore ?? 0,
    disciplineScore: discipline.score,
    mentalScore: mental?.mentalScore ?? 0,
    portfolioScore,
    bestStrategy: perf.length ? perf[0].name : "—",
    worstStrategy: perf.length ? perf[perf.length - 1].name : "—",
    bestFactor: factor.bestFactor?.label ?? "—",
    worstFactor: factor.worstFactor?.label ?? "—",
    cagr,
    maxDrawdown: backtest.maxDrawdownPct,
    ruinProbability: risk?.ruinProbability ?? 0,
    jarvisSummary,
    marketState: radar?.marketState ?? "—",
    riskMode: radar?.riskMode ?? "—",
    heatScore: radar?.heatScore ?? 0,
    maxSector: sector?.maxHoldingSector?.sectorName ?? "—",
    sectorConcentration: sector?.maxHoldingSector?.portfolioWeight ?? 0,
  };
}

// ---- Repository ----
const KEY = "jarvis-trade-log:report-snapshots";
export type SnapshotInput = Omit<ReportSnapshot, "id" | "createdAt">;

export interface ReportSnapshotRepository {
  readonly name: string;
  list(): Promise<ReportSnapshot[]>;
  create(input: SnapshotInput): Promise<ReportSnapshot>;
  update(id: string, input: SnapshotInput): Promise<ReportSnapshot>;
  remove(id: string): Promise<void>;
}

class LocalRepo implements ReportSnapshotRepository {
  readonly name = "local-storage";
  private read(): ReportSnapshot[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(KEY);
      const p = raw ? JSON.parse(raw) : [];
      return Array.isArray(p) ? (p as ReportSnapshot[]) : [];
    } catch {
      return [];
    }
  }
  private write(list: ReportSnapshot[]) {
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(list));
  }
  private newId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  /** 新しい順（date 降順・同日 createdAt 降順）。 */
  async list() {
    return this.read().sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt.localeCompare(a.createdAt)));
  }
  async create(input: SnapshotInput) {
    const list = this.read();
    const snap: ReportSnapshot = { ...input, id: this.newId(), createdAt: new Date().toISOString() };
    list.push(snap);
    this.write(list);
    return snap;
  }
  async update(id: string, input: SnapshotInput) {
    const list = this.read();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) throw new Error(`スナップショットが見つかりません: ${id}`);
    const updated: ReportSnapshot = { ...input, id, createdAt: list[idx].createdAt };
    list[idx] = updated;
    this.write(list);
    return updated;
  }
  async remove(id: string) {
    this.write(this.read().filter((x) => x.id !== id));
  }
}

let instance: ReportSnapshotRepository | null = null;
export function getReportSnapshotRepository(): ReportSnapshotRepository {
  if (!instance) instance = new LocalRepo();
  return instance;
}

// ---- 比較 ----
export interface CompareRow {
  key: string;
  label: string;
  cur: string;
  prev: string;
  delta: string;
  dir: "up" | "down" | "flat";
  better: boolean | null; // true=改善, false=悪化, null=中立
}

const METRICS: { key: keyof ReportSnapshot; label: string; higherBetter: boolean | null; fmt: (n: number) => string }[] = [
  { key: "totalAssets", label: "総資産", higherBetter: true, fmt: (n) => `¥${n.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}` },
  { key: "totalPnl", label: "含み損益", higherBetter: true, fmt: yen },
  { key: "realizedPnl", label: "実現損益", higherBetter: true, fmt: yen },
  { key: "winRate", label: "勝率", higherBetter: true, fmt: (n) => `${(n * 100).toFixed(0)}%` },
  { key: "riskScore", label: "Risk Score", higherBetter: true, fmt: (n) => `${n}` },
  { key: "disciplineScore", label: "Discipline", higherBetter: true, fmt: (n) => `${n}` },
  { key: "mentalScore", label: "Mental", higherBetter: true, fmt: (n) => `${n}` },
  { key: "cagr", label: "CAGR", higherBetter: true, fmt: (n) => `${n.toFixed(1)}%` },
  { key: "maxDrawdown", label: "最大DD", higherBetter: false, fmt: (n) => `${n.toFixed(1)}%` },
  { key: "heatScore", label: "Heat Score", higherBetter: false, fmt: (n) => `${n.toFixed(0)}` },
  { key: "sectorConcentration", label: "セクター集中", higherBetter: false, fmt: (n) => `${(n * 100).toFixed(0)}%` },
];

export function compareSnapshots(cur: ReportSnapshot, prev: ReportSnapshot | null): CompareRow[] {
  return METRICS.map((m) => {
    const c = (cur[m.key] as number | undefined) ?? 0;
    const p = prev ? ((prev[m.key] as number | undefined) ?? 0) : c;
    const diff = c - p;
    const dir: CompareRow["dir"] = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    let better: boolean | null = null;
    if (m.higherBetter != null && diff !== 0) better = m.higherBetter ? diff > 0 : diff < 0;
    const deltaFmt = m.key === "winRate" ? `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(0)}pt` : `${diff >= 0 ? "+" : ""}${m.fmt(Math.abs(diff)).replace(/^¥/, diff < 0 ? "-¥" : "¥")}`;
    return {
      key: m.key,
      label: m.label,
      cur: m.fmt(c),
      prev: prev ? m.fmt(p) : "—",
      delta: prev ? deltaFmt : "—",
      dir,
      better,
    };
  });
}

export interface StateChangeRow {
  label: string;
  cur: string;
  prev: string;
  changed: boolean;
}

/** 文字列系（市況・戦略・セクター）の前回比。 */
export function compareSnapshotStates(cur: ReportSnapshot, prev: ReportSnapshot | null): StateChangeRow[] {
  const fields: { label: string; get: (s: ReportSnapshot) => string }[] = [
    { label: "Market State", get: (s) => s.marketState ?? "—" },
    { label: "Risk Mode", get: (s) => s.riskMode ?? "—" },
    { label: "最強Strategy", get: (s) => s.bestStrategy },
    { label: "最大セクター", get: (s) => s.maxSector ?? "—" },
  ];
  return fields.map((f) => ({
    label: f.label,
    cur: f.get(cur),
    prev: prev ? f.get(prev) : "—",
    changed: prev ? f.get(cur) !== f.get(prev) : false,
  }));
}

export function compareComments(cur: ReportSnapshot, prev: ReportSnapshot | null): string[] {
  if (!prev) return ["前回スナップショットがありません。継続保存で推移が比較できます、ボス。"];
  const out: string[] = [];
  if (cur.riskScore > prev.riskScore) out.push("前回比で Risk Score は改善しています。");
  else if (cur.riskScore < prev.riskScore) out.push("前回比で Risk Score が低下しています。リスク要因を確認してください。");
  if (cur.winRate > prev.winRate && cur.maxDrawdown > prev.maxDrawdown)
    out.push("勝率は上昇していますが、最大DDも拡大しています。攻撃性が上がっている可能性があります。");
  if (cur.mentalScore < prev.mentalScore)
    out.push("Mental Scoreが低下しています。直近の取引判断に焦りが混じっている可能性があります。");
  if (cur.realizedPnl > prev.realizedPnl) out.push(`実現損益は ${yen(cur.realizedPnl - prev.realizedPnl)} 増加しています。`);
  if (out.length === 0) out.push("前回から大きな変化はありません。安定した運用状態です、ボス。");
  return out;
}
