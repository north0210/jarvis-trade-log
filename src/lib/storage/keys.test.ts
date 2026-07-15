import { describe, it, expect } from "vitest";
import { KEY_REGISTRY, STORAGE_KEYS, BACKUP_APP, BACKUP_KEY_DEFS, K } from "@/lib/storage/keys";

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
  "jarvis-trade-log:market-calendar",
  "jarvis-trade-log:market-universe",
  "jarvis-trade-log:notification-history",
  "jarvis-trade-log:notification-retention",
  "jarvis-trade-log:notification-settings",
  "jarvis-trade-log:onboarding-done",
  "jarvis-trade-log:paper-broker-account",
  "jarvis-trade-log:paper-broker-settings",
  "jarvis-trade-log:paper-order-queue",
  "jarvis-trade-log:paper-valuation-snapshot",
  "jarvis-trade-log:performance-mode",
  "jarvis-trade-log:price-cache:",
  "jarvis-trade-log:price-provider-mode",
  "jarvis-trade-log:price-update-log",
  "jarvis-trade-log:primary-strategy",
  "jarvis-trade-log:ranking-settings",
  "jarvis-trade-log:release-checklist",
  "jarvis-trade-log:report-snapshots",
  "jarvis-trade-log:rule-improvements",
  "jarvis-trade-log:screener-auto-settings",
  "jarvis-trade-log:screener-snapshot",
  "jarvis-trade-log:settings",
  "jarvis-trade-log:signal-engine-settings",
  "jarvis-trade-log:simulations",
  "jarvis-trade-log:stock-bt-results",
  "jarvis-trade-log:stocks",
  "jarvis-trade-log:strategies",
  "jarvis-trade-log:strategy-comparison",
  "jarvis-trade-log:strategy-ranking-snapshots",
  "jarvis-trade-log:threshold-settings",
  "jarvis-trade-log:trades",
  "jarvis-trade-log:tv-enabled",
  "jarvis-trade-log:watchlist-detections",
  "jarvis-trade-log:watchlist-prev",
  "jarvis-trade-log:watchlist-settings",
];

describe("KEY_REGISTRY: キー集合のスナップショット固定", () => {
  it("全 storageKey が期待リスト（56エントリ）と過不足なく一致", () => {
    const actual = KEY_REGISTRY.map((k) => k.storageKey).sort();
    expect(actual).toEqual(EXPECTED_KEYS);
  });

  it("エントリ総数 = 56（具体キー55 + 動的プレフィックス1）", () => {
    expect(KEY_REGISTRY.length).toBe(56);
    expect(EXPECTED_KEYS.length).toBe(56);
  });

  it("動的プレフィックスは price-cache: のみ（それ以外は具体キー）", () => {
    const prefixEntries = KEY_REGISTRY.map((k) => k.storageKey).filter((k) => k.endsWith(":"));
    expect(prefixEntries).toEqual([PRICE_CACHE_PREFIX]);
    // 具体キー数 = 55
    expect(KEY_REGISTRY.length - prefixEntries.length).toBe(55);
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
    const byRefName = new Map(KEY_REGISTRY.map((k) => [k.refName, k.storageKey]));
    for (const [name, value] of Object.entries(K)) {
      expect(byRefName.get(name), `K.${name} がレジストリと不一致`).toBe(value);
    }
  });

  it("K は全キー（refName ベース・55エントリ）を収録", () => {
    expect(Object.keys(K).length).toBe(KEY_REGISTRY.length);
    expect(Object.keys(K).length).toBe(56);
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

  it("K が Batch1 の4キーを正しく指す（6-1 変換対象）", () => {
    expect(K.simulations).toBe("jarvis-trade-log:simulations");
    expect(K.ruleImprovements).toBe("jarvis-trade-log:rule-improvements");
    expect(K.reportSnapshots).toBe("jarvis-trade-log:report-snapshots");
    expect(K.strategyRankingSnapshots).toBe("jarvis-trade-log:strategy-ranking-snapshots");
  });

  it("K が Batch2 の4キーを正しく指す（6-1 変換対象）", () => {
    expect(K.thresholdSettings).toBe("jarvis-trade-log:threshold-settings");
    expect(K.adaptiveScoreSettings).toBe("jarvis-trade-log:adaptive-score-settings");
    expect(K.autoReportSettings).toBe("jarvis-trade-log:auto-report-settings");
    expect(K.aiCommentSettings).toBe("jarvis-trade-log:ai-comment-settings");
  });

  it("K が Batch3 の4キーを正しく指す（6-1 変換対象）", () => {
    expect(K.autoUpdateSettings).toBe("jarvis-trade-log:auto-update-settings");
    expect(K.cashPosition).toBe("jarvis-trade-log:cash-position");
    expect(K.advisorWeights).toBe("jarvis-trade-log:advisor-weights");
    expect(K.rankingSettings).toBe("jarvis-trade-log:ranking-settings");
  });

  it("K が Batch4 の4キーを正しく指す（6-1 変換対象）", () => {
    expect(K.favorites).toBe("jarvis-trade-log:favorites");
    expect(K.helpChecklist).toBe("jarvis-trade-log:help-checklist");
    expect(K.advisorSnapshots).toBe("jarvis-trade-log:advisor-snapshots");
    expect(K.aiComments).toBe("jarvis-trade-log:advisor-ai-comments");
  });

  it("K が Batch5 の3キーを正しく指す（6-1 変換対象）", () => {
    expect(K.stockBtResults).toBe("jarvis-trade-log:stock-bt-results");
    expect(K.backtestV2).toBe("jarvis-trade-log:backtest-v2-results");
    expect(K.releaseChecklist).toBe("jarvis-trade-log:release-checklist");
  });

  it("K が要注意帯①の除外キーを正しく指す（6-1 変換対象）", () => {
    expect(K.priceUpdateLog).toBe("jarvis-trade-log:price-update-log");
  });

  it("K が要注意帯②を正しく指す（6-1 変換対象）", () => {
    expect(K.primaryStrategy).toBe("jarvis-trade-log:primary-strategy");
  });

  it("K が要注意帯③(notification 3キー)を正しく指す（6-1 変換対象）", () => {
    expect(K.notificationSettings).toBe("jarvis-trade-log:notification-settings");
    expect(K.notificationRetention).toBe("jarvis-trade-log:notification-retention");
    // ⚠️ 重要: 履歴キーの refName は backupKey 由来の "notifications"。
    // storageKey は notification-history。将来の読み手が混同しないよう明示固定する。
    expect(K.notifications).toBe("jarvis-trade-log:notification-history");
  });

  it("K が要注意帯④(watchlist 3キー)を正しく指す（6-1 変換対象）", () => {
    expect(K.watchlistSettings).toBe("jarvis-trade-log:watchlist-settings");
    expect(K.watchlistPrev).toBe("jarvis-trade-log:watchlist-prev");
    // ⚠️ 重要: 検出履歴キーの refName は backupKey 由来の "watchlistEvents"。
    // storageKey は watchlist-detections。将来の読み手が混同しないよう明示固定する。
    expect(K.watchlistEvents).toBe("jarvis-trade-log:watchlist-detections");
  });

  it("K が要注意帯⑤(pricing/settings 3キー)を正しく指す（6-1 変換対象）", () => {
    expect(K.priceProviderMode).toBe("jarvis-trade-log:price-provider-mode");
    expect(K.jquantsSettings).toBe("jarvis-trade-log:jquants-settings");
    expect(K.jquantsStatus).toBe("jarvis-trade-log:jquants-status");
  });

  it("K が要注意帯⑥(jquants-token-cache)を正しく指す（6-1 変換対象）", () => {
    expect(K.jquantsTokenCache).toBe("jarvis-trade-log:jquants-token-cache");
  });

  it("K が要注意帯⑦(advisor-ai-settings 2キー)を正しく指す（6-1 変換対象）", () => {
    expect(K.aiConfig).toBe("jarvis-trade-log:ai-config");
    // advisorAiMode は ai-config 統合済みの旧キー（後方互換で残存・backup除外）。
    expect(K.advisorAiMode).toBe("jarvis-trade-log:advisor-ai-mode");
  });

  it("K が要注意帯⑨(priceCache: 動的prefix + cache-policy)を正しく指す（6-1 変換対象）", () => {
    expect(K.cachePolicy).toBe("jarvis-trade-log:cache-policy");
    // ⚠️ price-cache は動的プレフィックス。末尾コロン込みで完全一致すること。
    expect(K.priceCache).toBe("jarvis-trade-log:price-cache:");
    // 動的合成の健全性: 実キー生成が従来リテラルと一致（コロン欠落等の回帰を検知）。
    expect(K.priceCache + "7203").toBe("jarvis-trade-log:price-cache:7203");
    expect(`${K.priceCache}9984`).toBe("jarvis-trade-log:price-cache:9984");
  });

  it("K が要注意帯⑩(backup-service メタキー)を正しく指す（6-1 変換対象）", () => {
    expect(K.backupGenerations).toBe("jarvis-trade-log:backup-generations");
    expect(K.lastBackup).toBe("jarvis-trade-log:lastBackup");
  });

  it("K が onboarding-done（後追い登録キー）を正しく指す（6-1 変換対象）", () => {
    expect(K.onboardingDone).toBe("jarvis-trade-log:onboarding-done");
  });

  it("K がスクリーナー新キー（regenerable）を正しく指す", () => {
    expect(K.marketUniverse).toBe("jarvis-trade-log:market-universe");
    expect(K.screenerSnapshot).toBe("jarvis-trade-log:screener-snapshot");
  });

  it("K がスクリーナー自動更新設定キーを正しく指す", () => {
    expect(K.screenerAutoSettings).toBe("jarvis-trade-log:screener-auto-settings");
  });

  it("K が取引カレンダーキー（regenerable）を正しく指す", () => {
    expect(K.marketCalendar).toBe("jarvis-trade-log:market-calendar");
  });
});

describe("refName（A-1: 参照識別子）の固定化", () => {
  it("全キーが空でない refName を持つ", () => {
    for (const k of KEY_REGISTRY) {
      expect(k.refName, `${k.storageKey} に refName が必要`).toBeTruthy();
    }
  });

  it("refName に重複がない", () => {
    const names = KEY_REGISTRY.map((k) => k.refName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("backupKey を持つ全キーは refName === backupKey（既存 K プロパティ名と完全一致）", () => {
    for (const k of KEY_REGISTRY.filter((x) => x.backupKey)) {
      expect(k.refName, `${k.storageKey} の refName が backupKey と不一致`).toBe(k.backupKey);
    }
  });

  it("除外キー（backupKey なし）の refName は storageKey サフィックスの camelCase", () => {
    const EXPECTED_DERIVED: Record<string, string> = {
      "jarvis-trade-log:advisor-ai-mode": "advisorAiMode",
      "jarvis-trade-log:lastBackup": "lastBackup",
      "jarvis-trade-log:backup-generations": "backupGenerations",
      "jarvis-trade-log:watchlist-prev": "watchlistPrev",
      "jarvis-trade-log:jquants-settings": "jquantsSettings",
      "jarvis-trade-log:jquants-status": "jquantsStatus",
      "jarvis-trade-log:jquants-token-cache": "jquantsTokenCache",
      "jarvis-trade-log:price-cache:": "priceCache",
      "jarvis-trade-log:price-update-log": "priceUpdateLog",
      "jarvis-trade-log:onboarding-done": "onboardingDone",
      "jarvis-trade-log:market-calendar": "marketCalendar",
      "jarvis-trade-log:market-universe": "marketUniverse",
      "jarvis-trade-log:screener-snapshot": "screenerSnapshot",
      "jarvis-trade-log:paper-valuation-snapshot": "paperValuationSnapshot",
    };
    const excluded = KEY_REGISTRY.filter((k) => !k.backupKey);
    // 除外キーの集合が期待どおり（過不足なし）
    expect(excluded.map((k) => k.storageKey).sort()).toEqual(Object.keys(EXPECTED_DERIVED).sort());
    for (const k of excluded) {
      expect(k.refName, `${k.storageKey} の派生 refName`).toBe(EXPECTED_DERIVED[k.storageKey]);
    }
  });

  it("K のプロパティ名集合は全 refName と一致", () => {
    expect(Object.keys(K).sort()).toEqual(KEY_REGISTRY.map((k) => k.refName).sort());
  });

  it("既変換キー（Step1-2 + Batch1-5 = 21件）の参照が不変（回帰固定）", () => {
    // 付け替え済みのプロパティ名が1文字も変わらないこと。
    const CONVERTED = [
      "tvEnabled", "performanceMode",
      "simulations", "ruleImprovements", "reportSnapshots", "strategyRankingSnapshots",
      "thresholdSettings", "adaptiveScoreSettings", "autoReportSettings", "aiCommentSettings",
      "autoUpdateSettings", "cashPosition", "advisorWeights", "rankingSettings",
      "favorites", "helpChecklist", "advisorSnapshots", "aiComments",
      "stockBtResults", "backtestV2", "releaseChecklist",
    ];
    for (const name of CONVERTED) {
      expect(K[name], `K.${name} が失われている`).toBeTruthy();
    }
  });
});

describe("セキュリティ除外の固定化（負のアサーション）", () => {
  // 認証・機微情報はバックアップ／エクスポートに絶対含めない、という意図を明示固定する。
  const MUST_BE_EXCLUDED = [
    "jarvis-trade-log:jquants-settings", // {email,password}
    "jarvis-trade-log:jquants-status",
    "jarvis-trade-log:jquants-token-cache", // 認証トークン
  ];

  it("BACKUP_KEY_DEFS に jquants 系キーが含まれない", () => {
    const backupKeys = new Set(BACKUP_KEY_DEFS.map((k) => k.storageKey));
    for (const k of MUST_BE_EXCLUDED) {
      expect(backupKeys.has(k), `${k} はバックアップ対象に含めてはならない`).toBe(false);
    }
  });

  it("jquants 系キーは includeInBackup=false かつ security/transient 理由付き", () => {
    for (const k of MUST_BE_EXCLUDED) {
      const def = KEY_REGISTRY.find((x) => x.storageKey === k);
      expect(def, `${k} がレジストリに存在しない`).toBeTruthy();
      expect(def!.includeInBackup, `${k} はバックアップ除外であるべき`).toBe(false);
      expect(["security", "transient"]).toContain(def!.excludeReason);
    }
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
