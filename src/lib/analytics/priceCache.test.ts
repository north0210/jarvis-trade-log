// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { K } from "@/lib/storage/keys";
import {
  getCachedSeries,
  setCachedSeries,
  setCachePolicy,
  clearPriceCache,
  CACHE_SCHEMA_VERSION,
  type SeriesPoint,
} from "./priceCache";

const CODE = "7203";
const KEY = K.priceCache + CODE;

const series = (): SeriesPoint[] => [
  { date: "2026-01-05", close: 100, adjClose: 100, volume: 10, adjOpen: 99 },
  { date: "2026-01-06", close: 110, adjClose: 110, volume: 20, adjOpen: 108 },
];

beforeEach(() => {
  window.localStorage.clear();
  setCachePolicy("none"); // TTL 無期限にしてテストを時刻非依存に
});

describe("priceCache: 基本ラウンドトリップ", () => {
  it("保存 → 範囲内で取得（adjOpen を含む）", () => {
    setCachedSeries(CODE, "2026-01-01", "2026-01-31", series());
    const got = getCachedSeries(CODE, "2026-01-05", "2026-01-06");
    expect(got).not.toBeNull();
    expect(got!.map((p) => p.adjOpen)).toEqual([99, 108]);
  });
  it("保存時に schema 版 v を書き込む", () => {
    setCachedSeries(CODE, "2026-01-01", "2026-01-31", series());
    const raw = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(raw.v).toBe(CACHE_SCHEMA_VERSION);
  });
  it("範囲を包含しなければ null", () => {
    setCachedSeries(CODE, "2026-01-05", "2026-01-06", series());
    expect(getCachedSeries(CODE, "2026-01-01", "2026-01-31")).toBeNull();
  });
});

describe("priceCache: 版付き後方互換（requireOpen）", () => {
  /** 旧版(v なし・adjOpen なし)エントリを手で書き込む。 */
  function writeLegacyV1(): void {
    const entry = {
      code: CODE,
      from: "2026-01-01",
      to: "2026-01-31",
      fetchedAt: new Date().toISOString(),
      series: [
        { date: "2026-01-05", close: 100, adjClose: 100, volume: 10 },
        { date: "2026-01-06", close: 110, adjClose: 110, volume: 20 },
      ],
    };
    window.localStorage.setItem(KEY, JSON.stringify(entry));
  }

  it("旧版(v1)は requireOpen 未指定なら従来どおり返す（強制再取得しない）", () => {
    writeLegacyV1();
    const got = getCachedSeries(CODE, "2026-01-05", "2026-01-06");
    expect(got).not.toBeNull();
    expect(got!.map((p) => p.adjOpen)).toEqual([undefined, undefined]);
  });
  it("旧版(v1)は requireOpen=true で null（再取得を促す）", () => {
    writeLegacyV1();
    expect(getCachedSeries(CODE, "2026-01-05", "2026-01-06", { requireOpen: true })).toBeNull();
  });
  it("新版(v2)は requireOpen=true でも返す", () => {
    setCachedSeries(CODE, "2026-01-01", "2026-01-31", series());
    const got = getCachedSeries(CODE, "2026-01-05", "2026-01-06", { requireOpen: true });
    expect(got).not.toBeNull();
    expect(got!.length).toBe(2);
  });
});

describe("priceCache: クリア", () => {
  it("clearPriceCache で price-cache プレフィックスを削除", () => {
    setCachedSeries(CODE, "2026-01-01", "2026-01-31", series());
    clearPriceCache();
    expect(getCachedSeries(CODE, "2026-01-05", "2026-01-06")).toBeNull();
  });
});
