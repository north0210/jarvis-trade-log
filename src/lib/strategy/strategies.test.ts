import { describe, it, expect } from "vitest";
import type { StrategyBar, StrategyPosition } from "./signalStrategy";
import {
  createTrendFollow,
  createPullback,
  createRelativeMomentum,
  STRATEGIES,
  getStrategyById,
  DEFAULT_TREND_FOLLOW,
} from "./strategies";

function toBars(closes: number[]): StrategyBar[] {
  const base = Date.UTC(2020, 0, 1);
  return closes.map((c, i) => ({ date: new Date(base + i * 86400000).toISOString().slice(0, 10), close: c }));
}
function rising(len: number, start: number, step: number): number[] {
  return Array.from({ length: len }, (_, i) => start + step * i);
}
function descending(len: number, start: number, step: number): number[] {
  return Array.from({ length: len }, (_, i) => start - step * i);
}
/** 60本の下降＋最終バーの急伸（MACD ゴールデンクロスを最終バーで発生させる）。 */
function descendThenJump(jump: number): number[] {
  const a = descending(60, 200, 0.5);
  a.push(jump);
  return a;
}
function pos(entryPrice: number, barsHeld = 0): StrategyPosition {
  return { entryDate: "2020-01-01", entryPrice, barsHeld };
}

describe("A トレンドフォロー（createTrendFollow）", () => {
  const A = createTrendFollow();

  it("entry: ゴールデンクロス かつ 60日終値高値更新 → enter", () => {
    const s = toBars(descendThenJump(205)); // GC かつ 205>直近高値200
    const sig = A.entryRule(s);
    expect(sig.action).toBe("enter");
    expect(sig.reason).toContain("ゴールデンクロス");
  });

  it("entry: ゴールデンクロスでも高値未更新なら hold", () => {
    const s = toBars(descendThenJump(190)); // GC だが 190<200
    expect(A.entryRule(s).action).toBe("hold");
  });

  it("entry: 高値更新でもゴールデンクロスでなければ hold", () => {
    const s = toBars(rising(80, 100, 1)); // 単調上昇＝新高値だが GC ではない
    expect(A.entryRule(s).action).toBe("hold");
  });

  it("exit: 損切り -8% 到達 → exit（MA より優先）", () => {
    const sig = A.exitRule(pos(100), toBars([100, 100, 91])); // gain -9%
    expect(sig.action).toBe("exit");
    expect(sig.reason).toContain("損切り");
  });

  it("exit: 25日線を終値が下回る → exit", () => {
    const s = toBars([...Array(25).fill(100), 95]); // sma25≈99.8 > 終値95、gain(-3%)は損切り未満
    const sig = A.exitRule(pos(98), s);
    expect(sig.action).toBe("exit");
    expect(sig.reason).toContain("25日移動平均");
  });

  it("exit: 条件未該当なら hold", () => {
    const s = toBars(Array(25).fill(100));
    expect(A.exitRule(pos(100), s).action).toBe("hold");
  });

  it("params 上書きが挙動に反映（損切り -5% に変更）", () => {
    const A5 = createTrendFollow({ stopLossPct: 5 });
    expect(A5.params.stopLossPct).toBe(5);
    expect(A5.exitRule(pos(100), toBars([100, 94])).action).toBe("exit"); // gain -6% <= -5%
  });
});

describe("B 押し目逆張り（createPullback）", () => {
  const B = createPullback();
  // 210本上昇（100→309）＋10本×-6 の押し目 → 終値>200日線 かつ RSI(14)≦30
  const pullbackSeries = (() => {
    const a = rising(210, 100, 1);
    for (let i = 0; i < 10; i++) a.push(a[a.length - 1] - 6);
    return a;
  })();

  it("entry: 終値>200日線 かつ RSI(14)≤30 → enter", () => {
    const sig = B.entryRule(toBars(pullbackSeries));
    expect(sig.action).toBe("enter");
    expect(sig.reason).toContain("RSI");
  });

  it("entry: 上昇継続で RSI が高い（>30）なら hold", () => {
    const sig = B.entryRule(toBars(rising(220, 100, 1))); // RSI≈100
    expect(sig.action).toBe("hold");
  });

  it("exit: RSI≥55 で利確", () => {
    const sig = B.exitRule(pos(100), toBars(rising(220, 100, 1))); // gain>0・RSI高
    expect(sig.action).toBe("exit");
    expect(sig.reason).toContain("利確");
  });

  it("exit: 損切り -6% 到達（優先）", () => {
    const sig = B.exitRule(pos(100), toBars([100, 93])); // gain -7%
    expect(sig.action).toBe("exit");
    expect(sig.reason).toContain("損切り");
  });

  it("exit: 最大保有 15 営業日で手仕舞い", () => {
    const s = toBars(Array(20).fill(100)); // RSI=50(<55)・gain=0
    expect(B.exitRule(pos(100, 15), s).reason).toContain("最大保有");
  });
});

describe("C 相対力モメンタム（createRelativeMomentum）", () => {
  const C = createRelativeMomentum();

  it("entry: 終値>75日線 かつ 相対力（騰落率）≥閾値 → enter", () => {
    const sig = C.entryRule(toBars(rising(120, 100, 0.8)));
    expect(sig.action).toBe("enter");
    expect(sig.reason).toContain("騰落率");
  });

  it("entry: 75日線割れなら hold", () => {
    const sig = C.entryRule(toBars(descending(80, 200, 1))); // 終値<75日線
    expect(sig.action).toBe("hold");
  });

  it("exit: 75日線割れ → exit", () => {
    const sig = C.exitRule(pos(125), toBars(descending(80, 200, 1))); // 終値<75日線・gain(-3%)は損切り未満
    expect(sig.action).toBe("exit");
    expect(sig.reason).toContain("75日移動平均");
  });

  it("exit: 損切り -8% 到達（優先）", () => {
    const sig = C.exitRule(pos(100), toBars([100, 91])); // gain -9%
    expect(sig.action).toBe("exit");
    expect(sig.reason).toContain("損切り");
  });

  it("exit: 最大保有 60 営業日で手仕舞い", () => {
    const s = toBars(rising(120, 100, 0.8)); // 終値>75日線・gain>0
    expect(C.exitRule(pos(100, 60), s).reason).toContain("最大保有");
  });
});

describe("STRATEGIES レジストリ", () => {
  it("3 戦略・id が一意", () => {
    expect(STRATEGIES).toHaveLength(3);
    expect(STRATEGIES.map((s) => s.id)).toEqual(["trend-follow", "pullback", "relative-momentum"]);
  });
  it("getStrategyById で取得（未知は undefined）", () => {
    expect(getStrategyById("pullback")?.name).toContain("押し目");
    expect(getStrategyById("nope")).toBeUndefined();
  });
  it("全戦略が免責文言と数値パラメータを公開", () => {
    for (const s of STRATEGIES) {
      expect(s.disclaimer.length).toBeGreaterThan(0);
      expect(Object.values(s.params).every((v) => typeof v === "number")).toBe(true);
    }
  });
  it("既定パラメータは仕様どおり（A=60/25/8）", () => {
    expect(DEFAULT_TREND_FOLLOW).toEqual({ highLookbackDays: 60, exitMaPeriod: 25, stopLossPct: 8 });
  });
});
