// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScreenerSnapshot } from "./screenerRepository";
import type { ScreenerRow } from "./technical";
import type { ScreenerRunResult } from "./screenerRun";

const h = vi.hoisted(() => ({
  probe: vi.fn(),
  mode: vi.fn(() => "jquants-ready" as string),
  loadSnap: vi.fn<() => ScreenerSnapshot | null>(),
  run: vi.fn<() => Promise<ScreenerRunResult>>(),
}));

vi.mock("@/lib/pricing/jquantsClient", () => ({ fetchJQuantsBarsByDate: h.probe }));
vi.mock("@/lib/pricing/settings", () => ({ getProviderMode: h.mode, getJQuantsCredentials: () => ({ apiKey: "dummy-key" }) }));
vi.mock("./screenerRepository", () => ({ loadScreenerSnapshot: h.loadSnap }));
vi.mock("./screenerRun", () => ({ runScreener: h.run }));

import { __setJQuantsRateLimiter } from "@/lib/pricing/rateLimiter";
import {
  periodKeyOf,
  isLocked,
  screenerDue,
  buildFinsReuseMap,
  getScreenerAutoSettings,
  setScreenerAutoSettings,
  runScreenerAuto,
  type ScreenerAutoSettings,
} from "./screenerAuto";

const WEEKDAY = new Date(2026, 6, 6); // 2026-07-06 月曜
const WEEKEND = new Date(2026, 6, 4); // 2026-07-04 土曜

function settings(over: Partial<ScreenerAutoSettings> = {}): ScreenerAutoSettings {
  return { enabled: true, frequency: "daily", lastCheckedPeriod: null, lockUntil: null, ...over };
}
function fRow(code: string, over: Partial<ScreenerRow> = {}): ScreenerRow {
  return { code, name: code, sector: "情報通信", market: "プライム", price: 1000, rsi: 55, macd: "不明", relativeVolume: 1, score: 40, grade: "C", per: 15, pbr: 2, roe: 10, operatingMargin: 12, salesGrowth: 5, fundamentalsBasis: "FY", fundamentalsAsOf: "2026-06-01", fundamentalsAvailable: true, ...over };
}
function snap(over: Partial<ScreenerSnapshot> = {}): ScreenerSnapshot {
  return { generatedAt: "2026-07-05T00:00:00.000Z", priceAsOf: "2026-04-09", universeCount: 3752, rows: [fRow("7203")], ...over };
}

beforeEach(() => {
  window.localStorage.clear();
  h.probe.mockReset();
  h.mode.mockReset().mockReturnValue("jquants-ready");
  h.loadSnap.mockReset().mockReturnValue(null);
  h.run.mockReset();
  __setJQuantsRateLimiter({ acquire: vi.fn().mockResolvedValue(undefined) });
});

describe("periodKeyOf", () => {
  it("daily=YYYY-MM-DD", () => {
    expect(periodKeyOf(WEEKDAY, "daily")).toBe("2026-07-06");
  });
  it("weekly は同一週で同値・翌週で異値", () => {
    const w1 = periodKeyOf(new Date(2026, 6, 6), "weekly");
    const w1b = periodKeyOf(new Date(2026, 6, 8), "weekly"); // 同週
    const w2 = periodKeyOf(new Date(2026, 6, 15), "weekly"); // 翌週以降
    expect(w1).toBe(w1b);
    expect(w1).not.toBe(w2);
  });
});

describe("isLocked / screenerDue", () => {
  it("無効/週末/チェック済/ロック中は due=false", () => {
    expect(screenerDue(settings({ enabled: false }), WEEKDAY).reason).toBe("disabled");
    expect(screenerDue(settings(), WEEKEND).reason).toBe("weekend");
    expect(screenerDue(settings({ lastCheckedPeriod: "2026-07-06" }), WEEKDAY).reason).toBe("already-checked");
    expect(screenerDue(settings({ lockUntil: new Date(WEEKDAY.getTime() + 60000).toISOString() }), WEEKDAY).reason).toBe("locked");
  });
  it("平日・未チェック・非ロックは due=true", () => {
    expect(screenerDue(settings(), WEEKDAY)).toEqual({ due: true, reason: "due" });
  });
  it("isLocked は期限で判定", () => {
    expect(isLocked(settings({ lockUntil: new Date(WEEKDAY.getTime() + 1000).toISOString() }), WEEKDAY)).toBe(true);
    expect(isLocked(settings({ lockUntil: new Date(WEEKDAY.getTime() - 1000).toISOString() }), WEEKDAY)).toBe(false);
  });
});

describe("buildFinsReuseMap", () => {
  it("財務取得済み＆asOf が新しい code を再利用", () => {
    const m = buildFinsReuseMap(snap({ rows: [fRow("7203", { fundamentalsAsOf: "2026-06-01" })] }), WEEKDAY);
    expect(m.has("7203")).toBe(true);
    expect(m.get("7203")?.per).toBe(15);
  });
  it("財務未取得は再利用しない", () => {
    const m = buildFinsReuseMap(snap({ rows: [fRow("7203", { fundamentalsAvailable: false })] }), WEEKDAY);
    expect(m.has("7203")).toBe(false);
  });
  it("asOf が古い（90日超）は再取得のため再利用しない", () => {
    const m = buildFinsReuseMap(snap({ rows: [fRow("7203", { fundamentalsAsOf: "2026-01-01" })] }), WEEKDAY);
    expect(m.has("7203")).toBe(false);
  });
});

describe("runScreenerAuto（オーケストレーション）", () => {
  it("無効なら実行しない", async () => {
    setScreenerAutoSettings({ enabled: false });
    const r = await runScreenerAuto({ now: WEEKDAY });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe("disabled");
    expect(h.probe).not.toHaveBeenCalled();
  });

  it("手入力モードなら実行しない", async () => {
    setScreenerAutoSettings({ enabled: true });
    h.mode.mockReturnValue("manual");
    const r = await runScreenerAuto({ now: WEEKDAY });
    expect(r).toMatchObject({ ran: false, reason: "manual-mode" });
  });

  it("アンカー前進 → runScreener 実行・lastCheckedPeriod 記録", async () => {
    setScreenerAutoSettings({ enabled: true });
    h.loadSnap.mockReturnValue(snap({ priceAsOf: "2026-04-09" }));
    h.probe.mockResolvedValue({ ok: true, status: "connected", date: "2026-04-10", bars: [], pages: 1 });
    h.run.mockResolvedValue({ ok: true, stopped: null, snapshot: snap(), message: "完了", finsCovered: 1, finsMissing: 0 });
    const r = await runScreenerAuto({ now: WEEKDAY });
    expect(r.ran).toBe(true);
    expect(h.run).toHaveBeenCalledTimes(1);
    // fins 再利用マップ＋probe 済みアンカーが渡る
    const runOpts = h.run.mock.calls[0][1] as { anchorDate?: string; reuseFundamentals?: Map<string, unknown> };
    expect(runOpts.anchorDate).toBe("2026-04-10");
    expect(runOpts.reuseFundamentals?.has("7203")).toBe(true);
    expect(getScreenerAutoSettings().lastCheckedPeriod).toBe("2026-07-06");
    expect(getScreenerAutoSettings().lockUntil).toBeNull(); // ロック解放
  });

  it("アンカー前進なし → skip・チェック済みにする（フル更新しない）", async () => {
    setScreenerAutoSettings({ enabled: true });
    h.loadSnap.mockReturnValue(snap({ priceAsOf: "2026-04-10" }));
    h.probe.mockResolvedValue({ ok: true, status: "connected", date: "2026-04-10", bars: [], pages: 1 });
    const r = await runScreenerAuto({ now: WEEKDAY });
    expect(r).toMatchObject({ ran: false, reason: "no-new-data" });
    expect(h.run).not.toHaveBeenCalled();
    expect(getScreenerAutoSettings().lastCheckedPeriod).toBe("2026-07-06");
  });

  it("probe 失敗 → 実行せずチェック済みにしない（翌起動で再試行）", async () => {
    setScreenerAutoSettings({ enabled: true });
    h.probe.mockResolvedValue({ ok: false, status: "error", reason: "rate", message: "レート制限" });
    const r = await runScreenerAuto({ now: WEEKDAY });
    expect(r).toMatchObject({ ran: false, reason: "probe-failed" });
    expect(getScreenerAutoSettings().lastCheckedPeriod).toBeNull();
    expect(getScreenerAutoSettings().lockUntil).toBeNull();
  });

  it("runScreener 破棄 → チェック済みにしない", async () => {
    setScreenerAutoSettings({ enabled: true });
    h.loadSnap.mockReturnValue(snap({ priceAsOf: "2026-04-09" }));
    h.probe.mockResolvedValue({ ok: true, status: "connected", date: "2026-04-10", bars: [], pages: 1 });
    h.run.mockResolvedValue({ ok: false, stopped: "rate", snapshot: null, message: "中断", finsCovered: 0, finsMissing: 0 });
    const r = await runScreenerAuto({ now: WEEKDAY });
    expect(r).toMatchObject({ ran: false, reason: "discarded" });
    expect(getScreenerAutoSettings().lastCheckedPeriod).toBeNull();
  });
});
