// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  saveUniverse,
  loadUniverse,
  saveScreenerSnapshot,
  loadScreenerSnapshot,
  type ScreenerSnapshot,
} from "./screenerRepository";
import type { UniverseEntry } from "./universe";
import type { ScreenerRow } from "./technical";

const UNIVERSE_KEY = "jarvis-trade-log:market-universe";
const SNAPSHOT_KEY = "jarvis-trade-log:screener-snapshot";

function entry(code: string): UniverseEntry {
  return { code, name: `銘柄${code}`, nameEn: "", sector17: "", sector33: "情報通信", scaleCategory: "", market: "プライム" };
}
function row(code: string, score: number): ScreenerRow {
  return { code, name: `銘柄${code}`, sector: "情報通信", market: "プライム", price: 1000, rsi: 55, macd: "不明", relativeVolume: 1.1, score, grade: "D" };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ユニバースの往復", () => {
  it("save → load が一致", () => {
    const u = [entry("7203"), entry("9984")];
    saveUniverse(u);
    expect(loadUniverse()).toEqual(u);
  });

  it("未保存は空配列", () => {
    expect(loadUniverse()).toEqual([]);
  });

  it("破損 JSON でも例外なく空配列（UIを壊さない）", () => {
    window.localStorage.setItem(UNIVERSE_KEY, "{壊れた");
    expect(() => loadUniverse()).not.toThrow();
    expect(loadUniverse()).toEqual([]);
  });

  it("配列でない値は空配列", () => {
    window.localStorage.setItem(UNIVERSE_KEY, JSON.stringify({ not: "array" }));
    expect(loadUniverse()).toEqual([]);
  });
});

describe("スナップショットの往復", () => {
  const snap: ScreenerSnapshot = {
    generatedAt: "2026-04-10T09:00:00.000Z",
    universeCount: 3900,
    rows: [row("6758", 40), row("7203", 30)],
  };

  it("save → load が一致（生成日時・ユニバース件数・rows を含む）", () => {
    saveScreenerSnapshot(snap);
    const loaded = loadScreenerSnapshot();
    expect(loaded).toEqual(snap);
    expect(loaded?.universeCount).toBe(3900);
    expect(loaded?.generatedAt).toBe("2026-04-10T09:00:00.000Z");
  });

  it("未保存は null", () => {
    expect(loadScreenerSnapshot()).toBeNull();
  });

  it("破損 JSON でも例外なく null（安全フォールバック）", () => {
    window.localStorage.setItem(SNAPSHOT_KEY, "not json <<");
    expect(() => loadScreenerSnapshot()).not.toThrow();
    expect(loadScreenerSnapshot()).toBeNull();
  });

  it("形状不正（必須フィールド欠落）は null", () => {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ rows: [] })); // generatedAt/universeCount 欠落
    expect(loadScreenerSnapshot()).toBeNull();
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ generatedAt: "x", universeCount: "3900", rows: [] })); // 型不正
    expect(loadScreenerSnapshot()).toBeNull();
  });
});
