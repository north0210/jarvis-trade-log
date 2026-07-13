// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { K } from "@/lib/storage/keys";
import type { PaperOrder } from "./paperBroker";
import {
  loadOrderQueue,
  saveOrderQueue,
  loadSignalEngineSettings,
  saveSignalEngineSettings,
  enabledStrategyIds,
  DEFAULT_SIGNAL_ENGINE_SETTINGS,
} from "./signalEngineRepository";

beforeEach(() => window.localStorage.clear());

const order = (over: Partial<PaperOrder> = {}): PaperOrder => ({ code: "7203", strategyId: "relative-momentum", side: "buy", signalDate: "2026-04-09", shares: 100, prevClose: 1000, reason: "e", ...over });

describe("注文キュー", () => {
  it("未保存なら空配列", () => {
    expect(loadOrderQueue()).toEqual([]);
  });
  it("保存→読込でラウンドトリップ", () => {
    const q = [order(), order({ code: "9984", side: "sell", positionId: "p1" })];
    saveOrderQueue(q);
    expect(loadOrderQueue()).toEqual(q);
  });
  it("破損 JSON は空配列", () => {
    window.localStorage.setItem(K.paperOrderQueue, "{ broken");
    expect(loadOrderQueue()).toEqual([]);
  });
  it("不正な要素は除外される", () => {
    window.localStorage.setItem(K.paperOrderQueue, JSON.stringify([order(), { code: 123 }, { nope: true }]));
    expect(loadOrderQueue()).toHaveLength(1);
  });
});

describe("シグナル生成設定", () => {
  it("既定は C/B 有効・A 無効・自動OFF", () => {
    const s = loadSignalEngineSettings();
    expect(s.autoEnabled).toBe(false);
    expect(s.strategyEnabled["relative-momentum"]).toBe(true); // C
    expect(s.strategyEnabled["pullback"]).toBe(true); // B
    expect(s.strategyEnabled["trend-follow"]).toBe(false); // A
  });
  it("部分更新をマージ永続化（A を有効化・戦略フラグは既定にマージ）", () => {
    const merged = saveSignalEngineSettings({ strategyEnabled: { "trend-follow": true } });
    expect(merged.strategyEnabled["trend-follow"]).toBe(true);
    expect(merged.strategyEnabled["relative-momentum"]).toBe(true); // 既存維持
    expect(loadSignalEngineSettings().strategyEnabled["trend-follow"]).toBe(true);
  });
  it("autoEnabled の更新", () => {
    saveSignalEngineSettings({ autoEnabled: true });
    expect(loadSignalEngineSettings().autoEnabled).toBe(true);
  });
  it("enabledStrategyIds は有効な戦略IDの集合", () => {
    const ids = enabledStrategyIds(DEFAULT_SIGNAL_ENGINE_SETTINGS);
    expect(ids.has("relative-momentum")).toBe(true);
    expect(ids.has("pullback")).toBe(true);
    expect(ids.has("trend-follow")).toBe(false);
  });
});
