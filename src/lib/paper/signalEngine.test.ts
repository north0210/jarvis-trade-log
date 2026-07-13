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

// 既定は潤沢な現金（現金ガードを無効化）。資金不足テストは cash を明示上書きする。
const account = (over: Partial<PaperAccount> = {}): PaperAccount => ({ ...emptyAccount(), cash: 10_000_000, ...over });
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

  it("現金不足の買い注文は skip（資金不足・現金は減らない）", () => {
    // cost = 10株 × 125（D3 adjOpen）= 1,250。cash 1,000 → 不足で skip。
    const r = fillPendingOrders({ orders: [buyOrder()], seriesByCode: map1("7203", series(5)), account: account({ cash: 1000 }), now: "x" });
    expect(r.account.positions).toHaveLength(0);
    expect(r.log[0].outcome).toBe("skipped");
    expect(r.log[0].reason).toContain("資金不足");
    expect(r.account.cash).toBe(1000);
  });

  it("複数注文は順に現金を消費し、尽きたら以降を skip（部分約定順序）", () => {
    const seriesByCode = new Map([["7203", series(5)], ["9984", series(5)]]);
    const orders = [buyOrder({ code: "7203" }), buyOrder({ code: "9984" })]; // 各 cost 1,250
    const r = fillPendingOrders({ orders, seriesByCode, account: account({ cash: 2000 }), now: "x" });
    expect(r.account.positions.map((p) => p.code)).toEqual(["7203"]); // 先頭のみ約定
    expect(r.account.cash).toBe(750); // 2,000 − 1,250
    const nine = r.log.find((l) => l.code === "9984");
    expect(nine?.outcome).toBe("skipped");
    expect(nine?.reason).toContain("資金不足");
  });

  it("売り約定は売却代金を現金へ戻す", () => {
    const pos = position(); // 10株 @125
    const sell: PaperOrder = { code: "7203", strategyId: "c", side: "sell", signalDate: D(3), shares: 10, prevClose: 130, reason: "x", positionId: pos.id };
    // 手仕舞いは D(4) adjOpen 135 → 売却代金 1,350
    const r = fillPendingOrders({ orders: [sell], seriesByCode: map1("7203", series(5)), account: account({ positions: [pos], cash: 500 }), now: "x" });
    expect(r.account.positions).toHaveLength(0);
    expect(r.account.cash).toBe(500 + 1350);
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
  it("同時保有＋新規を splits 銘柄以内に制限（過剰発注抑制）", () => {
    const codes = ["7203", "9984", "6758"];
    const seriesByCode = new Map(codes.map((c) => [c, series(5)]));
    // capital 20,000/splits 2 = 配分1万 → 1銘柄約71株（総株数リミットに当たらない）。3候補でも 2件で打ち切り。
    const gen = generateDailyOrders({
      ...base,
      seriesByCode,
      strategies: [stub("c", [D(4)], [])],
      enabledIds: new Set(["c"]),
      entryCodes: codes,
      account: account(),
      settings: { ...DEFAULT_PAPER_BROKER_SETTINGS, capitalYen: 20000, splits: 2 },
    });
    expect(gen.orders.filter((o) => o.side === "buy")).toHaveLength(2);
    expect(gen.log.some((l) => l.includes("分割上限"))).toBe(true);
  });
});
