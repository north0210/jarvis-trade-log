import { describe, it, expect } from "vitest";
import { normalizeTseCode, tradingViewSymbol } from "./tradingview";

describe("normalizeTseCode（J-Quants 5桁 → TradingView 4桁）", () => {
  it("数字コード: 5桁末尾0 は末尾除去（72030→7203）", () => {
    expect(normalizeTseCode("72030")).toBe("7203");
  });

  it("英字含みコード: 5桁末尾0 は末尾除去（137A0→137A）", () => {
    expect(normalizeTseCode("137A0")).toBe("137A");
  });

  it("末尾が0以外（優先株等）はそのまま（25935→25935）", () => {
    expect(normalizeTseCode("25935")).toBe("25935");
  });

  it("既に4桁ならそのまま（数字/英字含み）", () => {
    expect(normalizeTseCode("7203")).toBe("7203");
    expect(normalizeTseCode("137A")).toBe("137A");
  });

  it("5桁以外・空文字はそのまま（末尾0でも4桁なら除去しない）", () => {
    expect(normalizeTseCode("1300")).toBe("1300"); // 4桁末尾0 → length!==5 なので除去しない
    expect(normalizeTseCode("")).toBe("");
  });
});

describe("tradingViewSymbol（正規化を適用した TSE シンボル）", () => {
  it("5桁末尾0 は 4桁化して TSE: を付与", () => {
    expect(tradingViewSymbol("72030")).toBe("TSE:7203");
    expect(tradingViewSymbol("137A0")).toBe("TSE:137A");
  });

  it("末尾0以外・4桁はそのまま TSE: を付与", () => {
    expect(tradingViewSymbol("25935")).toBe("TSE:25935");
    expect(tradingViewSymbol("7203")).toBe("TSE:7203");
  });
});
