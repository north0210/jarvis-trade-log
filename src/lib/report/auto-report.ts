/**
 * レポート自動保存（Phase 41・完全ローカル）。
 * アプリ起動中に日次/週次/月次でレポートスナップショットを自動保存する。
 * 同一期間の重複保存は防止。Phase 12 の自動更新パターンを踏襲。
 */
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getJournalRepository } from "@/lib/storage/journalRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import { getCashPosition } from "@/lib/analysis/portfolio";
import { computeSnapshotFields, getReportSnapshotRepository } from "./snapshot";
import { notifyReportSaved } from "@/lib/notifications/notification-service";
import { K } from "@/lib/storage/keys";

export type ReportFrequency = "daily" | "weekly" | "monthly";

export interface AutoReportSettings {
  enabled: boolean;
  frequency: ReportFrequency;
  lastSavedAt: string | null;
  lastSavedPeriod: string | null;
}

const KEY = K.autoReportSettings;
const DEFAULTS: AutoReportSettings = { enabled: false, frequency: "daily", lastSavedAt: null, lastSavedPeriod: null };

export function getAutoReportSettings(): AutoReportSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<AutoReportSettings>;
    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : false,
      frequency: p.frequency === "weekly" || p.frequency === "monthly" ? p.frequency : "daily",
      lastSavedAt: typeof p.lastSavedAt === "string" ? p.lastSavedAt : null,
      lastSavedPeriod: typeof p.lastSavedPeriod === "string" ? p.lastSavedPeriod : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setAutoReportSettings(patch: Partial<AutoReportSettings>): AutoReportSettings {
  const merged = { ...getAutoReportSettings(), ...patch };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

/** 日付文字列(YYYY-MM-DD)を頻度に応じた期間キーへ変換。 */
export function periodKey(dateStr: string, freq: ReportFrequency): string {
  if (freq === "daily") return dateStr;
  if (freq === "monthly") return dateStr.slice(0, 7);
  // weekly: ISO週番号
  const d = new Date(dateStr + "T00:00:00Z");
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const todayStr = () => new Date().toISOString().slice(0, 10);
let running = false;

/** 現在の頻度で保存すべきか（同一期間の既存スナップショットが無いか）を判定。 */
export async function shouldAutoSave(): Promise<boolean> {
  const s = getAutoReportSettings();
  if (!s.enabled) return false;
  const key = periodKey(todayStr(), s.frequency);
  if (s.lastSavedPeriod === key) return false;
  const existing = await getReportSnapshotRepository().list();
  return !existing.some((x) => periodKey(x.date, s.frequency) === key);
}

const freqLabel: Record<ReportFrequency, string> = { daily: "本日", weekly: "今週", monthly: "今月" };

/** 判定して必要なら自動保存する。多重実行防止・エラー時 fallback。 */
export async function runAutoReportSave(): Promise<{ saved: boolean; message: string }> {
  const s = getAutoReportSettings();
  if (!s.enabled) return { saved: false, message: "自動保存は無効です。" };
  if (running) return { saved: false, message: "実行中です。" };
  if (!(await shouldAutoSave())) return { saved: false, message: `${freqLabel[s.frequency]}分はすでに保存済みです。` };

  running = true;
  try {
    const [stocks, holdings, journals, trades] = await Promise.all([
      getStockRepository().list(),
      getHoldingRepository().list(),
      getJournalRepository().list(),
      getTradeRepository().list(),
    ]);
    const strategies = await ensureSeeded();
    const fields = computeSnapshotFields(stocks, holdings, journals, trades, strategies, getCashPosition());
    await getReportSnapshotRepository().create({
      date: todayStr(),
      period: s.frequency,
      ...fields,
      source: "auto",
    });
    setAutoReportSettings({ lastSavedAt: new Date().toISOString(), lastSavedPeriod: periodKey(todayStr(), s.frequency) });
    notifyReportSaved();
    return { saved: true, message: `${freqLabel[s.frequency]}のレポートスナップショットを保存しました。` };
  } catch {
    return { saved: false, message: "自動保存に失敗しました。" };
  } finally {
    running = false;
  }
}

/** 次回保存の目安（現在の期間が保存済みなら翌期間）。 */
export function nextDueLabel(): string {
  const s = getAutoReportSettings();
  if (!s.enabled) return "—";
  const map: Record<ReportFrequency, string> = { daily: "翌日", weekly: "翌週", monthly: "翌月" };
  const key = periodKey(todayStr(), s.frequency);
  return s.lastSavedPeriod === key ? `${map[s.frequency]}（今期間は保存済み）` : "まもなく（今期間未保存）";
}
