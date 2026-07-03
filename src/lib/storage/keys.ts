/**
 * localStorage キーの単一の真実（single source of truth）。
 * 各 Repository / Export / Import サービスはここを参照する。
 */
export const STORAGE_KEYS = {
  stocks: "jarvis-trade-log:stocks",
  holdings: "jarvis-trade-log:holdings",
  journal: "jarvis-trade-log:journal",
  trades: "jarvis-trade-log:trades",
  strategies: "jarvis-trade-log:strategies",
  settings: "jarvis-trade-log:settings",
  lastBackup: "jarvis-trade-log:lastBackup",
} as const;

/** バックアップ JSON のアプリ識別子・スキーマバージョン。 */
export const BACKUP_APP = "jarvis-trade-log";
export const BACKUP_VERSION = 1;
