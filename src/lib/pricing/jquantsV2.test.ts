import { describe, it, expect } from "vitest";
import {
  toJQuantsCode,
  pickApiKey,
  resolveApiKey,
  mapDailyBar,
  mapDailyBars,
  deriveQuote,
  buildDailyBarsUrl,
  parseSubscriptionRange,
  clampToCoverage,
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

describe("resolveApiKey（キー経路の可視化）", () => {
  it("env があれば source=env", () => {
    expect(resolveApiKey(DUMMY_KEY, DUMMY_BODY_KEY)).toEqual({ key: DUMMY_KEY, source: "env" });
  });
  it("env が空白のみなら横取りせず画面入力を採用（source=input）", () => {
    expect(resolveApiKey("   ", DUMMY_BODY_KEY)).toEqual({ key: DUMMY_BODY_KEY, source: "input" });
    expect(resolveApiKey("", DUMMY_BODY_KEY)).toEqual({ key: DUMMY_BODY_KEY, source: "input" });
    expect(resolveApiKey(undefined, DUMMY_BODY_KEY)).toEqual({ key: DUMMY_BODY_KEY, source: "input" });
  });
  it("両方空なら source=null（未設定）", () => {
    expect(resolveApiKey("", "")).toEqual({ key: null, source: null });
    expect(resolveApiKey(undefined, undefined)).toEqual({ key: null, source: null });
  });
  it("前後空白はトリムされる", () => {
    expect(resolveApiKey(undefined, "  k  ")).toEqual({ key: "k", source: "input" });
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
  it("AdjO があれば adjOpen を付与（翌営業日始値約定用）", () => {
    const bar: V2DailyBar = { Date: "2026-01-05", C: 3100, AdjC: 3050, AdjO: 3010, Vo: 12345 };
    expect(mapDailyBar(bar).adjOpen).toBe(3010);
  });
  it("AdjO が無ければ adjOpen キーは付与しない（後方互換）", () => {
    const out = mapDailyBar({ Date: "2026-01-05", C: 3100, AdjC: 3050, Vo: 1 });
    expect("adjOpen" in out).toBe(false);
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

describe("parseSubscriptionRange（範囲外400メッセージの解析）", () => {
  it("実メッセージから from ~ to を抽出", () => {
    const msg =
      "Your subscription covers the following dates: 2024-04-12 ~ 2026-04-12. If you want more data, please check other plans: https://jpx-jquants.com/#dataset";
    expect(parseSubscriptionRange(msg)).toEqual({ from: "2024-04-12", to: "2026-04-12" });
  });
  it("全角チルダにも対応", () => {
    expect(parseSubscriptionRange("... 2024-01-01 〜 2025-01-01 ...")).toEqual({ from: "2024-01-01", to: "2025-01-01" });
  });
  it("範囲が無ければ null", () => {
    expect(parseSubscriptionRange("Invalid parameter: code")).toBeNull();
  });
});

describe("clampToCoverage（幅保持クランプ）", () => {
  it("coverageEnd 未知なら無変更", () => {
    expect(clampToCoverage("2026-03-01", "2026-07-01", null)).toEqual({ from: "2026-03-01", to: "2026-07-01", clamped: false });
  });
  it("to がカバレッジ内なら無変更（有料プランは今日まで自然取得）", () => {
    expect(clampToCoverage("2026-01-01", "2026-04-01", "2026-04-12")).toEqual({ from: "2026-01-01", to: "2026-04-01", clamped: false });
  });
  it("to が範囲外なら幅を保って終端へ寄せる（120日窓の例）", () => {
    // to=2026-07-05 は範囲外 → 終端 2026-04-12、幅(=約120日)を保つ
    const r = clampToCoverage("2026-03-07", "2026-07-05", "2026-04-12");
    expect(r.clamped).toBe(true);
    expect(r.to).toBe("2026-04-12");
    // 幅 = 2026-07-05 - 2026-03-07 = 120日 → from = 2026-04-12 - 120日 = 2025-12-13
    expect(r.from).toBe("2025-12-13");
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
