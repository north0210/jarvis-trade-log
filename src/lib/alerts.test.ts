import { describe, it, expect } from "vitest";
import {
  pnl,
  stockAlerts,
  holdingAlerts,
  holdingDangerLevel,
  STOP_NEAR_THRESHOLD,
  RSI_HOT,
  LOSS_DANGER_PCT,
  TAKE_PROFIT_PCT,
} from "@/lib/alerts";
import type { Stock, Holding } from "@/lib/types";

// ---- テスト用ファクトリ（本体コードは不変・テスト内のみ） ----
const makeStock = (o: Partial<Stock> = {}): Stock => ({
  id: "s1",
  code: "7203",
  name: "テスト銘柄",
  market: null,
  theme: null,
  per: null,
  pbr: null,
  roe: null,
  sales_growth: null,
  operating_margin: null,
  rsi: null,
  macd: "不明",
  current_price: null,
  stop_loss: null,
  take_profit: null,
  rank: "B",
  status: "買い候補",
  memo: null,
  price_updated_at: null,
  ...o,
});

const makeHolding = (o: Partial<Holding> = {}): Holding => ({
  id: "h1",
  stock_id: "s1",
  buy_price: 100,
  shares: 10,
  stop_loss: null,
  take_profit: null,
  ...o,
});

const kinds = (a: { kind: string }[]) => a.map((x) => x.kind);

describe("しきい値定数（仕様の固定）", () => {
  it("既定値が仕様どおり", () => {
    expect(STOP_NEAR_THRESHOLD).toBe(0.03);
    expect(RSI_HOT).toBe(80);
    expect(LOSS_DANGER_PCT).toBe(-5);
    expect(TAKE_PROFIT_PCT).toBe(20);
  });
});

describe("pnl（損益計算・0除算防止）", () => {
  it("通常の損益率を算出", () => {
    const r = pnl({ buy_price: 100, shares: 10 }, 110);
    expect(r.value).toBe(1100);
    expect(r.cost).toBe(1000);
    expect(r.diff).toBe(100);
    expect(r.pct).toBeCloseTo(10, 10);
  });
  it("取得原価0（buy_price=0）は pct=0（0除算しない）", () => {
    const r = pnl({ buy_price: 0, shares: 10 }, 100);
    expect(r.cost).toBe(0);
    expect(r.pct).toBe(0);
  });
});

describe("stockAlerts: 損切り（STOP_HIT / STOP_NEAR）境界値", () => {
  it("損切りライン丁度（price == stop）→ STOP_HIT（STOP_NEARは出ない）", () => {
    const a = stockAlerts(makeStock({ current_price: 100, stop_loss: 100 }));
    expect(kinds(a)).toContain("STOP_HIT");
    expect(kinds(a)).not.toContain("STOP_NEAR");
  });
  it("損切りライン未満（price < stop）→ STOP_HIT", () => {
    const a = stockAlerts(makeStock({ current_price: 99, stop_loss: 100 }));
    expect(kinds(a)).toContain("STOP_HIT");
  });
  it("+3%丁度（(price-stop)/price == 0.03）→ STOP_NEAR", () => {
    // price=100, stop=97 → (100-97)/100 = 0.03 = しきい値ちょうど（<=で発火）
    const a = stockAlerts(makeStock({ current_price: 100, stop_loss: 97 }));
    expect(kinds(a)).toContain("STOP_NEAR");
    expect(kinds(a)).not.toContain("STOP_HIT");
  });
  it("+3%をわずかに超える（0.04）→ アラートなし", () => {
    // price=100, stop=96 → 0.04 > 0.03
    const a = stockAlerts(makeStock({ current_price: 100, stop_loss: 96 }));
    expect(kinds(a)).not.toContain("STOP_NEAR");
    expect(kinds(a)).not.toContain("STOP_HIT");
  });
  it("十分上方（price >> stop）→ 損切り系アラートなし", () => {
    const a = stockAlerts(makeStock({ current_price: 200, stop_loss: 100 }));
    expect(a.length).toBe(0);
  });
});

describe("stockAlerts: 損切りラインの無効値ガード", () => {
  it("stop_loss = null → 判定しない", () => {
    const a = stockAlerts(makeStock({ current_price: 100, stop_loss: null }));
    expect(a.length).toBe(0);
  });
  it("stop_loss = 0（stop>0 ガード）→ 判定しない", () => {
    const a = stockAlerts(makeStock({ current_price: 100, stop_loss: 0 }));
    expect(kinds(a)).not.toContain("STOP_HIT");
    expect(kinds(a)).not.toContain("STOP_NEAR");
  });
  it("current_price = null（未入力）→ 損切り判定しない", () => {
    const a = stockAlerts(makeStock({ current_price: null, stop_loss: 100 }));
    expect(kinds(a)).not.toContain("STOP_HIT");
    expect(kinds(a)).not.toContain("STOP_NEAR");
  });
});

describe("stockAlerts: RSI_HOT 境界値", () => {
  it("RSI = 80 丁度 → RSI_HOT（>=で発火）", () => {
    const a = stockAlerts(makeStock({ rsi: 80 }));
    expect(kinds(a)).toContain("RSI_HOT");
  });
  it("RSI = 79.9 → 発火しない", () => {
    const a = stockAlerts(makeStock({ rsi: 79.9 }));
    expect(kinds(a)).not.toContain("RSI_HOT");
  });
  it("RSI = null（未入力）→ 発火しない", () => {
    const a = stockAlerts(makeStock({ rsi: null }));
    expect(kinds(a)).not.toContain("RSI_HOT");
  });
  it("価格未入力でも RSI>=80 なら RSI_HOT は発火（価格に非依存）", () => {
    const a = stockAlerts(makeStock({ current_price: null, rsi: 85 }));
    expect(kinds(a)).toEqual(["RSI_HOT"]);
  });
  it("STOP_HIT と RSI_HOT は同時発火しうる", () => {
    const a = stockAlerts(makeStock({ current_price: 100, stop_loss: 100, rsi: 90 }));
    expect(kinds(a)).toContain("STOP_HIT");
    expect(kinds(a)).toContain("RSI_HOT");
  });
});

describe("holdingAlerts: 損益率（LOSS_DANGER / TAKE_PROFIT）境界値", () => {
  it("損益率 -5% 丁度 → LOSS_DANGER（<=で発火）", () => {
    // buy 100, price 95, shares 10 → pct = -5
    const a = holdingAlerts(makeHolding({ buy_price: 100, shares: 10 }), makeStock({ current_price: 95 }));
    expect(kinds(a)).toContain("LOSS_DANGER");
    expect(kinds(a)).not.toContain("TAKE_PROFIT");
  });
  it("損益率 -4.9% → LOSS_DANGER 発火しない", () => {
    const a = holdingAlerts(makeHolding({ buy_price: 100 }), makeStock({ current_price: 95.1 }));
    expect(kinds(a)).not.toContain("LOSS_DANGER");
  });
  it("損益率 +20% 丁度 → TAKE_PROFIT（>=で発火）", () => {
    const a = holdingAlerts(makeHolding({ buy_price: 100 }), makeStock({ current_price: 120 }));
    expect(kinds(a)).toContain("TAKE_PROFIT");
    expect(kinds(a)).not.toContain("LOSS_DANGER");
  });
  it("損益率 +19.9% → TAKE_PROFIT 発火しない", () => {
    const a = holdingAlerts(makeHolding({ buy_price: 100 }), makeStock({ current_price: 119.9 }));
    expect(kinds(a)).not.toContain("TAKE_PROFIT");
  });
  it("current_price = null → 損益率判定しない", () => {
    const a = holdingAlerts(makeHolding({ buy_price: 100 }), makeStock({ current_price: null }));
    expect(kinds(a)).not.toContain("LOSS_DANGER");
    expect(kinds(a)).not.toContain("TAKE_PROFIT");
  });
  it("取得原価0（buy_price=0）→ pct=0 のため損益系は発火しない", () => {
    const a = holdingAlerts(makeHolding({ buy_price: 0 }), makeStock({ current_price: 100 }));
    expect(kinds(a)).not.toContain("LOSS_DANGER");
    expect(kinds(a)).not.toContain("TAKE_PROFIT");
  });
});

describe("holdingAlerts: 損切りラインは保有側を優先", () => {
  it("h.stop_loss が s.stop_loss を上書き（h優先で STOP_HIT）", () => {
    const a = holdingAlerts(
      makeHolding({ stop_loss: 100 }),
      makeStock({ current_price: 100, stop_loss: 50 })
    );
    expect(kinds(a)).toContain("STOP_HIT");
  });
  it("h.stop_loss=null なら s.stop_loss を使用", () => {
    const a = holdingAlerts(
      makeHolding({ stop_loss: null }),
      makeStock({ current_price: 100, stop_loss: 100 })
    );
    expect(kinds(a)).toContain("STOP_HIT");
  });
});

describe("holdingDangerLevel: 総合レベルの優先順位", () => {
  it("danger を最優先（STOP_HIT + TAKE_PROFIT 併発時も danger）", () => {
    // 損切り到達 かつ 別条件でprofitは通常両立しないが、STOP_HIT(danger)を確実に返すこと
    const level = holdingDangerLevel(
      makeHolding({ buy_price: 100, stop_loss: 100 }),
      makeStock({ current_price: 100 })
    );
    expect(level).toBe("danger");
  });
  it("profit（利確検討のみ）→ profit", () => {
    const level = holdingDangerLevel(makeHolding({ buy_price: 100 }), makeStock({ current_price: 130 }));
    expect(level).toBe("profit");
  });
  it("caution（RSI過熱のみ）→ caution", () => {
    const level = holdingDangerLevel(makeHolding({ buy_price: 100 }), makeStock({ current_price: 105, rsi: 85 }));
    expect(level).toBe("caution");
  });
  it("該当なし → null", () => {
    const level = holdingDangerLevel(makeHolding({ buy_price: 100 }), makeStock({ current_price: 105, rsi: 50 }));
    expect(level).toBeNull();
  });
});
