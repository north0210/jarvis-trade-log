// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  createBackup,
  restoreBackup,
  validateBackup,
  FULL_VERSION,
  BACKUP_ITEMS,
  type FullBackup,
} from "@/lib/backup/backup-service";

/**
 * バックアップ完全性（ラウンドトリップ）テスト（必須2）。
 * 代表データ投入 → export(createBackup) → 全消去 → import(restoreBackup) →
 * 包含対象36キー全ての値一致を機械的に検証する。
 * localStorage が必要なため environment=happy-dom。
 */

/** 各キーに種別ごとの代表値を投入。 */
function seedAll(): Record<string, unknown> {
  const sample: Record<string, unknown> = {};
  for (const it of BACKUP_ITEMS) {
    const val =
      it.kind === "array"
        ? [
            { id: `${it.key}-1`, n: 1, s: "α" },
            { id: `${it.key}-2`, n: 2, s: "β" },
          ]
        : { key: it.key, enabled: true, num: 42, nested: { a: [1, 2, 3] } };
    sample[it.storageKey] = val;
    window.localStorage.setItem(it.storageKey, JSON.stringify(val));
  }
  return sample;
}

describe("バックアップ完全性: ラウンドトリップ（36キー全数）", () => {
  beforeEach(() => window.localStorage.clear());

  it("投入→export→全消去→import で 全36キー・全値が一致復元される", () => {
    const sample = seedAll();
    expect(BACKUP_ITEMS.length).toBe(36);

    const backup = createBackup(new Date().toISOString());

    // 全消去
    window.localStorage.clear();
    for (const it of BACKUP_ITEMS) {
      expect(window.localStorage.getItem(it.storageKey), `${it.storageKey} が消去されていない`).toBeNull();
    }

    // import（復元）
    const summary = restoreBackup(backup);
    expect(summary.restored.length).toBe(36);

    // 全キー・全値の一致検証（機械的ループ）
    for (const it of BACKUP_ITEMS) {
      const raw = window.localStorage.getItem(it.storageKey);
      expect(raw, `${it.storageKey} が復元されていない`).not.toBeNull();
      expect(JSON.parse(raw as string), `${it.storageKey} の値が不一致`).toEqual(sample[it.storageKey]);
    }
  });

  it("createBackup の items が全36キーを含む", () => {
    seedAll();
    const backup = createBackup(new Date().toISOString());
    for (const it of BACKUP_ITEMS) {
      expect(Object.prototype.hasOwnProperty.call(backup.items, it.key), `${it.key} が items に無い`).toBe(true);
    }
  });
});

describe("バックアップ完全性: 異常系（既存データ保護）", () => {
  beforeEach(() => window.localStorage.clear());

  it("破損JSONの検証では ok=false かつ既存データは失われない（validateは書き込まない）", () => {
    window.localStorage.setItem("jarvis-trade-log:stocks", JSON.stringify([{ id: "keep" }]));
    const v = validateBackup("{ これは壊れたJSON ");
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
    // 既存データは無傷（復元は ok の時のみ UI 側で実行される設計）
    expect(window.localStorage.getItem("jarvis-trade-log:stocks")).toBe(JSON.stringify([{ id: "keep" }]));
  });

  it("別アプリのJSONは ok=false（誤importを拒否）", () => {
    const v = validateBackup(JSON.stringify({ app: "other-app", version: 2, format: "full", items: {} }));
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toContain("このアプリのバックアップではありません");
  });

  it("スキーマバージョン超過（未来版）は ok=false", () => {
    const future: FullBackup = {
      app: "jarvis-trade-log",
      version: FULL_VERSION + 1,
      format: "full",
      exportedAt: new Date().toISOString(),
      checksum: "",
      items: { stocks: [] },
    };
    const v = validateBackup(future);
    expect(v.version).toBe(FULL_VERSION + 1);
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toContain("新しいバージョン");
  });

  it("checksum改竄は checksumOk=false かつ ok=false（破損検知）", () => {
    seedAll();
    const backup = createBackup(new Date().toISOString());
    // items を改竄（checksum は据え置き）
    const tampered = { ...backup, items: { ...backup.items, stocks: [{ tampered: true }] } };
    const v = validateBackup(JSON.stringify(tampered));
    expect(v.checksumOk).toBe(false);
    expect(v.ok).toBe(false);
  });

  it("正規のバックアップは validateBackup で ok=true・checksum一致", () => {
    seedAll();
    const backup = createBackup(new Date().toISOString());
    const v = validateBackup(JSON.stringify(backup));
    expect(v.ok).toBe(true);
    expect(v.checksumOk).toBe(true);
  });
});
