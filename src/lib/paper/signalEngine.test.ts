import { describe, it, expect } from "vitest";
import type { SeriesPoint } from "@/lib/analytics/priceCache";
import type { TradingStrategy, StrategyBar, Signal } from "@/lib/strategy/signalStrategy";
import { emptyAccount, positionId, DEFAULT_PAPER_BROKER_SETTINGS, type PaperAccount, type PaperPosition, type PaperOrder } from "./paperBroker";
import { nextFillBar, fillPendingOrders, generateDailyOrders } from "./signalEngine";

const D = (n: number) => new Date(Date.UTC(2020, 0, 1 + n)).toISOString().slice(0, 10);

/** adjClose=100+10n, adjOpen=close-5 の系列。 */
function series(n: number, opts: { noOpenDates?: string[] } = {}): SeriesPoint[] {
  const noOpen = new Set(opts.noOpenDates ?? []);
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + 10 * i;
    const date = D(i);
    return { date, close, adjClose: close, volume: 1000, ...(noOpen.has(date) ? {} : { adjOpen: close - 5 }) } as SeriesPoint;
  });
}

function stub(id: string, enterOn: string[], exitOn: string[]): TradingStrategy {
  const enters = new Set(enterOn);
  const exits = new Set(exitOn);
  const last = (s: StrategyBar[]) => (s.length ? s[s.length - 1].date : "");
  return {
    id,
    name: id,
    description: "",
    disclaimer: "d",
    params: {},
    entryRule: (s): Signal => (enters.has(last(s)) ? { action: "enter", reason: "e" } : { action: "hold", reason: "" }),
    exitRule: (_p, s): Signal => (exits.has(last(s)) ? { action: "exit", reason: "x" } : { action: "hold", reason: "" }),
  };
}

const account = (over: Partial<PaperAccount> = {}): PaperAccount => ({ ...emptyAccount(), ...over });
const position = (over: Partial<PaperPosition> = {}): PaperPosition => ({
  id: positionId("7203", "c", D(3)),
  code: "7203",
  strategyId: "c",
  shares: 10,
  entryDate: D(3),
  entryPrice: 125,
  entryReason: "e",
  ...over,
});
const buyOrder = (over: Partial<PaperOrder> = {}): PaperOrder => ({ code: "7203", strategyId: "c", side: "buy", signalDate: D(2), shares: 10, prevClose: 120, reason: "e", ...over });
const map1 = (code: string, s: SeriesPoint[]) => new Map([[code, s]]);

describe("nextFillBar", () => {
  it("signalDate より後の最初のバーの始値(adjOpen)を返す", () => {
    const b = nextFillBar(series(5), D(2));
    expect(b).toEqual({ date: D(3), price: 130 - 5, substitute: false });
  });
  it("adjOpen 欠落は adjClose 代用（substitute=true）", () => {
    const b = nextFillBar(series(5, { noOpenDates: [D(3)] }), D(2));
    expect(b).toEqual({ date: D(3), price: 130, substitute: true });
  });
  it("後続バーが無ければ null（未到来）", () => {
    expect(nextFillBar(series(5), D(4))).toBeNull();
  });
});

describe("fillPendingOrders", () => {
  it("買い注文を翌営業日始値で約定しポジション追加", () => {
    const r = fillPendingOrders({ orders: [buyOrder()], seriesByCode: map1("7203", series(5)), account: account(), now: "2020-06-01" });
    expect(r.account.positions).toHaveLength(1);
    expect(r.account.positions[0]).toMatchObject({ entryPrice: 125, entryDate: D(3), shares: 10 });
    expect(r.remaining).toHaveLength(0);
  });
  it("翌営業日データ未到来なら保留継続", () => {
    const r = fillPendingOrders({ orders: [buyOrder({ signalDate: D(4) })], seriesByCode: map1("7203", series(5)), account: account(), now: "x" });
    expect(r.remaining).toHaveLength(1);
    expect(r.log[0].outcome).toBe("pending");
  });
  it("総株数ハードリミットで0株なら見送り（skipped・破棄）", () => {
    const full = account({ positions: [position({ id: "x", shares: 1000 })] });
    const r = fillPendingOrders({ orders: [buyOrder()], seriesByCode: map1("7203", series(5)), account: full, now: "x" });
    expect(r.log.find((l) => l.side === "buy")?.outcome).toBe("skipped");
    expect(r.account.positions).toHaveLength(1);
    expect(r.remaining).toHaveLength(0);
  });
  it("売り注文を約定し確定損益を記録", () => {
    const pos = position();
    const sell: PaperOrder = { code: "7203", strategyId: "c", side: "sell", signalDate: D(3), shares: 10, prevClose: 130, reason: "x", positionId: pos.id };
    const r = fillPendingOrders({ orders: [sell], seriesByCode: map1("7203", series(5)), account: account({ positions: [pos] }), now: "x" });
    expect(r.account.positions).toHaveLength(0);
    expect(r.account.closedTrades).toHaveLength(1);
    expect(r.account.closedTrades[0].exitPrice).toBe(135); // D(4) adjOpen
  });
  it("売り対象ポジションが無ければスキップ", () => {
    const sell: PaperOrder = { code: "7203", strategyId: "c", side: "sell", signalDate: D(3), shares: 10, prevClose: 130, reason: "x", positionId: "gone" };
    const r = fillPendingOrders({ orders: [sell], seriesByCode: map1("7203", series(5)), account: account(), now: "x" });
    expect(r.log[0].outcome).toBe("skipped");
  });
});

describe("generateDailyOrders", () => {
  const base = {
    seriesByCode: map1("7203", series(5)),
    settings: DEFAULT_PAPER_BROKER_SETTINGS,
    killSwitchActive: false,
    existingOrders: [] as PaperOrder[],
  };

  it("有効戦略のエントリーで買い注文（株数はハードリミット内で算出）", () => {
    const gen = generateDailyOrders({ ...base, strategies: [stub("c", [D(4)], [])], enabledIds: new Set(["c"]), entryCodes: ["7203"], account: account() });
    expect(gen.blocked).toBe(false);
    expect(gen.orders).toHaveLength(1);
    expect(gen.orders[0]).toMatchObject({ side: "buy", code: "7203", strategyId: "c", shares: Math.floor(125000 / 140) });
  });
  it("無効戦略（A相当）はエントリーしない", () => {
    const gen = generateDailyOrders({ ...base, strategies: [stub("a", [D(4)], [])], enabledIds: new Set(), entryCodes: ["7203"], account: account() });
    expect(gen.orders).toHaveLength(0);
  });
  it("保有ポジションの手仕舞いは戦略が無効でも評価する", () => {
    const pos = position({ strategyId: "a", id: positionId("7203", "a", D(3)) });
    const gen = generateDailyOrders({ ...base, strategies: [stub("a", [], [D(4)])], enabledIds: new Set(), entryCodes: [], account: account({ positions: [pos] }) });
    expect(gen.orders).toHaveLength(1);
    expect(gen.orders[0]).toMatchObject({ side: "sell", positionId: pos.id });
  });
  it("キルスイッチ発動中は生成停止（blocked）", () => {
    const gen = generateDailyOrders({ ...base, strategies: [stub("c", [D(4)], [])], enabledIds: new Set(["c"]), entryCodes: ["7203"], account: account(), killSwitchActive: true });
    expect(gen.blocked).toBe(true);
    expect(gen.orders).toHaveLength(0);
  });
  it("同一 code×戦略の買い注文がキュー済みなら重複生成しない", () => {
    const gen = generateDailyOrders({ ...base, strategies: [stub("c", [D(4)], [])], enabledIds: new Set(["c"]), entryCodes: ["7203"], account: account(), existingOrders: [buyOrder({ signalDate: D(4) })] });
    expect(gen.orders).toHaveLength(0);
  });
  it("同一 code×戦略を保有中なら新規建てしない", () => {
    const gen = generateDailyOrders({ ...base, strategies: [stub("c", [D(4)], [])], enabledIds: new Set(["c"]), entryCodes: ["7203"], account: account({ positions: [position()] }) });
    expect(gen.orders.filter((o) => o.side === "buy")).toHaveLength(0);
  });
});
