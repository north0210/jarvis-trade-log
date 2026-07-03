/**
 * 運用日誌データ永続化層（分離設計）
 *
 * 現在は LocalStorageJournalRepository（ブラウザ localStorage に保存）。
 * 将来 Supabase や外部APIに戻す場合は、この JournalRepository を
 * 実装したクラスを追加し、getJournalRepository() の返り値を
 * 差し替えるだけでよい。UI は変更不要。
 *
 * （src/lib/storage/stockRepository.ts / holdingRepository.ts と同じ思想）
 */
import type { Journal } from "@/lib/types";
import { STORAGE_KEYS } from "./keys";

/** 新規登録・更新時の入力。id と各タイムスタンプはリポジトリ側で管理する。 */
export type JournalInput = Omit<Journal, "id" | "createdAt" | "updatedAt">;

export interface JournalRepository {
  readonly name: string;
  /** 全日誌を最新順（date 降順・同日は createdAt 降順）で返す。 */
  list(): Promise<Journal[]>;
  /** 日誌を新規登録し、採番済みの Journal を返す。 */
  create(input: JournalInput): Promise<Journal>;
  /** 指定 id の日誌を更新（createdAt は保持・updatedAt は更新）。 */
  update(id: string, input: JournalInput): Promise<Journal>;
  /** 指定 id の日誌を削除する。 */
  remove(id: string): Promise<void>;
}

const STORAGE_KEY = STORAGE_KEYS.journal;

/** localStorage 運用: ブラウザ内に JSON 配列として日誌を保持する。 */
export class LocalStorageJournalRepository implements JournalRepository {
  readonly name = "local-storage";

  private read(): Journal[] {
    if (typeof window === "undefined") return []; // SSR 安全
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Journal[]) : [];
    } catch {
      return [];
    }
  }

  private write(journals: Journal[]): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(journals));
  }

  private sortLatest(journals: Journal[]): Journal[] {
    return [...journals].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }

  private newId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async list(): Promise<Journal[]> {
    return this.sortLatest(this.read());
  }

  async create(input: JournalInput): Promise<Journal> {
    const journals = this.read();
    const now = new Date().toISOString();
    const journal: Journal = { ...input, id: this.newId(), createdAt: now, updatedAt: now };
    journals.push(journal);
    this.write(journals);
    return journal;
  }

  async update(id: string, input: JournalInput): Promise<Journal> {
    const journals = this.read();
    const idx = journals.findIndex((j) => j.id === id);
    if (idx === -1) throw new Error(`日誌が見つかりません: ${id}`);
    const updated: Journal = {
      ...input,
      id,
      createdAt: journals[idx].createdAt, // 作成日時は保持
      updatedAt: new Date().toISOString(),
    };
    journals[idx] = updated;
    this.write(journals);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const journals = this.read().filter((j) => j.id !== id);
    this.write(journals);
  }
}

let instance: JournalRepository | null = null;

/** アプリ全体で共有する日誌リポジトリを返す。 */
export function getJournalRepository(): JournalRepository {
  if (!instance) instance = new LocalStorageJournalRepository();
  return instance;
}
