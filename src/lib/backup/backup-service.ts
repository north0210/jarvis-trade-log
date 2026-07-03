/**
 * Phase 52: バックアップ／復元サービス（完全ローカル）。
 * localStorage の主要ユーザーデータを1つのエンベロープに集約し、
 * 世代管理・破損検知（checksum）・部分復元・比較を提供する。
 *
 * 既存 exportService/importService（v1・Settings用）は温存し、本サービスは
 * より広範な v2 "full" エンベロープを扱う（v1 レガシーも読み込み可）。
 * 認証情報・価格キャッシュ等の機微/一時データはバックアップ対象外（安全側）。
 */

const APP = "jarvis-trade-log";
export const FULL_VERSION = 2;
const GENERATIONS_KEY = "jarvis-trade-log:backup-generations";
const LAST_BACKUP_KEY = "jarvis-trade-log:lastBackup";
const MAX_GENERATIONS = 3;

export type BackupItemKind = "array" | "value";
export type RestoreUnit =
  | "stocks"
  | "holdings"
  | "journal"
  | "trades"
  | "strategies"
  | "reports"
  | "notifications"
  | "settings";

export interface BackupItemDef {
  key: string; // エンベロープ内キー
  label: string; // 表示名
  storageKey: string; // localStorage キー
  kind: BackupItemKind;
  unit: RestoreUnit; // 部分復元の単位
}

export const UNIT_LABELS: Record<RestoreUnit, string> = {
  stocks: "銘柄",
  holdings: "保有株",
  journal: "運用日誌",
  trades: "取引履歴",
  strategies: "戦略",
  reports: "レポート",
  notifications: "通知",
  settings: "設定",
};

export const BACKUP_ITEMS: BackupItemDef[] = [
  { key: "stocks", label: "銘柄", storageKey: "jarvis-trade-log:stocks", kind: "array", unit: "stocks" },
  { key: "holdings", label: "保有株", storageKey: "jarvis-trade-log:holdings", kind: "array", unit: "holdings" },
  { key: "journal", label: "運用日誌", storageKey: "jarvis-trade-log:journal", kind: "array", unit: "journal" },
  { key: "trades", label: "取引履歴", storageKey: "jarvis-trade-log:trades", kind: "array", unit: "trades" },
  { key: "simulations", label: "試算結果", storageKey: "jarvis-trade-log:simulations", kind: "array", unit: "trades" },
  { key: "strategies", label: "戦略テンプレート", storageKey: "jarvis-trade-log:strategies", kind: "array", unit: "strategies" },
  { key: "ruleImprovements", label: "ルール改善", storageKey: "jarvis-trade-log:rule-improvements", kind: "array", unit: "strategies" },
  { key: "reportSnapshots", label: "レポートスナップショット", storageKey: "jarvis-trade-log:report-snapshots", kind: "array", unit: "reports" },
  { key: "strategyRankingSnapshots", label: "戦略ランキング履歴", storageKey: "jarvis-trade-log:strategy-ranking-snapshots", kind: "array", unit: "reports" },
  { key: "notifications", label: "通知履歴", storageKey: "jarvis-trade-log:notification-history", kind: "value", unit: "notifications" },
  { key: "notificationSettings", label: "通知設定", storageKey: "jarvis-trade-log:notification-settings", kind: "value", unit: "notifications" },
  { key: "notificationRetention", label: "通知保持期間", storageKey: "jarvis-trade-log:notification-retention", kind: "value", unit: "notifications" },
  { key: "settings", label: "基本設定", storageKey: "jarvis-trade-log:settings", kind: "value", unit: "settings" },
  { key: "thresholdSettings", label: "通知しきい値", storageKey: "jarvis-trade-log:threshold-settings", kind: "value", unit: "settings" },
  { key: "adaptiveScoreSettings", label: "適応スコア設定", storageKey: "jarvis-trade-log:adaptive-score-settings", kind: "value", unit: "settings" },
  { key: "autoReportSettings", label: "レポート自動保存設定", storageKey: "jarvis-trade-log:auto-report-settings", kind: "value", unit: "settings" },
  { key: "aiCommentSettings", label: "AIコメント設定", storageKey: "jarvis-trade-log:ai-comment-settings", kind: "value", unit: "settings" },
  { key: "autoUpdateSettings", label: "自動更新設定", storageKey: "jarvis-trade-log:auto-update-settings", kind: "value", unit: "settings" },
  { key: "cashPosition", label: "現金ポジション", storageKey: "jarvis-trade-log:cash-position", kind: "value", unit: "settings" },
  { key: "primaryStrategy", label: "主戦略", storageKey: "jarvis-trade-log:primary-strategy", kind: "value", unit: "settings" },
  { key: "tvEnabled", label: "TradingView表示", storageKey: "jarvis-trade-log:tv-enabled", kind: "value", unit: "settings" },
];

const ITEM_BY_KEY: Record<string, BackupItemDef> = BACKUP_ITEMS.reduce(
  (acc, it) => {
    acc[it.key] = it;
    return acc;
  },
  {} as Record<string, BackupItemDef>
);

export interface FullBackup {
  app: string;
  version: number;
  format: "full";
  exportedAt: string;
  checksum: string;
  items: Record<string, unknown>;
}

// ---- 低レベル I/O ----
function readRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}
function readItemValue(def: BackupItemDef): unknown {
  const raw = readRaw(def.storageKey);
  if (raw == null) return def.kind === "array" ? [] : null;
  try {
    const parsed = JSON.parse(raw);
    if (def.kind === "array") return Array.isArray(parsed) ? parsed : [];
    return parsed;
  } catch {
    return def.kind === "array" ? [] : null;
  }
}

/** FNV-1a 32bit ハッシュ（16進）。crypto 非依存の決定的 checksum。 */
export function generateChecksum(items: Record<string, unknown>): string {
  const str = JSON.stringify(items);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 現在の localStorage からフルバックアップを構築（ダウンロード・退避の共通元）。 */
export function createBackup(exportedAt: string): FullBackup {
  const items: Record<string, unknown> = {};
  for (const def of BACKUP_ITEMS) {
    const v = readItemValue(def);
    // 空の value（null）や空配列でもキーは残す（一覧の一貫性のため）
    items[def.key] = v;
  }
  return {
    app: APP,
    version: FULL_VERSION,
    format: "full",
    exportedAt,
    checksum: generateChecksum(items),
    items,
  };
}

// ---- 破損検知 / 検証 ----
export interface AvailableItem {
  key: string;
  label: string;
  unit: RestoreUnit;
  kind: BackupItemKind;
  count: number | null; // array のとき件数、value のとき null
  present: boolean; // バックアップに含まれるか
}

export interface ValidationResult {
  ok: boolean;
  legacy: boolean; // v1 (data.*) 形式
  version: number | null;
  checksumOk: boolean | null; // v2 のみ判定、legacy は null
  errors: string[];
  warnings: string[];
  backup: FullBackup | null; // 正規化済み（legacy は full へ変換）
  available: AvailableItem[];
}

/** v1 レガシーエンベロープを full 形式へ正規化。 */
function normalizeLegacy(obj: Record<string, unknown>): FullBackup | null {
  const data = obj.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return null;
  const items: Record<string, unknown> = {};
  if (Array.isArray(data.stocks)) items.stocks = data.stocks;
  if (Array.isArray(data.holdings)) items.holdings = data.holdings;
  if (Array.isArray(data.journal)) items.journal = data.journal;
  if (data.settings != null) items.settings = data.settings;
  return {
    app: APP,
    version: typeof obj.version === "number" ? obj.version : 1,
    format: "full",
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : "",
    checksum: "",
    items,
  };
}

function buildAvailable(items: Record<string, unknown>): AvailableItem[] {
  return BACKUP_ITEMS.map((def) => {
    const present = Object.prototype.hasOwnProperty.call(items, def.key);
    const v = items[def.key];
    const count = def.kind === "array" ? (Array.isArray(v) ? v.length : 0) : null;
    return { key: def.key, label: def.label, unit: def.unit, kind: def.kind, count, present };
  });
}

/** JSON テキスト or オブジェクトを検証し、復元可能項目を返す（破損検知）。 */
export function validateBackup(input: string | unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      return { ok: false, legacy: false, version: null, checksumOk: null, errors: ["JSONとして読み込めませんでした。ファイル形式を確認してください。"], warnings: [], backup: null, available: [] };
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, legacy: false, version: null, checksumOk: null, errors: ["バックアップ形式が不正です（オブジェクトではありません）。"], warnings: [], backup: null, available: [] };
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.app !== APP) {
    errors.push(`このアプリのバックアップではありません（app: ${String(obj.app)}）。`);
  }
  const version = typeof obj.version === "number" ? obj.version : null;
  if (version == null) errors.push("バージョン情報がありません。");
  if (version != null && version > FULL_VERSION) {
    errors.push(`新しいバージョンのバックアップです（v${version}）。アプリを更新してください。`);
  }

  const isFull = obj.format === "full" && typeof obj.items === "object" && obj.items !== null;
  const legacy = !isFull && typeof obj.data === "object" && obj.data !== null;

  let backup: FullBackup | null = null;
  let checksumOk: boolean | null = null;

  if (isFull) {
    const items = obj.items as Record<string, unknown>;
    const expected = typeof obj.checksum === "string" ? obj.checksum : "";
    const actual = generateChecksum(items);
    checksumOk = expected.length > 0 ? expected === actual : null;
    if (checksumOk === false) errors.push("checksum が一致しません。ファイルが破損している可能性があります。");
    else if (checksumOk === null) warnings.push("checksum が記録されていません（旧形式の可能性）。内容を確認して復元してください。");
    backup = { app: APP, version: version ?? FULL_VERSION, format: "full", exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : "", checksum: expected, items };
  } else if (legacy) {
    warnings.push("旧形式（v1）のバックアップです。銘柄/保有株/運用日誌/設定のみ復元できます。");
    backup = normalizeLegacy(obj);
    if (!backup) errors.push("data フィールドの構造が不正です。");
  } else {
    errors.push("items も data も見つかりません。復元可能なデータがありません。");
  }

  const available = backup ? buildAvailable(backup.items) : [];
  const anyPresent = available.some((a) => a.present);
  const ok = errors.length === 0 && backup !== null && anyPresent;

  return { ok, legacy, version, checksumOk, errors, warnings, backup, available };
}

/** バックアップに含まれる項目の一覧（件数付き）。 */
export function listBackupItems(backup: FullBackup): AvailableItem[] {
  return buildAvailable(backup.items).filter((a) => a.present);
}

// ---- 復元 ----
export interface RestoreSummary {
  restored: { key: string; label: string; count: number | null }[];
  skipped: string[];
}

function writeItem(def: BackupItemDef, value: unknown): void {
  if (typeof window === "undefined") return;
  if (def.kind === "array") {
    window.localStorage.setItem(def.storageKey, JSON.stringify(Array.isArray(value) ? value : []));
  } else {
    if (value == null) return; // value が無ければ既存を維持
    window.localStorage.setItem(def.storageKey, JSON.stringify(value));
  }
}

/** 指定キー集合のみ復元。keys 未指定なら全項目。 */
export function restoreItems(backup: FullBackup, keys?: string[]): RestoreSummary {
  const restored: RestoreSummary["restored"] = [];
  const skipped: string[] = [];
  const target = keys ? new Set(keys) : null;
  for (const [key, value] of Object.entries(backup.items)) {
    const def = ITEM_BY_KEY[key];
    if (!def) {
      skipped.push(key);
      continue;
    }
    if (target && !target.has(key)) continue;
    writeItem(def, value);
    restored.push({ key, label: def.label, count: def.kind === "array" ? (Array.isArray(value) ? value.length : 0) : null });
  }
  return { restored, skipped };
}

/** 全項目復元。 */
export function restoreBackup(backup: FullBackup): RestoreSummary {
  return restoreItems(backup);
}

/** 部分復元（単位指定 → 該当キーへ展開）。 */
export function restorePartial(backup: FullBackup, units: RestoreUnit[]): RestoreSummary {
  const unitSet = new Set(units);
  const keys = BACKUP_ITEMS.filter((d) => unitSet.has(d.unit)).map((d) => d.key);
  return restoreItems(backup, keys);
}

// ---- 比較 ----
export interface CompareRow {
  key: string;
  label: string;
  unit: RestoreUnit;
  kind: BackupItemKind;
  currentCount: number | null;
  backupCount: number | null;
  changed: boolean;
}

/** 現在の localStorage とバックアップ内容を項目ごとに比較。 */
export function compareBackup(backup: FullBackup): CompareRow[] {
  return BACKUP_ITEMS.map((def) => {
    const cur = readItemValue(def);
    const bak = backup.items[def.key];
    if (def.kind === "array") {
      const c = Array.isArray(cur) ? cur.length : 0;
      const b = Array.isArray(bak) ? bak.length : 0;
      return { key: def.key, label: def.label, unit: def.unit, kind: def.kind, currentCount: c, backupCount: b, changed: JSON.stringify(cur) !== JSON.stringify(bak) };
    }
    const changed = JSON.stringify(cur ?? null) !== JSON.stringify(bak ?? null);
    return { key: def.key, label: def.label, unit: def.unit, kind: def.kind, currentCount: cur == null ? null : 1, backupCount: bak == null ? null : 1, changed };
  });
}

// ---- 世代管理（自動退避） ----
export interface Generation {
  id: string;
  reason: string;
  backup: FullBackup;
}

function readGenerations(): Generation[] {
  const raw = readRaw(GENERATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Generation[]) : [];
  } catch {
    return [];
  }
}

export function getGenerations(): Generation[] {
  return readGenerations();
}

/** 現在状態を退避バックアップとして世代スタックへ追加（直近3件保持）。 */
export function stashCurrent(reason: string, at: string): Generation {
  const gen: Generation = { id: `${at}-${reason}`, reason, backup: createBackup(at) };
  const list = [gen, ...readGenerations()].slice(0, MAX_GENERATIONS);
  if (typeof window !== "undefined") window.localStorage.setItem(GENERATIONS_KEY, JSON.stringify(list));
  return gen;
}

export function restoreGeneration(id: string): RestoreSummary | null {
  const gen = readGenerations().find((g) => g.id === id);
  if (!gen) return null;
  return restoreBackup(gen.backup);
}

// ---- 最終バックアップ日時 ----
export function recordBackupTime(iso: string): void {
  if (typeof window !== "undefined") window.localStorage.setItem(LAST_BACKUP_KEY, iso);
}
export function getLastBackup(): string | null {
  return readRaw(LAST_BACKUP_KEY);
}

const pad = (n: number) => String(n).padStart(2, "0");
export function fileStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** フルバックアップを JSON ファイルとしてダウンロードし、最終バックアップ日時を記録。 */
export function downloadBackup(now: Date): FullBackup {
  const iso = now.toISOString();
  const backup = createBackup(iso);
  const json = JSON.stringify(backup, null, 2);
  if (typeof window !== "undefined") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jarvis-backup-${fileStamp(now)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  recordBackupTime(iso);
  return backup;
}
