/**
 * 銘柄データ永続化層（分離設計）
 *
 * 現在は LocalStorageStockRepository（ブラウザ localStorage に保存）。
 * 将来 Supabase や株価API に戻す場合は、この StockRepository を
 * 実装したクラス（例: SupabaseStockRepository）を追加し、
 * getStockRepository() の返り値を差し替えるだけでよい。
 * UI・アラート・集計ロジックは一切変更不要。
 *
 * （src/lib/pricing/provider.ts と同じ思想）
 */
import type { Stock } from "@/lib/types";
import { STORAGE_KEYS } from "./keys";

/** 新規登録・更新時の入力。id はリポジトリ側で採番するため受け取らない。 */
export type StockInput = Omit<Stock, "id">;

export interface StockRepository {
  readonly name: string;
  /** 全銘柄をコード順で返す。 */
  list(): Promise<Stock[]>;
  /** 銘柄を新規登録し、採番済みの Stock を返す。 */
  create(input: StockInput): Promise<Stock>;
  /** 指定 id の銘柄を更新し、更新後の Stock を返す。 */
  update(id: string, input: StockInput): Promise<Stock>;
  /** 指定 id の銘柄を削除する。 */
  remove(id: string): Promise<void>;
}

const STORAGE_KEY = STORAGE_KEYS.stocks;

/** localStorage 運用: ブラウザ内に JSON 配列として銘柄を保持する。 */
export class LocalStorageStockRepository implements StockRepository {
  readonly name = "local-storage";

  private read(): Stock[] {
    if (typeof window === "undefined") return []; // SSR 安全
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Stock[]) : [];
    } catch {
      return [];
    }
  }

  private write(stocks: Stock[]): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stocks));
  }

  private sortByCode(stocks: Stock[]): Stock[] {
    return [...stocks].sort((a, b) => a.code.localeCompare(b.code, "ja"));
  }

  private newId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    // フォールバック（古い環境向け）
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async list(): Promise<Stock[]> {
    return this.sortByCode(this.read());
  }

  async create(input: StockInput): Promise<Stock> {
    const stocks = this.read();
    const stock: Stock = { ...input, id: this.newId() };
    stocks.push(stock);
    this.write(stocks);
    return stock;
  }

  async update(id: string, input: StockInput): Promise<Stock> {
    const stocks = this.read();
    const idx = stocks.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`銘柄が見つかりません: ${id}`);
    const updated: Stock = { ...input, id };
    stocks[idx] = updated;
    this.write(stocks);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const stocks = this.read().filter((s) => s.id !== id);
    this.write(stocks);
  }
}

let instance: StockRepository | null = null;

/** アプリ全体で共有する銘柄リポジトリを返す。 */
export function getStockRepository(): StockRepository {
  // API/Supabase 接続時: return new SupabaseStockRepository(...) 等に差し替え
  if (!instance) instance = new LocalStorageStockRepository();
  return instance;
}
