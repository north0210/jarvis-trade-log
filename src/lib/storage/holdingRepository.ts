/**
 * 保有株データ永続化層（分離設計）
 *
 * 現在は LocalStorageHoldingRepository（ブラウザ localStorage に保存）。
 * 将来 Supabase や外部APIに戻す場合は、この HoldingRepository を
 * 実装したクラスを追加し、getHoldingRepository() の返り値を
 * 差し替えるだけでよい。UI・アラート・集計ロジックは変更不要。
 *
 * （src/lib/storage/stockRepository.ts と同じ思想）
 */
import type { Holding } from "@/lib/types";
import { STORAGE_KEYS } from "./keys";

/** 新規登録・更新時の入力。id と join 済み stocks は含めない。 */
export type HoldingInput = Omit<Holding, "id" | "stocks">;

export interface HoldingRepository {
  readonly name: string;
  /** 全保有株を登録順で返す（join は呼び出し側で行う）。 */
  list(): Promise<Holding[]>;
  /** 保有株を新規登録し、採番済みの Holding を返す。 */
  create(input: HoldingInput): Promise<Holding>;
  /** 指定 id の保有株を更新し、更新後の Holding を返す。 */
  update(id: string, input: HoldingInput): Promise<Holding>;
  /** 指定 id の保有株を削除する。 */
  remove(id: string): Promise<void>;
}

const STORAGE_KEY = STORAGE_KEYS.holdings;

/** localStorage 運用: ブラウザ内に JSON 配列として保有株を保持する。 */
export class LocalStorageHoldingRepository implements HoldingRepository {
  readonly name = "local-storage";

  private read(): Holding[] {
    if (typeof window === "undefined") return []; // SSR 安全
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Holding[]) : [];
    } catch {
      return [];
    }
  }

  private write(holdings: Holding[]): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
  }

  private newId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async list(): Promise<Holding[]> {
    return this.read();
  }

  async create(input: HoldingInput): Promise<Holding> {
    const holdings = this.read();
    // 取得日時を自動スタンプ（保有期間の算出に使用。既指定があれば尊重）
    const holding: Holding = {
      ...input,
      id: this.newId(),
      created_at: input.created_at ?? new Date().toISOString(),
    };
    holdings.push(holding);
    this.write(holdings);
    return holding;
  }

  async update(id: string, input: HoldingInput): Promise<Holding> {
    const holdings = this.read();
    const idx = holdings.findIndex((h) => h.id === id);
    if (idx === -1) throw new Error(`保有株が見つかりません: ${id}`);
    const updated: Holding = { ...input, id };
    holdings[idx] = updated;
    this.write(holdings);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const holdings = this.read().filter((h) => h.id !== id);
    this.write(holdings);
  }
}

let instance: HoldingRepository | null = null;

/** アプリ全体で共有する保有株リポジトリを返す。 */
export function getHoldingRepository(): HoldingRepository {
  if (!instance) instance = new LocalStorageHoldingRepository();
  return instance;
}
