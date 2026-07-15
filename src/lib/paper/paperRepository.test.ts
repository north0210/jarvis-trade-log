// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { K } from "@/lib/storage/keys";
import {
  loadPaperAccount,
  savePaperAccount,
  loadPaperBrokerSettings,
  savePaperBrokerSettings,
  loadValuationSnapshot,
  saveValuationSnapshot,
  valuationPriceMap,
  type ValuationSnapshot,
} from "./paperRepository";
import { emptyAccount, DEFAULT_PAPER_BROKER_SETTINGS, type PaperAccount } from "./paperBroker";

beforeEach(() => {
  window.localStorage.clear();
});

const CAPITAL = DEFAULT_PAPER_BROKER_SETTINGS.capitalYen; // 500,000
const freshAccount = () => ({ ...emptyAccount(), cash: CAPITAL });

const sampleAccount = (): PaperAccount => ({
  positions: [
    { id: "trend-follow:7203:2026-04-10", code: "7203", name: "トヨタ", strategyId: "trend-follow", shares: 100, entryDate: "2026-04-10", entryPrice: 1010, entryReason: "GC" },
  ],
  closedTrades: [
    { id: "t1", code: "9984", strategyId: "pullback", shares: 10, entryDate: "2026-01-01", entryPrice: 1000, exitDate: "2026-01-10", exitPrice: 1200, exitReason: "利確", pnlYen: 2000, pnlPct: 20, holdingDays: 9 },
  ],
  killSwitch: { active: true, reason: "停止", triggeredAt: "2026-04-01T00:00:00.000Z", drawdownPctAtTrigger: -12 },
  cash: 399_000, // 500,000 − 建玉 100×1010
  updatedAt: "2026-04-10T00:00:00.000Z",
});

describe("paperRepository: 口座", () => {
  it("未保存なら空口座（現金＝運用資金）", () => {
    expect(loadPaperAccount()).toEqual(freshAccount());
  });
  it("保存 → 読込でラウンドトリップ", () => {
    const a = sampleAccount();
    savePaperAccount(a);
    expect(loadPaperAccount()).toEqual(a);
  });
  it("破損 JSON は空口座へフォールバック", () => {
    window.localStorage.setItem(K.paperBrokerAccount, "{ broken");
    expect(loadPaperAccount()).toEqual(freshAccount());
  });
  it("形状不正（positions が配列でない）は空口座へフォールバック", () => {
    window.localStorage.setItem(K.paperBrokerAccount, JSON.stringify({ positions: {}, closedTrades: [] }));
    expect(loadPaperAccount()).toEqual(freshAccount());
  });
  it("killSwitch 欠損は非発動へ正規化", () => {
    window.localStorage.setItem(K.paperBrokerAccount, JSON.stringify({ positions: [], closedTrades: [], updatedAt: "" }));
    expect(loadPaperAccount().killSwitch.active).toBe(false);
  });
  it("cash 未保存の旧口座は 運用資金 − 建玉建値合計 で初期化（後方互換）", () => {
    // 建玉: 100株 × 1010 = 101,000 → cash = 500,000 − 101,000 = 398,990
    window.localStorage.setItem(
      K.paperBrokerAccount,
      JSON.stringify({
        positions: [{ id: "x", code: "7203", strategyId: "trend-follow", shares: 100, entryDate: "2026-04-10", entryPrice: 1010, entryReason: "GC" }],
        closedTrades: [],
        updatedAt: "",
      })
    );
    expect(loadPaperAccount().cash).toBe(399_000);
  });
});

describe("paperRepository: 資金管理設定", () => {
  it("未保存なら既定値", () => {
    expect(loadPaperBrokerSettings()).toEqual(DEFAULT_PAPER_BROKER_SETTINGS);
  });
  it("部分更新をマージして永続化", () => {
    const merged = savePaperBrokerSettings({ splits: 5 });
    expect(merged).toEqual({ ...DEFAULT_PAPER_BROKER_SETTINGS, splits: 5 });
    expect(loadPaperBrokerSettings().splits).toBe(5);
    expect(loadPaperBrokerSettings().capitalYen).toBe(DEFAULT_PAPER_BROKER_SETTINGS.capitalYen);
  });
  it("不正値（0以下・型不一致）は既定へ補完", () => {
    window.localStorage.setItem(K.paperBrokerSettings, JSON.stringify({ capitalYen: -1, splits: "x", killSwitchDrawdownPct: 0 }));
    expect(loadPaperBrokerSettings()).toEqual(DEFAULT_PAPER_BROKER_SETTINGS);
  });
});

describe("paperRepository: 値洗いスナップショット", () => {
  const snap: ValuationSnapshot = { asOf: "2026-07-15", prices: { "7203": 1100, "6758": 2050 } };

  it("未保存なら null（→ 全建値評価フォールバック）", () => {
    expect(loadValuationSnapshot()).toBeNull();
    expect(valuationPriceMap(null).size).toBe(0);
  });
  it("保存 → 読込でラウンドトリップ", () => {
    saveValuationSnapshot(snap);
    expect(loadValuationSnapshot()).toEqual(snap);
  });
  it("K.paperValuationSnapshot キーに保存される", () => {
    saveValuationSnapshot(snap);
    expect(window.localStorage.getItem(K.paperValuationSnapshot)).toBeTruthy();
  });
  it("破損 JSON は null へフォールバック", () => {
    window.localStorage.setItem(K.paperValuationSnapshot, "{ broken");
    expect(loadValuationSnapshot()).toBeNull();
  });
  it("不正価格（0・負・非数）は除外して読み込む", () => {
    window.localStorage.setItem(
      K.paperValuationSnapshot,
      JSON.stringify({ asOf: "2026-07-15", prices: { "7203": 1100, "6758": 0, "9984": -5, "8035": "x" } })
    );
    expect(loadValuationSnapshot()).toEqual({ asOf: "2026-07-15", prices: { "7203": 1100 } });
  });
  it("valuationPriceMap は computeEquity 用 Map を返す", () => {
    const m = valuationPriceMap(snap);
    expect(m.get("7203")).toBe(1100);
    expect(m.get("6758")).toBe(2050);
    expect(m.size).toBe(2);
  });
});
