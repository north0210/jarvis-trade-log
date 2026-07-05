/**
 * 通知サービス（Phase 45/46・ブラウザ Notification API のみ）。
 * 許可がない/未対応でもアプリは壊れない（安全に no-op）。同一通知は同日1回まで。
 * Phase 46: 送信イベントを履歴レコードとして記録（既読管理・保持期間クリーンアップ）。
 */
import type { VolumeAlert } from "@/lib/alerts/volume-alerts";
import { K } from "@/lib/storage/keys";

const SETTINGS_KEY = K.notificationSettings;
// 注意: 履歴キーの refName は "notifications"（backupKey 由来）。notification-history に対応する。
const HISTORY_KEY = K.notifications;
const RETENTION_KEY = K.notificationRetention;

export type NotificationType = "report" | "discipline" | "volume" | "risk" | "system";
export type NotificationLevel = "info" | "warning" | "danger";
export type RetentionPolicy = "7" | "30" | "90" | "none";

export interface NotificationSettings {
  enabled: boolean;
  report: boolean;
  discipline: boolean;
  volume: boolean;
  risk: boolean;
}
const DEFAULTS: NotificationSettings = { enabled: false, report: true, discipline: true, volume: true, risk: true };

export interface NotificationRecord {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  body: string;
  type: NotificationType;
  level: NotificationLevel;
  source: string;
  read: boolean;
  createdAt: string;
}

export function getNotificationSettings(): NotificationSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : false,
      report: p.report !== false,
      discipline: p.discipline !== false,
      volume: p.volume !== false,
      risk: p.risk !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setNotificationSettings(patch: Partial<NotificationSettings>): NotificationSettings {
  const merged = { ...getNotificationSettings(), ...patch };
  if (typeof window !== "undefined") window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

export function getRetentionPolicy(): RetentionPolicy {
  if (typeof window === "undefined") return "30";
  const v = window.localStorage.getItem(RETENTION_KEY);
  return v === "7" || v === "30" || v === "90" || v === "none" ? v : "30";
}
export function setRetentionPolicy(p: RetentionPolicy): void {
  if (typeof window !== "undefined") window.localStorage.setItem(RETENTION_KEY, p);
}

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

export function permissionState(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as PermissionState;
}

export async function requestPermission(): Promise<PermissionState> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  try {
    return (await Notification.requestPermission()) as PermissionState;
  } catch {
    return permissionState();
  }
}

/** ブラウザ通知を実際に表示できるか（設定ON＋許可granted）。 */
export function canNotify(): boolean {
  return getNotificationSettings().enabled && permissionState() === "granted";
}

// ---- 履歴 ----
interface History {
  sent: Record<string, string>; // dedupKey -> YYYY-MM-DD
  last: { title: string; body: string; at: string } | null;
  records: NotificationRecord[];
}
const todayStr = () => new Date().toISOString().slice(0, 10);
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function readHistory(): History {
  if (typeof window === "undefined") return { sent: {}, last: null, records: [] };
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<History>) : {};
    return { sent: p.sent ?? {}, last: p.last ?? null, records: Array.isArray(p.records) ? p.records : [] };
  } catch {
    return { sent: {}, last: null, records: [] };
  }
}
function writeHistory(h: History) {
  if (typeof window !== "undefined") window.localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}

export function getLastNotification(): { title: string; body: string; at: string } | null {
  return readHistory().last;
}

/** 保持期間より古いレコード・sent を削除し、削除件数を返す。 */
export function cleanupNotifications(): number {
  const policy = getRetentionPolicy();
  if (policy === "none") return 0;
  const days = Number(policy);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const h = readHistory();
  const before = h.records.length;
  h.records = h.records.filter((r) => r.date >= cutoff);
  for (const k of Object.keys(h.sent)) if (h.sent[k] < cutoff) delete h.sent[k];
  writeHistory(h);
  return before - h.records.length;
}

export function getNotifications(): NotificationRecord[] {
  return readHistory().records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function unreadCount(): number {
  return readHistory().records.filter((r) => !r.read).length;
}
export function markRead(id: string): void {
  const h = readHistory();
  const r = h.records.find((x) => x.id === id);
  if (r) r.read = true;
  writeHistory(h);
}
export function markAllRead(): void {
  const h = readHistory();
  h.records.forEach((r) => (r.read = true));
  writeHistory(h);
}
export function removeNotification(id: string): void {
  const h = readHistory();
  h.records = h.records.filter((x) => x.id !== id);
  writeHistory(h);
}
export function clearNotifications(): void {
  const h = readHistory();
  h.records = [];
  writeHistory(h);
}

/**
 * 通知（設定ON時のみ記録・同日同一 dedupKey は抑制）。
 * 許可があればブラウザ通知も表示。記録は許可有無に関わらず残す。
 */
export function notify(
  title: string,
  body: string,
  dedupKey: string,
  type: NotificationType,
  level: NotificationLevel,
  source = "system"
): boolean {
  if (!getNotificationSettings().enabled) return false;
  const h = readHistory();
  const today = todayStr();
  if (h.sent[dedupKey] === today) return false; // 同日重複
  if (permissionState() === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      /* 表示不可でも記録は残す */
    }
  }
  const now = new Date().toISOString();
  h.sent[dedupKey] = today;
  h.records.unshift({ id: newId(), date: today, title, body, type, level, source, read: false, createdAt: now });
  h.last = { title, body, at: now };
  writeHistory(h);
  return true;
}

// ---- 種別ごとの通知 ----
export function notifyReportSaved(): boolean {
  if (!getNotificationSettings().report) return false;
  return notify("JARVIS レポート保存", "本日のレポートスナップショットを自動保存しました。", `report:${todayStr()}`, "report", "info", "auto-report");
}
export function notifyDisciplineWarning(count: number): boolean {
  if (!getNotificationSettings().discipline || count <= 0) return false;
  return notify("JARVIS 規律違反", `重大な規律違反が ${count} 件検出されています。損切りルールの遵守を優先してください。`, `discipline:${todayStr()}`, "discipline", "danger", "discipline");
}
export function notifyVolumeAlert(alert: VolumeAlert): boolean {
  if (!getNotificationSettings().volume || alert.level !== "danger") return false;
  return notify(`JARVIS 出来高アラート: ${alert.stockName}`, alert.message, `volume:${alert.type}:${alert.stockCode}:${todayStr()}`, "volume", "danger", "volume");
}
export function notifyRiskWarning(kind: string, message: string): boolean {
  if (!getNotificationSettings().risk) return false;
  return notify("JARVIS リスク警告", message, `risk:${kind}:${todayStr()}`, "risk", "danger", "risk");
}
