/**
 * localStorage キーの単一の真実（single source of truth）。
 *
 * - STORAGE_KEYS: レガシー消費者（Repository / Export / Import）が型付きアクセスで参照する主要キー。
 * - KEY_REGISTRY: アプリ全体で使用する **全 localStorage キーの中央レジストリ**。
 *   バックアップ対象（backup-service.ts の BACKUP_ITEMS）はこのレジストリから導出される。
 *   キー名（storageKey）は不変（リネームはデータ消失リスクのため禁止）。
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

// ---- 中央キーレジストリ（Phase: キー集約 必須1a） ----

/** バックアップ時の値の種別。 */
export type BackupItemKind = "array" | "value";

/** 部分復元の単位。 */
export type RestoreUnit =
  | "stocks"
  | "holdings"
  | "journal"
  | "trades"
  | "strategies"
  | "reports"
  | "notifications"
  | "settings";

/** バックアップ対象外の理由（将来セッションが判断を再現できるように残す）。 */
export type ExcludeReason =
  | "security" // 認証情報・トークン等の機微情報（外部流出リスク）
  | "regenerable" // 価格キャッシュ等・再取得/再計算で復元可能
  | "transient" // 一時的なステータス/ログ
  | "redundant" // 他キーに統合済みで復元不要
  | "meta"; // バックアップ機構自身のメタ（入れ子回避）／日時記録

export interface KeyDef {
  /** localStorage の実キー（不変）。price-cache は動的プレフィックス。 */
  storageKey: string;
  /** BACKUP_ITEMS 内の識別キー（includeInBackup=true のとき使用）。 */
  backupKey?: string;
  /** 表示名。 */
  label: string;
  /** バックアップ時の種別。 */
  kind: BackupItemKind;
  /** 部分復元の単位。 */
  unit: RestoreUnit;
  /** バックアップ対象に含めるか。 */
  includeInBackup: boolean;
  /** includeInBackup=false のときの除外理由（必須）。 */
  excludeReason?: ExcludeReason;
  /** 補足メモ。 */
  note?: string;
}

/**
 * 全 localStorage キーの中央レジストリ。
 * includeInBackup=false のキーには必ず excludeReason を付す。
 */
export const KEY_REGISTRY: KeyDef[] = [
  // === コアデータ ===
  { storageKey: "jarvis-trade-log:stocks", backupKey: "stocks", label: "銘柄", kind: "array", unit: "stocks", includeInBackup: true },
  { storageKey: "jarvis-trade-log:holdings", backupKey: "holdings", label: "保有株", kind: "array", unit: "holdings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:journal", backupKey: "journal", label: "運用日誌", kind: "array", unit: "journal", includeInBackup: true },
  { storageKey: "jarvis-trade-log:trades", backupKey: "trades", label: "取引履歴", kind: "array", unit: "trades", includeInBackup: true },
  { storageKey: "jarvis-trade-log:simulations", backupKey: "simulations", label: "試算結果", kind: "array", unit: "trades", includeInBackup: true },
  { storageKey: "jarvis-trade-log:strategies", backupKey: "strategies", label: "戦略テンプレート", kind: "array", unit: "strategies", includeInBackup: true },
  { storageKey: "jarvis-trade-log:rule-improvements", backupKey: "ruleImprovements", label: "ルール改善", kind: "array", unit: "strategies", includeInBackup: true },
  { storageKey: "jarvis-trade-log:report-snapshots", backupKey: "reportSnapshots", label: "レポートスナップショット", kind: "array", unit: "reports", includeInBackup: true },
  { storageKey: "jarvis-trade-log:strategy-ranking-snapshots", backupKey: "strategyRankingSnapshots", label: "戦略ランキング履歴", kind: "array", unit: "reports", includeInBackup: true },
  // === 通知 ===
  { storageKey: "jarvis-trade-log:notification-history", backupKey: "notifications", label: "通知履歴", kind: "value", unit: "notifications", includeInBackup: true },
  { storageKey: "jarvis-trade-log:notification-settings", backupKey: "notificationSettings", label: "通知設定", kind: "value", unit: "notifications", includeInBackup: true },
  { storageKey: "jarvis-trade-log:notification-retention", backupKey: "notificationRetention", label: "通知保持期間", kind: "value", unit: "notifications", includeInBackup: true },
  { storageKey: "jarvis-trade-log:watchlist-detections", backupKey: "watchlistEvents", label: "Watchlist検出履歴", kind: "array", unit: "notifications", includeInBackup: true },
  // === 設定 ===
  { storageKey: "jarvis-trade-log:settings", backupKey: "settings", label: "基本設定", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:threshold-settings", backupKey: "thresholdSettings", label: "通知しきい値", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:adaptive-score-settings", backupKey: "adaptiveScoreSettings", label: "適応スコア設定", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:auto-report-settings", backupKey: "autoReportSettings", label: "レポート自動保存設定", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:ai-comment-settings", backupKey: "aiCommentSettings", label: "AIコメント設定", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:auto-update-settings", backupKey: "autoUpdateSettings", label: "自動更新設定", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:cash-position", backupKey: "cashPosition", label: "現金ポジション", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:primary-strategy", backupKey: "primaryStrategy", label: "主戦略", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:tv-enabled", backupKey: "tvEnabled", label: "TradingView表示", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:advisor-weights", backupKey: "advisorWeights", label: "Advisor重み", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:ai-config", backupKey: "aiConfig", label: "AI設定", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:ranking-settings", backupKey: "rankingSettings", label: "ランキング表示設定", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:watchlist-settings", backupKey: "watchlistSettings", label: "Watchlist設定", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:performance-mode", backupKey: "performanceMode", label: "パフォーマンスモード", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:favorites", backupKey: "favorites", label: "お気に入り", kind: "array", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:help-checklist", backupKey: "helpChecklist", label: "今日やること", kind: "value", unit: "settings", includeInBackup: true },
  // === Advisor 成果物 ===
  { storageKey: "jarvis-trade-log:advisor-snapshots", backupKey: "advisorSnapshots", label: "Advisorスナップショット", kind: "array", unit: "reports", includeInBackup: true },
  { storageKey: "jarvis-trade-log:advisor-ai-comments", backupKey: "aiComments", label: "AIコメント履歴", kind: "array", unit: "reports", includeInBackup: true },
  { storageKey: "jarvis-trade-log:stock-bt-results", backupKey: "stockBtResults", label: "銘柄別BT結果", kind: "array", unit: "reports", includeInBackup: true },
  // === 今回追加（必須1a）===
  { storageKey: "jarvis-trade-log:backtest-v2-results", backupKey: "backtestV2", label: "バックテストV2結果", kind: "array", unit: "reports", includeInBackup: true, note: "ユーザー生成の成果物。容量に注意（エクスポート時にサイズ表示）。" },
  { storageKey: "jarvis-trade-log:cache-policy", backupKey: "cachePolicy", label: "キャッシュ保持方針", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:price-provider-mode", backupKey: "priceProviderMode", label: "価格プロバイダモード", kind: "value", unit: "settings", includeInBackup: true },
  { storageKey: "jarvis-trade-log:release-checklist", backupKey: "releaseChecklist", label: "初回チェック/免責同意", kind: "value", unit: "settings", includeInBackup: true },
  // === バックアップ対象外（理由付き）===
  { storageKey: "jarvis-trade-log:advisor-ai-mode", label: "AIモード(旧)", kind: "value", unit: "settings", includeInBackup: false, excludeReason: "redundant", note: "ai-config に統合済み。後方互換で残存。" },
  { storageKey: "jarvis-trade-log:lastBackup", label: "最終バックアップ日時", kind: "value", unit: "settings", includeInBackup: false, excludeReason: "meta" },
  { storageKey: "jarvis-trade-log:backup-generations", label: "退避世代スタック", kind: "array", unit: "settings", includeInBackup: false, excludeReason: "meta", note: "バックアップの入れ子回避のため対象外。" },
  { storageKey: "jarvis-trade-log:watchlist-prev", label: "監視の前回状態", kind: "value", unit: "settings", includeInBackup: false, excludeReason: "regenerable" },
  { storageKey: "jarvis-trade-log:jquants-settings", label: "J-Quants認証情報", kind: "value", unit: "settings", includeInBackup: false, excludeReason: "security" },
  { storageKey: "jarvis-trade-log:jquants-status", label: "J-Quants接続状態", kind: "value", unit: "settings", includeInBackup: false, excludeReason: "transient" },
  { storageKey: "jarvis-trade-log:jquants-token-cache", label: "J-Quants認証トークン", kind: "value", unit: "settings", includeInBackup: false, excludeReason: "security" },
  { storageKey: "jarvis-trade-log:price-cache:", label: "価格系列キャッシュ（動的プレフィックス）", kind: "value", unit: "settings", includeInBackup: false, excludeReason: "regenerable", note: "実キーは price-cache:<code>:<from>:<to>。再取得可・大容量。" },
  { storageKey: "jarvis-trade-log:price-update-log", label: "価格更新ログ", kind: "array", unit: "settings", includeInBackup: false, excludeReason: "transient" },
];

/** バックアップ対象（includeInBackup=true）のみ。backup-service.ts が導出に使用。 */
export const BACKUP_KEY_DEFS: KeyDef[] = KEY_REGISTRY.filter((k) => k.includeInBackup);
