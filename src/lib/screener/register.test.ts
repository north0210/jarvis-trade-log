import { describe, it, expect } from "vitest";
import { gradeToRank, screenerRowToStockInput, planRegister } from "./register";
import type { ScreenerRow } from "./technical";

function row(over: Partial<ScreenerRow> = {}): ScreenerRow {
  return {
    code: "7203",
    name: "トヨタ自動車",
    sector: "輸送用機器",
    market: "プライム",
    price: 3319,
    rsi: 46.7,
    macd: "不明",
    relativeVolume: 1.2,
    score: 80,
    grade: "A",
    per: 12.5,
    pbr: 1.1,
    roe: 9.8,
    operatingMargin: 10.2,
    salesGrowth: 5.5,
    fundamentalsBasis: "FY",
    fundamentalsAsOf: "2026-03-31",
    fundamentalsAvailable: true,
    ...over,
  };
}
const CTX = { priceAsOf: "2026-04-10", generatedAt: "2026-07-06T00:00:00.000Z" };

describe("gradeToRank", () => {
  it("S/A/B/C は同値", () => {
    expect(gradeToRank("S")).toBe("S");
    expect(gradeToRank("A")).toBe("A");
    expect(gradeToRank("B")).toBe("B");
    expect(gradeToRank("C")).toBe("C");
  });
  it("D は C にクランプ（StockRank に D が無いため）", () => {
    expect(gradeToRank("D")).toBe("C");
  });
});

describe("screenerRowToStockInput", () => {
  it("全項目を転写（sector→theme・grade→rank・status=買い候補）", () => {
    const s = screenerRowToStockInput(row(), CTX);
    expect(s).toMatchObject({
      code: "7203",
      name: "トヨタ自動車",
      market: "プライム",
      theme: "輸送用機器", // sector → theme
      per: 12.5,
      pbr: 1.1,
      roe: 9.8,
      sales_growth: 5.5,
      operating_margin: 10.2,
      rsi: 46.7,
      macd: "不明",
      current_price: 3319,
      rank: "A", // grade
      status: "買い候補",
      price_updated_at: "2026-04-10", // priceAsOf 優先
      fundamentals_updated_at: "2026-03-31",
      fundamentals_basis: "FY",
    });
    // ユーザー入力待ちは null
    expect(s.stop_loss).toBeNull();
    expect(s.take_profit).toBeNull();
    expect(s.memo).toBeNull();
  });

  it("財務未取得の行は per/pbr/roe/margin/growth を null のまま登録", () => {
    const s = screenerRowToStockInput(
      row({ per: undefined, pbr: undefined, roe: undefined, operatingMargin: undefined, salesGrowth: undefined, fundamentalsBasis: null, fundamentalsAsOf: null, fundamentalsAvailable: false }),
      CTX
    );
    expect(s.per).toBeNull();
    expect(s.pbr).toBeNull();
    expect(s.roe).toBeNull();
    expect(s.operating_margin).toBeNull();
    expect(s.sales_growth).toBeNull();
    expect(s.fundamentals_updated_at).toBeUndefined();
  });

  it("priceAsOf 未指定なら generatedAt にフォールバック", () => {
    const s = screenerRowToStockInput(row(), { generatedAt: "2026-07-06T00:00:00.000Z" });
    expect(s.price_updated_at).toBe("2026-07-06T00:00:00.000Z");
  });

  it("D グレードは rank=C で登録", () => {
    expect(screenerRowToStockInput(row({ grade: "D" }), CTX).rank).toBe("C");
  });
});

describe("planRegister（重複は非破壊スキップ）", () => {
  it("既登録 code は skip", () => {
    const plan = planRegister(row({ code: "7203" }), new Set(["7203", "9984"]), CTX);
    expect(plan.skip).toBe(true);
    expect(plan.input).toBeUndefined();
  });
  it("未登録 code は転写した input を返す", () => {
    const plan = planRegister(row({ code: "6758" }), new Set(["7203"]), CTX);
    expect(plan.skip).toBe(false);
    expect(plan.input?.code).toBe("6758");
    expect(plan.input?.status).toBe("買い候補");
  });
});
