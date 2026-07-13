import { describe, it, expect } from "vitest";
import type { SeriesPoint } from "@/lib/analytics/priceCache";
import type { TradingStrategy, StrategyBar, Signal } from "@/lib/strategy/signalStrategy";
import {
  simulateSignalStrategy,
  computeSimMetrics,
  runStrategyComparison,
  midpointDate,
  type SimTrade,
} from "./signalSimulator";

/** 制御しやすいスタブ戦略（指標に依存せず日付でシグナルを出す）。 */
function stub(enterOn: string[], exitOn: string[]): TradingStrategy {
  const enters = new Set(enterOn);
  const exits = new Set(exitOn);
  const lastDate = (s: StrategyBar[]) => (s.length ? s[s.length - 1].date : "");
  return {
    id: "stub",
    name: "スタブ",
    description: "",
    disclaimer: "検証用",
    params: {},
    entryRule: (s): Signal => (enters.has(lastDate(s)) ? { action: "enter", reason: "e" } : { action: "hold", reason: "" }),
    exitRule: (_pos, s): Signal => (exits.has(lastDate(s)) ? { action: "exit", reason: "x" } : { action: "hold", reason: "" }),
  };
}

const D = (n: number) => new Date(Date.UTC(2020, 0, 1 + n)).toISOString().slice(0, 10);

/** adjClose/adjOpen 付き系列を生成（close=base+10n, open=close-5、既定で adjOpen あり）。 */
function makeSeries(n: number, opts: { noOpenDates?: string[]; nullCloseDates?: string[] } = {}): SeriesPoint[] {
  const noOpen = new Set(opts.noOpenDates ?? []);
  const nullClose = new Set(opts.nullCloseDates ?? []);
  return Array.from({ length: n }, (_, i) => {
    const date = D(i);
    const close = 100 + 10 * i;
    return {
      date,
      close,
      adjClose: nullClose.has(date) ? null : close,
      volume: 1000,
      ...(noOpen.has(date) ? {} : { adjOpen: close - 5 }),
    } as SeriesPoint;
  });
}

describe("simulateSignalStrategy（翌営業日約定）", () => {
  it("エントリーはシグナル翌バーの adjOpen で約定", () => {
    // D0 でエントリー → D1 の adjOpen で約定、D2 でイグジット → D3 の adjOpen で約定
    const s = makeSeries(5);
    const r = simulateSignalStrategy(stub([D(0)], [D(2)]), s, "7203");
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0];
    expect(t.entryDate).toBe(D(1));
    expect(t.entryPrice).toBe(110 - 5); // D1 adjOpen = 105
    expect(t.exitDate).toBe(D(3));
    expect(t.exitPrice).toBe(130 - 5); // D3 adjOpen = 125
    expect(t.entrySubstitute).toBe(false);
    expect(r.substituteFills).toBe(0);
  });

  it("翌バーに adjOpen が無ければ adjClose で代用約定（フラグ＋件数）", () => {
    const s = makeSeries(5, { noOpenDates: [D(1)] }); // 約定日 D1 に始値なし
    const r = simulateSignalStrategy(stub([D(0)], [D(2)]), s, "7203");
    const t = r.trades[0];
    expect(t.entryPrice).toBe(110); // D1 adjClose 代用
    expect(t.entrySubstitute).toBe(true);
    expect(r.substituteFills).toBe(1);
  });

  it("adjClose が null のバーはスキップし、次の利用可能バーで約定", () => {
    const s = makeSeries(5, { nullCloseDates: [D(1)] }); // D1 は系列から除外される
    const r = simulateSignalStrategy(stub([D(0)], [D(3)]), s, "7203");
    // bars = D0,D2,D3,D4 → D0 エントリーは次の D2 で約定
    expect(r.trades[0].entryDate).toBe(D(2));
  });

  it("系列末尾で建玉が残れば最終バーで強制手仕舞い", () => {
    const s = makeSeries(4);
    const r = simulateSignalStrategy(stub([D(0)], []), s, "7203"); // 出口シグナルなし
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].exitReason).toContain("強制手仕舞い");
    expect(r.trades[0].exitDate).toBe(D(3));
  });

  it("シグナルが無ければトレード0", () => {
    const r = simulateSignalStrategy(stub([], []), makeSeries(5), "7203");
    expect(r.trades).toHaveLength(0);
  });
});

describe("computeSimMetrics", () => {
  const mk = (returnPct: number, holdingDays: number, exitDate: string): SimTrade => ({
    code: "x",
    strategyId: "stub",
    entryDate: "2020-01-01",
    entryPrice: 100,
    exitDate,
    exitPrice: 100 * (1 + returnPct / 100),
    returnPct,
    holdingDays,
    outcome: returnPct >= 0 ? "win" : "loss",
    entrySubstitute: false,
    exitSubstitute: false,
    entryReason: "",
    exitReason: "",
  });

  it("勝率・PF・期待値・平均保有日数・最大DD", () => {
    const trades = [mk(10, 2, "2020-01-02"), mk(-5, 4, "2020-01-03"), mk(20, 6, "2020-01-04")];
    const m = computeSimMetrics(trades);
    expect(m.tradeCount).toBe(3);
    expect(m.winRate).toBeCloseTo(2 / 3, 6);
    expect(m.profitFactor).toBeCloseTo(30 / 5, 6); // 6
    expect(m.expectancyPct).toBeCloseTo(25 / 3, 6); // (10-5+20)/3
    expect(m.avgHoldingDays).toBeCloseTo(4, 6);
    expect(m.maxDrawdownPct).toBeCloseTo(5, 6); // +10 → -5 で 5% DD
  });

  it("トレード0は安全な既定値", () => {
    const m = computeSimMetrics([]);
    expect(m).toEqual({ tradeCount: 0, winRate: 0, profitFactor: null, maxDrawdownPct: 0, expectancyPct: 0, avgHoldingDays: null });
  });
});

describe("midpointDate / runStrategyComparison（OOS 前半後半）", () => {
  it("midpointDate は期間の中点", () => {
    expect(midpointDate("2020-01-01", "2020-01-03")).toBe("2020-01-02");
  });

  it("前半・後半のトレード数の和が全期間と一致", () => {
    const s = makeSeries(10);
    // D0→D2 エントリー約定 D1（前半）、D5→D7 エントリー約定 D6（後半）
    const strat = stub([D(0), D(5)], [D(2), D(7)]);
    const res = runStrategyComparison([strat], [{ code: "7203", series: s }], D(0), D(9), "2020-06-01T00:00:00.000Z");
    expect(res.entries).toHaveLength(1);
    const e = res.entries[0];
    expect(e.full.tradeCount).toBe(2);
    expect(e.firstHalf.tradeCount + e.secondHalf.tradeCount).toBe(e.full.tradeCount);
    expect(res.from).toBe(D(0));
    expect(res.to).toBe(D(9));
    expect(res.universeCount).toBe(1);
  });

  it("entryDate が期間外のトレードは集計しない", () => {
    const s = makeSeries(6);
    const strat = stub([D(0)], [D(2)]); // 約定 entryDate=D1
    const res = runStrategyComparison([strat], [{ code: "7203", series: s }], D(3), D(5), "2020-06-01T00:00:00.000Z");
    expect(res.entries[0].full.tradeCount).toBe(0);
  });
});
