/**
 * 売買戦略テンプレート永続化層。
 *   localStorage key: jarvis-trade-log:strategies
 * 初回は初期テンプレートを投入する（ensureSeeded）。
 */
import type { Strategy } from "@/lib/types";
import { STORAGE_KEYS } from "./keys";

export type StrategyInput = Omit<Strategy, "id" | "createdAt">;

export interface StrategyRepository {
  readonly name: string;
  list(): Promise<Strategy[]>;
  create(input: StrategyInput): Promise<Strategy>;
  update(id: string, input: StrategyInput): Promise<Strategy>;
  remove(id: string): Promise<void>;
}

const STORAGE_KEY = STORAGE_KEYS.strategies;
const PRIMARY_KEY = "jarvis-trade-log:primary-strategy";

/** 初期テンプレート（数値 null = 判定しない）。 */
const SEED: StrategyInput[] = [
  {
    name: "成長株スイング",
    description: "高成長・高収益銘柄をRSI70以下で押し目/ブレイク。損切り必須。",
    minScore: 80,
    allowedGrades: ["S", "A"],
    maxRsi: 70,
    minRoe: 15,
    minOperatingMargin: 10,
    minSalesGrowth: 20,
    maxPer: null,
    maxPbr: null,
    requiresStopLoss: true,
    maxPositionRate: null,
    targetProfitRate: 20,
    maxLossRate: 8,
  },
  {
    name: "押し目待ち",
    description: "Score70以上・RSI40〜65の押し目。25日線付近想定。損切り必須。（RSI下限40は目安）",
    minScore: 70,
    allowedGrades: [],
    maxRsi: 65,
    minRoe: null,
    minOperatingMargin: null,
    minSalesGrowth: null,
    maxPer: null,
    maxPbr: null,
    requiresStopLoss: true,
    maxPositionRate: null,
    targetProfitRate: 15,
    maxLossRate: 5,
  },
  {
    name: "高成長AIテーマ",
    description: "売上成長30%以上・ROE20%以上・営業利益率15%以上・PER60以下・RSI75以下。",
    minScore: null,
    allowedGrades: [],
    maxRsi: 75,
    minRoe: 20,
    minOperatingMargin: 15,
    minSalesGrowth: 30,
    maxPer: 60,
    maxPbr: null,
    requiresStopLoss: false,
    maxPositionRate: null,
    targetProfitRate: 30,
    maxLossRate: 10,
  },
  {
    name: "低リスク監視",
    description: "Score65以上・GradeB以上・RSI70以下・1銘柄比率20%以下。",
    minScore: 65,
    allowedGrades: ["S", "A", "B"],
    maxRsi: 70,
    minRoe: null,
    minOperatingMargin: null,
    minSalesGrowth: null,
    maxPer: null,
    maxPbr: null,
    requiresStopLoss: false,
    maxPositionRate: 20,
    targetProfitRate: 15,
    maxLossRate: 5,
  },
  {
    name: "見送り条件",
    description: "回避対象の型。Grade C以下（RSI80以上/PER80以上/損切り未設定も回避目安）。適合=回避推奨。",
    minScore: null,
    allowedGrades: ["C", "D"],
    maxRsi: null,
    minRoe: null,
    minOperatingMargin: null,
    minSalesGrowth: null,
    maxPer: null,
    maxPbr: null,
    requiresStopLoss: false,
    maxPositionRate: null,
    targetProfitRate: null,
    maxLossRate: null,
  },
];

export class LocalStorageStrategyRepository implements StrategyRepository {
  readonly name = "local-storage";

  private read(): Strategy[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as Strategy[]) : [];
    } catch {
      return [];
    }
  }

  private write(list: Strategy[]): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  private newId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async list(): Promise<Strategy[]> {
    return this.read();
  }

  async create(input: StrategyInput): Promise<Strategy> {
    const list = this.read();
    const strategy: Strategy = { ...input, id: this.newId(), createdAt: new Date().toISOString() };
    list.push(strategy);
    this.write(list);
    return strategy;
  }

  async update(id: string, input: StrategyInput): Promise<Strategy> {
    const list = this.read();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`戦略が見つかりません: ${id}`);
    const updated: Strategy = { ...input, id, createdAt: list[idx].createdAt };
    list[idx] = updated;
    this.write(list);
    return updated;
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((s) => s.id !== id));
  }
}

let instance: StrategyRepository | null = null;

export function getStrategyRepository(): StrategyRepository {
  if (!instance) instance = new LocalStorageStrategyRepository();
  return instance;
}

/** 未投入なら初期テンプレートを作成し、全戦略を返す。 */
export async function ensureSeeded(): Promise<Strategy[]> {
  const repo = getStrategyRepository();
  let list = await repo.list();
  if (list.length === 0) {
    for (const s of SEED) await repo.create(s);
    list = await repo.list();
  }
  return list;
}

/** 主戦略（Dashboard 用）の取得・設定。 */
export function getPrimaryStrategyId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PRIMARY_KEY);
}

export function setPrimaryStrategyId(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PRIMARY_KEY, id);
}
