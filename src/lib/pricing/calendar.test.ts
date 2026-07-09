// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JQuantsResponse } from "./jquantsClient";

const h = vi.hoisted(() => ({ fetchCal: vi.fn<() => Promise<JQuantsResponse>>() }));
vi.mock("./jquantsClient", () => ({ fetchJQuantsCalendar: h.fetchCal }));

import {
  timeToMinutes,
  jstParts,
  parseTradingDays,
  computeExpectedAsOf,
  loadTradingCalendar,
  saveTradingCalendar,
  isCalendarFresh,
  expectedAsOf,
  resolveExpectedAsOf,
  staticExpectedAsOf,
  isDataStale,
  ensureTradingCalendar,
  refreshTradingCalendar,
  PUBLISH_TIME_JST,
  PUBLISH_BUFFER_MIN,
  EXPECTED_LAG_TRADING_DAYS,
  CALENDAR_TTL_MS,
  STATIC_FALLBACK_TOLERANCE_TRADING_DAYS,
} from "./calendar";

/** JST 壁時計 (y-m-d H:M) を表す UTC 実体の Date を作る（JST=UTC+9）。 */
function jst(y: number, m: number, d: number, H: number, M = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, H - 9, M));
}

// 2026年7月の営業日（土日・海の日 7/20 を除外）。
// 7/3(金) 7/6(月) 7/7(火) 7/8(水) 7/9(木) 7/10(金) 7/13(月) 7/14 7/15 7/16 7/17(金) 7/21(火) ...
const TRADING = [
  "2026-07-03", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
  "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
  "2026-07-21", "2026-07-22",
];

beforeEach(() => {
  window.localStorage.clear();
  h.fetchCal.mockReset();
});

describe("定数（一元定義）", () => {
  it("PUBLISH/LAG/TTL", () => {
    expect(PUBLISH_TIME_JST).toBe("16:30");
    expect(PUBLISH_BUFFER_MIN).toBe(60);
    expect(EXPECTED_LAG_TRADING_DAYS).toBe(0); // Light
    expect(CALENDAR_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(STATIC_FALLBACK_TOLERANCE_TRADING_DAYS).toBe(2);
  });
});

describe("timeToMinutes / jstParts", () => {
  it("16:30 → 990 分", () => {
    expect(timeToMinutes("16:30")).toBe(990);
  });
  it("JST 変換（10:00 JST）", () => {
    expect(jstParts(jst(2026, 7, 6, 10, 0))).toEqual({ ymd: "2026-07-06", minutes: 600 });
  });
  it("日跨ぎ（JST 00:30 は UTC 前日 15:30）", () => {
    expect(jstParts(jst(2026, 7, 6, 0, 30))).toEqual({ ymd: "2026-07-06", minutes: 30 });
  });
});

describe("parseTradingDays（HolDiv 1,2 のみ）", () => {
  it("営業日(1)・半日(2)を採用、非営業(0,3)を除外・昇順", () => {
    const days = parseTradingDays([
      { Date: "2026-07-06", HolDiv: "1" },
      { Date: "2026-07-04", HolDiv: "0" }, // 土
      { Date: "2026-07-20", HolDiv: "3" }, // 祝日
      { Date: "2026-07-07", HolDiv: "2" }, // 半日
      { Date: "", HolDiv: "1" },
    ]);
    expect(days).toEqual(["2026-07-06", "2026-07-07"]);
  });
});

describe("computeExpectedAsOf（Task 2-1 a〜e）", () => {
  it("(a) 平日 10:00 JST → 前営業日", () => {
    // 7/9(木) 10:00 → 配信前 → 前営業日 7/8(水)
    expect(computeExpectedAsOf(jst(2026, 7, 9, 10, 0), TRADING)).toBe("2026-07-08");
  });
  it("(b) 平日 18:00 JST → 当日", () => {
    // 7/9(木) 18:00 → 16:30+60=17:30 以降 → 当日 7/9
    expect(computeExpectedAsOf(jst(2026, 7, 9, 18, 0), TRADING)).toBe("2026-07-09");
  });
  it("(c) 土曜 → 直前の金曜", () => {
    // 7/11(土) → 非営業 → 直前営業日 7/10(金)
    expect(computeExpectedAsOf(jst(2026, 7, 11, 12, 0), TRADING)).toBe("2026-07-10");
  });
  it("(d) 祝日 2026-07-20(海の日) → 直前の営業日", () => {
    // 7/20(月・祝) → 非営業 → 直前営業日 7/17(金)
    expect(computeExpectedAsOf(jst(2026, 7, 20, 12, 0), TRADING)).toBe("2026-07-17");
  });
  it("(e) 月曜 09:00 JST → 前週金曜", () => {
    // 7/6(月) 09:00 → 配信前 → 直前営業日 7/3(金)
    expect(computeExpectedAsOf(jst(2026, 7, 6, 9, 0), TRADING)).toBe("2026-07-03");
  });
  it("16:30 ちょうどは buffer 未満で当日にならない（17:29→前日 / 17:30→当日）", () => {
    expect(computeExpectedAsOf(jst(2026, 7, 9, 17, 29), TRADING)).toBe("2026-07-08");
    expect(computeExpectedAsOf(jst(2026, 7, 9, 17, 30), TRADING)).toBe("2026-07-09");
  });
  it("EXPECTED_LAG_TRADING_DAYS を上げると過去営業日へ（Free 復帰相当）", () => {
    // lag=1: 7/9 18:00 の当日(7/9)から1営業日過去 → 7/8
    expect(computeExpectedAsOf(jst(2026, 7, 9, 18, 0), TRADING, 1)).toBe("2026-07-08");
    // lag=2 → 7/7
    expect(computeExpectedAsOf(jst(2026, 7, 9, 18, 0), TRADING, 2)).toBe("2026-07-07");
  });
  it("空カレンダーは空文字（フォールバックは 2-2）", () => {
    expect(computeExpectedAsOf(jst(2026, 7, 9, 18, 0), [])).toBe("");
  });
});

describe("キャッシュ（localStorage・TTL）", () => {
  it("save→load 往復・TTL 判定", () => {
    const now = jst(2026, 7, 9, 12, 0);
    saveTradingCalendar({ fetchedAt: now.toISOString(), tradingDays: TRADING });
    const loaded = loadTradingCalendar();
    expect(loaded?.tradingDays).toEqual(TRADING);
    expect(isCalendarFresh(loaded, now)).toBe(true);
    const later = new Date(now.getTime() + CALENDAR_TTL_MS + 1000);
    expect(isCalendarFresh(loaded, later)).toBe(false);
  });
  it("破損データは load で null", () => {
    window.localStorage.setItem("jarvis-trade-log:market-calendar", "{壊れ");
    expect(loadTradingCalendar()).toBeNull();
  });
  it("expectedAsOf はキャッシュを使う（未キャッシュは静的フォールバックへ）", () => {
    // 未キャッシュでも空文字ではなく静的推定を返す（2-2 フォールバック）。
    expect(expectedAsOf(jst(2026, 7, 9, 18, 0))).toBe("2026-07-09");
    saveTradingCalendar({ fetchedAt: jst(2026, 7, 9, 9, 0).toISOString(), tradingDays: TRADING });
    expect(expectedAsOf(jst(2026, 7, 9, 18, 0))).toBe("2026-07-09");
  });
});

describe("staticExpectedAsOf（土日のみ判定・祝日は無視）", () => {
  it("平日 18:00 → 当日（配信済み）", () => {
    expect(staticExpectedAsOf(jst(2026, 7, 9, 18, 0))).toBe("2026-07-09"); // 木
  });
  it("平日 10:00 → 前平日（配信前）", () => {
    expect(staticExpectedAsOf(jst(2026, 7, 9, 10, 0))).toBe("2026-07-08"); // 木→前平日 水
  });
  it("土曜 → 直前金曜", () => {
    expect(staticExpectedAsOf(jst(2026, 7, 11, 12, 0))).toBe("2026-07-10");
  });
  it("日曜 → 直前金曜", () => {
    expect(staticExpectedAsOf(jst(2026, 7, 12, 12, 0))).toBe("2026-07-10");
  });
  it("月曜 09:00 → 前週金曜（配信前）", () => {
    expect(staticExpectedAsOf(jst(2026, 7, 6, 9, 0))).toBe("2026-07-03");
  });
  it("祝日は判定できない（海の日 7/20 でも平日扱いで当日）", () => {
    // 静的判定は祝日を知らない → 7/20(月) 18:00 は「配信済み平日」= 7/20 を返す。
    // このズレを tolerance=2 で吸収する設計。
    expect(staticExpectedAsOf(jst(2026, 7, 20, 18, 0))).toBe("2026-07-20");
  });
});

describe("resolveExpectedAsOf（フォールバック内蔵・console.warn）", () => {
  it("鮮度内キャッシュ → source=calendar, tolerance=0, warn なし", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = jst(2026, 7, 9, 18, 0);
    saveTradingCalendar({ fetchedAt: jst(2026, 7, 9, 9, 0).toISOString(), tradingDays: TRADING });
    const r = resolveExpectedAsOf(now);
    expect(r).toEqual({ date: "2026-07-09", source: "calendar", toleranceTradingDays: 0 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("期限切れキャッシュ → source=calendar-stale, tolerance=0, warn あり（stale-while-error）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 25h 前に取得 → TTL(24h) 超過。判定時刻は 7/9 18:00。
    saveTradingCalendar({ fetchedAt: jst(2026, 7, 8, 17, 0).toISOString(), tradingDays: TRADING });
    const r = resolveExpectedAsOf(jst(2026, 7, 9, 18, 0));
    expect(r.source).toBe("calendar-stale");
    expect(r.date).toBe("2026-07-09"); // 期限切れでも同じ営業日集合で判定
    expect(r.toleranceTradingDays).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("キャッシュ皆無 → source=static, tolerance=2, warn あり", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = resolveExpectedAsOf(jst(2026, 7, 9, 18, 0));
    expect(r.source).toBe("static");
    expect(r.date).toBe("2026-07-09");
    expect(r.toleranceTradingDays).toBe(STATIC_FALLBACK_TOLERANCE_TRADING_DAYS);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warn は鍵・個人情報を含まない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveExpectedAsOf(jst(2026, 7, 9, 18, 0)); // static 経路
    const msg = String(warn.mock.calls[0]?.[0] ?? "");
    expect(msg).not.toMatch(/key|token|apiKey|password|@/i);
    warn.mockRestore();
  });
});

describe("isDataStale（鮮度判定）", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("カレンダーあり（tolerance 0）: expected 未満のみ stale", () => {
    saveTradingCalendar({ fetchedAt: jst(2026, 7, 9, 9, 0).toISOString(), tradingDays: TRADING });
    const now = jst(2026, 7, 9, 18, 0); // expected = 2026-07-09
    expect(isDataStale("2026-07-09", now)).toMatchObject({ stale: false, expected: "2026-07-09", toleranceTradingDays: 0 });
    expect(isDataStale("2026-07-08", now).stale).toBe(true); // 1営業日でも古ければ stale
    expect(isDataStale(null, now).stale).toBe(true); // 未取得は stale
  });

  it("静的フォールバック（tolerance 2）: 最大2営業日の欠落は stale 扱いしない", () => {
    const now = jst(2026, 7, 9, 18, 0); // static expected = 2026-07-09（木）
    const r = isDataStale("2026-07-07", now); // 2営業日前（threshold=2営業日戻し）
    expect(r.source).toBe("static");
    expect(r.toleranceTradingDays).toBe(2);
    expect(r.threshold).toBe("2026-07-07"); // 07-09 から2平日戻し
    expect(r.stale).toBe(false); // threshold ちょうどは fresh
    expect(isDataStale("2026-07-06", now).stale).toBe(true); // threshold 未満は stale
  });
});

describe("ensureTradingCalendar（鮮度内は no-op）", () => {
  it("鮮度内キャッシュがあれば取得しない", async () => {
    saveTradingCalendar({ fetchedAt: jst(2026, 7, 9, 9, 0).toISOString(), tradingDays: TRADING });
    const ok = await ensureTradingCalendar({ apiKey: "dummy" }, jst(2026, 7, 9, 18, 0));
    expect(ok).toBe(true);
    expect(h.fetchCal).not.toHaveBeenCalled();
  });
  it("キャッシュが無ければ取得する", async () => {
    h.fetchCal.mockResolvedValue({ ok: true, status: "connected", calendar: [{ Date: "2026-07-09", HolDiv: "1" }] });
    const ok = await ensureTradingCalendar({ apiKey: "dummy" }, jst(2026, 7, 9, 18, 0));
    expect(ok).toBe(true);
    expect(h.fetchCal).toHaveBeenCalledTimes(1);
  });
});

describe("refreshTradingCalendar（取得→キャッシュ）", () => {
  it("成功時に営業日を保存", async () => {
    h.fetchCal.mockResolvedValue({ ok: true, status: "connected", calendar: [
      { Date: "2026-07-08", HolDiv: "1" }, { Date: "2026-07-09", HolDiv: "1" }, { Date: "2026-07-11", HolDiv: "0" },
    ] });
    const ok = await refreshTradingCalendar({ apiKey: "dummy" }, jst(2026, 7, 9, 8, 0));
    expect(ok).toBe(true);
    expect(loadTradingCalendar()?.tradingDays).toEqual(["2026-07-08", "2026-07-09"]);
  });
  it("失敗時は false・保存しない", async () => {
    h.fetchCal.mockResolvedValue({ ok: false, status: "error", reason: "rate" });
    const ok = await refreshTradingCalendar({ apiKey: "dummy" }, jst(2026, 7, 9, 8, 0));
    expect(ok).toBe(false);
    expect(loadTradingCalendar()).toBeNull();
  });
});
