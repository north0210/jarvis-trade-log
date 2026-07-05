import { describe, it, expect } from "vitest";
import { KEY_REGISTRY, STORAGE_KEYS, BACKUP_APP, K } from "@/lib/storage/keys";

/**
 * キー参照一元化（6-1）の安全網。
 *
 * 目的: 参照の付け替え前に「KEY_REGISTRY = 実在キー集合」を固定し、
 *       以後キーが増減・改名した際に即座に検知できるようにする。
 *
 * 固定対象（v1.7.0 時点・45エントリ）:
 *   - 44 の具体キー（lastBackup を含む）
 *   - 1 の動的プレフィックス `jarvis-trade-log:price-cache:`
 *
 * 注意: キー文字列は不変（リネームはデータ消失リスクのため禁止）。
 *       このスナップショットを更新するのは「意図的にキーを追加/削除した」ときだけ。
 */

const PREFIX = "jarvis-trade-log:";

/** 動的プレフィックス（実キーは price-cache:<code>:<from>:<to>）。具体キーではない。 */
const PRICE_CACHE_PREFIX = "jarvis-trade-log:price-cache:";

/** KEY_REGISTRY の全 storageKey（ソート済み・スナップショット固定）。 */
const EXPECTED_KEYS = [
  "jarvis-trade-log:adaptive-score-settings",
  "jarvis-trade-log:advisor-ai-comments",
  "jarvis-trade-log:advisor-ai-mode",
  "jarvis-trade-log:advisor-snapshots",
  "jarvis-trade-log:advisor-weights",
  "jarvis-trade-log:ai-comment-settings",
  "jarvis-trade-log:ai-config",
  "jarvis-trade-log:auto-report-settings",
  "jarvis-trade-log:auto-update-settings",
  "jarvis-trade-log:backtest-v2-results",
  "jarvis-trade-log:backup-generations",
  "jarvis-trade-log:cache-policy",
  "jarvis-trade-log:cash-position",
  "jarvis-trade-log:favorites",
  "jarvis-trade-log:help-checklist",
  "jarvis-trade-log:holdings",
  "jarvis-trade-log:journal",
  "jarvis-trade-log:jquants-settings",
  "jarvis-trade-log:jquants-status",
  "jarvis-trade-log:jquants-token-cache",
  "jarvis-trade-log:lastBackup",
  "jarvis-trade-log:notification-history",
  "jarvis-trade-log:notification-retention",
  "jarvis-trade-log:notification-settings",
  "jarvis-trade-log:performance-mode",
  "jarvis-trade-log:price-cache:",
  "jarvis-trade-log:price-provider-mode",
  "jarvis-trade-log:price-update-log",
  "jarvis-trade-log:primary-strategy",
  "jarvis-trade-log:ranking-settings",
  "jarvis-trade-log:release-checklist",
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
  "jarvis-trade-log:watchlist-prev",
  "jarvis-trade-log:watchlist-settings",
];

describe("KEY_REGISTRY: キー集合のスナップショット固定", () => {
  it("全 storageKey が期待リスト（45エントリ）と過不足なく一致", () => {
    const actual = KEY_REGISTRY.map((k) => k.storageKey).sort();
    expect(actual).toEqual(EXPECTED_KEYS);
  });

  it("エントリ総数 = 45（具体キー44 + 動的プレフィックス1）", () => {
    expect(KEY_REGISTRY.length).toBe(45);
    expect(EXPECTED_KEYS.length).toBe(45);
  });

  it("動的プレフィックスは price-cache: のみ（それ以外は具体キー）", () => {
    const prefixEntries = KEY_REGISTRY.map((k) => k.storageKey).filter((k) => k.endsWith(":"));
    expect(prefixEntries).toEqual([PRICE_CACHE_PREFIX]);
    // 具体キー数 = 44
    expect(KEY_REGISTRY.length - prefixEntries.length).toBe(44);
  });
});

describe("KEY_REGISTRY: プレフィックス検証", () => {
  it("全 storageKey が jarvis-trade-log: プレフィックスを持つ", () => {
    for (const k of KEY_REGISTRY) {
      expect(k.storageKey.startsWith(PREFIX), `${k.storageKey} はプレフィックス不正`).toBe(true);
    }
  });

  it("プレフィックスは BACKUP_APP と一致する", () => {
    expect(PREFIX).toBe(`${BACKUP_APP}:`);
  });

  it("プレフィックスの後ろに実体（キー名）がある（プレフィックスのみのキーは存在しない）", () => {
    for (const k of KEY_REGISTRY) {
      expect(k.storageKey.length, `${k.storageKey} が空`).toBeGreaterThan(PREFIX.length);
    }
  });
});

describe("KEY_REGISTRY: 重複なし", () => {
  it("storageKey に重複がない", () => {
    const keys = KEY_REGISTRY.map((k) => k.storageKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("backupKey（定義済みのもの）に重複がない", () => {
    const backupKeys = KEY_REGISTRY.map((k) => k.backupKey).filter((k): k is string => Boolean(k));
    expect(new Set(backupKeys).size).toBe(backupKeys.length);
  });
});

describe("K（名前付きキー定数）: KEY_REGISTRY からの導出整合", () => {
  it("K の全プロパティが KEY_REGISTRY の storageKey と一致（別ソースの二重定義でない）", () => {
    const byBackupKey = new Map(
      KEY_REGISTRY.filter((k) => k.backupKey).map((k) => [k.backupKey as string, k.storageKey]),
    );
    for (const [name, value] of Object.entries(K)) {
      expect(byBackupKey.get(name), `K.${name} がレジストリと不一致`).toBe(value);
    }
  });

  it("K は backupKey を持つ全キー（=バックアップ対象36件）を収録", () => {
    const expected = KEY_REGISTRY.filter((k) => k.backupKey).length;
    expect(Object.keys(K).length).toBe(expected);
    expect(expected).toBe(36);
  });

  it("K の全値が jarvis-trade-log: プレフィックスを持つ", () => {
    for (const v of Object.values(K)) {
      expect(v.startsWith(PREFIX), `${v} はプレフィックス不正`).toBe(true);
    }
  });

  it("K は凍結されている（実行時の誤変更を防止）", () => {
    expect(Object.isFrozen(K)).toBe(true);
  });

  it("K.tvEnabled が tv-enabled 実キーを指す（6-1 変換対象）", () => {
    expect(K.tvEnabled).toBe("jarvis-trade-log:tv-enabled");
  });

  it("K.performanceMode が performance-mode 実キーを指す（6-1 変換対象）", () => {
    expect(K.performanceMode).toBe("jarvis-trade-log:performance-mode");
  });
});

describe("STORAGE_KEYS（レガシー）との整合", () => {
  it("STORAGE_KEYS の全値が jarvis-trade-log: プレフィックスを持つ", () => {
    for (const v of Object.values(STORAGE_KEYS)) {
      expect(v.startsWith(PREFIX), `${v} はプレフィックス不正`).toBe(true);
    }
  });

  it("STORAGE_KEYS の全値が KEY_REGISTRY に実在する", () => {
    const registrySet = new Set(KEY_REGISTRY.map((k) => k.storageKey));
    for (const v of Object.values(STORAGE_KEYS)) {
      expect(registrySet.has(v), `${v} が KEY_REGISTRY に存在しない`).toBe(true);
    }
  });
});
