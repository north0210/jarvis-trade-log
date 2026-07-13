import { describe, it, expect } from "vitest";
import { BACKUP_ITEMS } from "@/lib/backup/backup-service";
import { KEY_REGISTRY } from "@/lib/storage/keys";

/**
 * BACKUP_ITEMS 固定化テスト（必須1a）。
 * keys.ts の中央レジストリから導出された結果が「旧32キー + 追加 = 37」
 * と一致することをスナップショット的に固定する。将来の意図しない増減を検知する。
 */

// 旧 BACKUP_ITEMS の storageKey（32件）
const LEGACY_36_MINUS_4 = [
  "jarvis-trade-log:adaptive-score-settings",
  "jarvis-trade-log:advisor-ai-comments",
  "jarvis-trade-log:advisor-snapshots",
  "jarvis-trade-log:advisor-weights",
  "jarvis-trade-log:ai-comment-settings",
  "jarvis-trade-log:ai-config",
  "jarvis-trade-log:auto-report-settings",
  "jarvis-trade-log:auto-update-settings",
  "jarvis-trade-log:cash-position",
  "jarvis-trade-log:favorites",
  "jarvis-trade-log:help-checklist",
  "jarvis-trade-log:holdings",
  "jarvis-trade-log:journal",
  "jarvis-trade-log:notification-history",
  "jarvis-trade-log:notification-retention",
  "jarvis-trade-log:notification-settings",
  "jarvis-trade-log:performance-mode",
  "jarvis-trade-log:primary-strategy",
  "jarvis-trade-log:ranking-settings",
  "jarvis-trade-log:report-snapshots",
  "jarvis-trade-log:rule-improvements",
  "jarvis-trade-log:settings",
  "jarvis-trade-log:simulations",
  "jarvis-trade-log:stock-bt-results",
  "jarvis-trade-log:stocks",
  "jarvis-trade-log:strategies",
  "jarvis-trade-log:strategy-ranking-snapshots",
  "jarvis-trade-log:threshold-settings",
  "jarvis-trade-log:trades",
  "jarvis-trade-log:tv-enabled",
  "jarvis-trade-log:watchlist-detections",
  "jarvis-trade-log:watchlist-settings",
];

// 追加（必須1a）
const ADDED_4 = [
  "jarvis-trade-log:screener-auto-settings",
  "jarvis-trade-log:backtest-v2-results",
  "jarvis-trade-log:cache-policy",
  "jarvis-trade-log:price-provider-mode",
  "jarvis-trade-log:release-checklist",
];

// 追加（Phase 1 / ペーパートレード＋戦略比較）
const ADDED_PAPER = [
  "jarvis-trade-log:paper-broker-account",
  "jarvis-trade-log:paper-broker-settings",
  "jarvis-trade-log:strategy-comparison",
];

const EXPECTED_40 = [...LEGACY_36_MINUS_4, ...ADDED_4, ...ADDED_PAPER].sort();

describe("BACKUP_ITEMS 導出（keys.ts レジストリから）", () => {
  it("対象は 40キーで一致（スナップショット固定）", () => {
    const actual = BACKUP_ITEMS.map((i) => i.storageKey).sort();
    expect(actual).toEqual(EXPECTED_40);
    expect(actual.length).toBe(40);
  });

  it("追加キーが確実に含まれる", () => {
    const set = new Set(BACKUP_ITEMS.map((i) => i.storageKey));
    for (const k of [...ADDED_4, ...ADDED_PAPER]) expect(set.has(k)).toBe(true);
  });

  it("各 BACKUP_ITEM は key/label/kind/unit を持つ", () => {
    for (const it of BACKUP_ITEMS) {
      expect(it.key).toBeTruthy();
      expect(it.label).toBeTruthy();
      expect(["array", "value"]).toContain(it.kind);
      expect(it.storageKey.startsWith("jarvis-trade-log:")).toBe(true);
    }
  });

  it("backupKey（エンベロープ内キー）に重複がない", () => {
    const keys = BACKUP_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("KEY_REGISTRY 整合性", () => {
  it("includeInBackup=false のキーは必ず excludeReason を持つ", () => {
    for (const k of KEY_REGISTRY.filter((x) => !x.includeInBackup)) {
      expect(k.excludeReason, `${k.storageKey} に除外理由が必要`).toBeTruthy();
    }
  });

  it("includeInBackup=true のキーは backupKey を持つ", () => {
    for (const k of KEY_REGISTRY.filter((x) => x.includeInBackup)) {
      expect(k.backupKey, `${k.storageKey} に backupKey が必要`).toBeTruthy();
    }
  });

  it("storageKey に重複がない（同一キーの二重定義防止）", () => {
    const keys = KEY_REGISTRY.map((k) => k.storageKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("除外キーには機微/一時/再取得可/冗長/メタのいずれかの理由が付く", () => {
    const valid = new Set(["security", "regenerable", "transient", "redundant", "meta"]);
    for (const k of KEY_REGISTRY.filter((x) => !x.includeInBackup)) {
      expect(valid.has(k.excludeReason as string)).toBe(true);
    }
  });
});
