import { describe, it, expect } from "vitest";
import {
  toJQuantsCode,
  pickApiKey,
  mapDailyBar,
  mapDailyBars,
  deriveQuote,
  buildDailyBarsUrl,
  JQUANTS_V2_BASE,
  type V2DailyBar,
} from "./jquantsV2";

// ※ APIキーは全てダミー値。実キーはコード・テストに一切含めない。
const DUMMY_KEY = "dummy-env-key";
const DUMMY_BODY_KEY = "dummy-body-key";

describe("toJQuantsCode", () => {
  it("4桁は末尾0を付与して5桁化", () => {
    expect(toJQuantsCode("7203")).toBe("72030");
  });
  it("5桁はそのまま", () => {
    expect(toJQuantsCode("72030")).toBe("72030");
  });
  it("前後空白をトリムする", () => {
    expect(toJQuantsCode(" 7203 ")).toBe("72030");
  });
});

describe("pickApiKey（env 優先）", () => {
  it("env があれば env を採用", () => {
    expect(pickApiKey(DUMMY_KEY, DUMMY_BODY_KEY)).toBe(DUMMY_KEY);
  });
  it("env が空なら body を採用", () => {
    expect(pickApiKey("", DUMMY_BODY_KEY)).toBe(DUMMY_BODY_KEY);
    expect(pickApiKey(undefined, DUMMY_BODY_KEY)).toBe(DUMMY_BODY_KEY);
    expect(pickApiKey("   ", DUMMY_BODY_KEY)).toBe(DUMMY_BODY_KEY);
  });
  it("両方無ければ null", () => {
    expect(pickApiKey(undefined, undefined)).toBeNull();
    expect(pickApiKey("", "")).toBeNull();
  });
});

describe("mapDailyBar（V2フィールド → 内部日足）", () => {
  it("C を終値に、AdjC を調整後に、Vo を出来高に対応", () => {
    const bar: V2DailyBar = { Date: "2026-01-05", Code: "72030", C: 3100, AdjC: 3050, Vo: 12345 };
    expect(mapDailyBar(bar)).toEqual({ date: "2026-01-05", close: 3100, adjClose: 3050, volume: 12345 });
  });
  it("C が無ければ AdjC を終値に採用", () => {
    const bar: V2DailyBar = { Date: "2026-01-05", C: null, AdjC: 2900, Vo: null };
    expect(mapDailyBar(bar)).toEqual({ date: "2026-01-05", close: 2900, adjClose: 2900, volume: null });
  });
  it("Date 欠落は空文字", () => {
    expect(mapDailyBar({ C: 100 }).date).toBe("");
  });
});

describe("mapDailyBars（整形・昇順ソート・無効除外）", () => {
  it("日付昇順に整列し、終値null/空日付を除外", () => {
    const bars: V2DailyBar[] = [
      { Date: "2026-01-06", C: 110 },
      { Date: "2026-01-04", C: 100 },
      { Date: "2026-01-05", C: null }, // 除外
      { Date: "", C: 999 }, // 除外
    ];
    const out = mapDailyBars(bars);
    expect(out.map((b) => b.date)).toEqual(["2026-01-04", "2026-01-06"]);
  });
});

describe("deriveQuote（最新クオート導出）", () => {
  it("最新・前日から変化額/率を算出し、系列を返す", () => {
    const bars = mapDailyBars([
      { Date: "2026-01-04", C: 100, Vo: 10 },
      { Date: "2026-01-05", C: 110, Vo: 20 },
    ]);
    const q = deriveQuote("7203", bars);
    expect(q).not.toBeNull();
    expect(q!.current_price).toBe(110);
    expect(q!.previous_close).toBe(100);
    expect(q!.change).toBe(10);
    expect(q!.change_rate).toBeCloseTo(10, 5);
    expect(q!.date).toBe("2026-01-05");
    expect(q!.closes).toEqual([100, 110]); // 古い→新しい
    expect(q!.volumes).toEqual([10, 20]);
  });
  it("空配列は null", () => {
    expect(deriveQuote("7203", [])).toBeNull();
  });
  it("1件のみは previous_close/change を null に", () => {
    const bars = mapDailyBars([{ Date: "2026-01-05", C: 100 }]);
    const q = deriveQuote("7203", bars)!;
    expect(q.current_price).toBe(100);
    expect(q.previous_close).toBeNull();
    expect(q.change).toBeNull();
  });
});

describe("buildDailyBarsUrl", () => {
  it("V2 ベース + /equities/bars/daily + code(5桁) を含む", () => {
    const url = buildDailyBarsUrl({ code: "7203", from: "2026-01-01", to: "2026-01-31" });
    expect(url.startsWith(`${JQUANTS_V2_BASE}/equities/bars/daily?`)).toBe(true);
    expect(url).toContain("code=72030");
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-01-31");
  });
  it("pagination_key を付与できる", () => {
    const url = buildDailyBarsUrl({ code: "7203", paginationKey: "abc123" });
    expect(url).toContain("pagination_key=abc123");
  });
});
