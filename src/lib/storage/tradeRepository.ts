/**
 * 取引履歴（確定売買）永続化層。
 * 保有株の売却時に Trade を記録する。stock/holding/journal と同一思想。
 *   localStorage key: jarvis-trade-log:trades
 */
import type { Trade } from "@/lib/types";
import { STORAGE_KEYS } from "./keys";

/** 新規登録時の入力。id と createdAt はリポジトリ側で採番。 */
export type TradeInput = Omit<Trade, "id" | "createdAt">;

export interface TradeRepository {
  readonly name: string;
  list(): Promise<Trade[]>;
  create(input: TradeInput): Promise<Trade>;
  update(id: string, input: TradeInput): Promise<Trade>;
  remove(id: string): Promise<void>;
}

const STORAGE_KEY = STORAGE_KEYS.trades;

export class LocalStorageTradeRepository implements TradeRepository {
  readonly name = "local-storage";

  private read(): Trade[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as Trade[]) : [];
    } catch {
      return [];
    }
  }

  private write(trades: Trade[]): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  }

  private newId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  /** 売却日の新しい順（同日は createdAt 降順）で返す。 */
  async list(): Promise<Trade[]> {
    return this.read().sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }

  async create(input: TradeInput): Promise<Trade> {
    const trades = this.read();
    const trade: Trade = { ...input, id: this.newId(), createdAt: new Date().toISOString() };
    trades.push(trade);
    this.write(trades);
    return trade;
  }

  async update(id: string, input: TradeInput): Promise<Trade> {
    const trades = this.read();
    const idx = trades.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`取引が見つかりません: ${id}`);
    const updated: Trade = { ...input, id, createdAt: trades[idx].createdAt };
    trades[idx] = updated;
    this.write(trades);
    return updated;
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((t) => t.id !== id));
  }
}

let instance: TradeRepository | null = null;

export function getTradeRepository(): TradeRepository {
  if (!instance) instance = new LocalStorageTradeRepository();
  return instance;
}
