/**
 * バックアップ・エクスポート層
 *
 * localStorage の全データ（stocks / holdings / journal / settings）を
 * 1 つの JSON エンベロープにまとめ、ファイルとしてダウンロードする。
 * インポート側（importService.ts）と対になる。
 */
import { BACKUP_APP, BACKUP_VERSION, STORAGE_KEYS } from "./keys";

/** バックアップ JSON の構造。 */
export interface BackupEnvelope {
  app: string; // "jarvis-trade-log"
  version: number; // スキーマバージョン
  exportedAt: string; // ISO datetime
  data: {
    stocks: unknown[];
    holdings: unknown[];
    journal: unknown[];
    settings: unknown | null;
  };
}

function readArray(key: string): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readValue(key: string): unknown | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** yyyyMMdd-HHmmss 形式のタイムスタンプ（ファイル名用・ローカル時刻）。 */
function fileStamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** 現在の localStorage 内容からバックアップエンベロープを構築する。 */
export function buildEnvelope(exportedAt: string): BackupEnvelope {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt,
    data: {
      stocks: readArray(STORAGE_KEYS.stocks),
      holdings: readArray(STORAGE_KEYS.holdings),
      journal: readArray(STORAGE_KEYS.journal),
      settings: readValue(STORAGE_KEYS.settings),
    },
  };
}

/** 最終バックアップ日時（ISO）を記録する。 */
export function recordBackupTime(iso: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEYS.lastBackup, iso);
}

/** 最終バックアップ日時（ISO）を取得する。未実施なら null。 */
export function getLastBackup(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEYS.lastBackup);
}

/** ISO 日時を "YYYY-MM-DD HH:mm"（ローカル時刻）へ整形する。 */
export function formatBackupTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * 全データを JSON ファイルとしてダウンロードし、最終バックアップ日時を記録する。
 * ファイル名: jarvis-trade-log-yyyyMMdd-HHmmss.json
 * @returns 記録した最終バックアップ日時（ISO）
 */
export function exportAll(): string {
  const now = new Date();
  const iso = now.toISOString();
  const envelope = buildEnvelope(iso);
  const json = JSON.stringify(envelope, null, 2);

  if (typeof window !== "undefined") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jarvis-trade-log-${fileStamp(now)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  recordBackupTime(iso);
  return iso;
}
