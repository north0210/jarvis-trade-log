import { describe, it, expect } from "vitest";
import {
  parseFinNum,
  mapFinRecord,
  selectPrimary,
  findPriorYear,
  computeFundamentals,
  elapsedLabel,
} from "./fundamentals";
import type { V2FinRecord } from "./jquantsV2";

/** 生レコード生成ヘルパ（数値は文字列で返る仕様を再現）。 */
function raw(o: Partial<V2FinRecord>): V2FinRecord {
  return o;
}

describe("parseFinNum（文字列数値のパース）", () => {
  it("数値文字列を number に", () => {
    expect(parseFinNum("100529000000")).toBe(100529000000);
    expect(parseFinNum("-500")).toBe(-500);
    expect(parseFinNum("12.5")).toBe(12.5);
  });
  it("空文字/非数値/欠損は null", () => {
    expect(parseFinNum("")).toBeNull();
    expect(parseFinNum("  ")).toBeNull();
    expect(parseFinNum("N/A")).toBeNull();
    expect(parseFinNum(undefined)).toBeNull();
  });
});

describe("elapsedLabel（開示日からの経過を動的表示）", () => {
  const now = Date.parse("2026-07-05");
  it("45日未満は日数表示", () => {
    expect(elapsedLabel("2026-07-01", now)).toBe("約4日前");
  });
  it("数ヶ月は月表示（四捨五入）", () => {
    expect(elapsedLabel("2026-04-12", now)).toBe("約3ヶ月前"); // 84日≈2.8ヶ月
  });
  it("本決算のような約14ヶ月前も月表示（固定注記の乖離を解消）", () => {
    expect(elapsedLabel("2025-05-08", now)).toBe("約14ヶ月前");
  });
  it("不正日付は空文字", () => {
    expect(elapsedLabel("bogus", now)).toBe("");
  });
});

describe("mapFinRecord", () => {
  it("DocType に Consolidated を含めば連結判定", () => {
    const r = mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2026-03-31", Sales: "1000", OP: "100", EPS: "150", BPS: "1500" }));
    expect(r.consolidated).toBe(true);
    expect(r.perType).toBe("FY");
    expect(r.sales).toBe(1000);
    expect(r.eps).toBe(150);
  });
  it("NonConsolidated は単体", () => {
    expect(mapFinRecord(raw({ DocType: "FYFinancialStatements_NonConsolidated_JP" })).consolidated).toBe(false);
  });
});

describe("selectPrimary（連結優先・FY優先・最新期末）", () => {
  const records = [
    mapFinRecord(raw({ DocType: "FYFinancialStatements_NonConsolidated_JP", CurPerType: "FY", CurPerEn: "2026-03-31" })),
    mapFinRecord(raw({ DocType: "3QFinancialStatements_Consolidated_IFRS", CurPerType: "3Q", CurPerEn: "2026-12-31" })),
    mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2026-03-31" })),
    mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2025-03-31" })),
  ];
  it("連結FYの最新を選ぶ（四半期や単体より優先）", () => {
    const p = selectPrimary(records)!;
    expect(p.consolidated).toBe(true);
    expect(p.perType).toBe("FY");
    expect(p.perEnd).toBe("2026-03-31");
  });
  it("FY が無ければ最新四半期にフォールバック", () => {
    const q = selectPrimary([
      mapFinRecord(raw({ DocType: "2QFinancialStatements_Consolidated_IFRS", CurPerType: "2Q", CurPerEn: "2026-09-30" })),
      mapFinRecord(raw({ DocType: "3QFinancialStatements_Consolidated_IFRS", CurPerType: "3Q", CurPerEn: "2026-12-31" })),
    ])!;
    expect(q.perType).toBe("3Q");
    expect(q.perEnd).toBe("2026-12-31");
  });
  it("空なら null", () => {
    expect(selectPrimary([])).toBeNull();
  });
});

describe("computeFundamentals", () => {
  it("PER/PBR/ROE/営業利益率/売上成長率を算出（連結FY・YoY）", () => {
    const records = [
      mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2026-03-31", DiscDate: "2026-05-10", Sales: "1200", OP: "120", NP: "90", Eq: "1000", EPS: "150", BPS: "1500" })),
      mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2025-03-31", DiscDate: "2025-05-10", Sales: "1000", OP: "100", NP: "80", Eq: "900", EPS: "140", BPS: "1400" })),
    ];
    const f = computeFundamentals(records, 3000);
    expect(f.per).toBe(20); // 3000 / 150
    expect(f.pbr).toBe(2); // 3000 / 1500
    expect(f.roe).toBe(10); // 150 / 1500 * 100
    expect(f.operatingMargin).toBe(10); // 120 / 1200 * 100
    expect(f.salesGrowth).toBe(20); // (1200-1000)/1000*100
    expect(f.basis).toBe("FY");
    expect(f.asOf).toBe("2026-05-10");
  });

  it("price 欠損時は PER/PBR のみ null（他は算出）", () => {
    const records = [
      mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2026-03-31", Sales: "1200", OP: "120", EPS: "150", BPS: "1500" })),
    ];
    const f = computeFundamentals(records, null);
    expect(f.per).toBeNull();
    expect(f.pbr).toBeNull();
    expect(f.roe).toBe(10);
    expect(f.operatingMargin).toBe(10);
  });

  it("前年レコードが無ければ売上成長率のみ null", () => {
    const records = [
      mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2026-03-31", Sales: "1200", OP: "120", EPS: "150", BPS: "1500" })),
    ];
    const f = computeFundamentals(records, 3000);
    expect(f.salesGrowth).toBeNull();
    expect(f.per).toBe(20);
  });

  it("EPS/BPS 欠損（空文字）時は PER/PBR/ROE を null", () => {
    const records = [
      mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2026-03-31", Sales: "1200", OP: "120", EPS: "", BPS: "" })),
    ];
    const f = computeFundamentals(records, 3000);
    expect(f.per).toBeNull();
    expect(f.pbr).toBeNull();
    expect(f.roe).toBeNull();
    expect(f.operatingMargin).toBe(10); // 営業利益率は算出可
  });

  it("レコード無しは全 null", () => {
    const f = computeFundamentals([], 3000);
    expect(f).toMatchObject({ per: null, pbr: null, roe: null, operatingMargin: null, salesGrowth: null, basis: null });
  });
});

describe("findPriorYear", () => {
  it("同区分・同連結で約1年前の期末に最も近いものを返す", () => {
    const primary = mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2026-03-31", Sales: "1200" }));
    const records = [
      primary,
      mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2025-03-31", Sales: "1000" })),
      mapFinRecord(raw({ DocType: "FYFinancialStatements_Consolidated_IFRS", CurPerType: "FY", CurPerEn: "2024-03-31", Sales: "900" })),
    ];
    const prior = findPriorYear(records, primary)!;
    expect(prior.perEnd).toBe("2025-03-31");
  });
});
