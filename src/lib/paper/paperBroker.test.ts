import { describe, it, expect } from "vitest";
import {
  allocationPerNameYen,
  computeShares,
  totalOpenShares,
  fillBuyOrder,
  fillSellOrder,
  realizedPnlYen,
  pnlPct,
  unrealizedPnlYen,
  computeEquity,
  evaluateKillSwitch,
  resumeKillSwitch,
  applyBuyFill,
  applySellFill,
  emptyAccount,
  positionId,
  HARD_LIMIT_PER_NAME_YEN,
  HARD_LIMIT_TOTAL_SHARES,
  DEFAULT_PAPER_BROKER_SETTINGS,
  type PaperOrder,
  type PaperPosition,
  type PaperAccount,
  type PaperBrokerSettings,
} from "./paperBroker";

const settings = (over: Partial<PaperBrokerSettings> = {}): PaperBrokerSettings => ({
  ...DEFAULT_PAPER_BROKER_SETTINGS,
  ...over,
});
const buyOrder = (over: Partial<PaperOrder> = {}): PaperOrder => ({
  code: "7203",
  name: "トヨタ",
  strategyId: "trend-follow",
  side: "buy",
  signalDate: "2026-04-09",
  shares: 100,
  prevClose: 1000,
  reason: "GC＋高値更新",
  ...over,
});
const position = (over: Partial<PaperPosition> = {}): PaperPosition => ({
  id: positionId("7203", "trend-follow", "2026-04-10"),
  code: "7203",
  name: "トヨタ",
  strategyId: "trend-follow",
  shares: 100,
  entryDate: "2026-04-10",
  entryPrice: 1000,
  entryReason: "GC＋高値更新",
  ...over,
});

describe("資金管理（allocation / shares）", () => {
  it("1銘柄配分額 = 運用資金 ÷ 分割数（既定 500,000/4 = 125,000）", () => {
    expect(allocationPerNameYen(settings())).toBe(125_000);
  });
  it("配分額はハードリミット 500,000円 で上限クランプ", () => {
    expect(allocationPerNameYen(settings({ capitalYen: 4_000_000, splits: 2 }))).toBe(HARD_LIMIT_PER_NAME_YEN);
  });
  it("不正設定（資金/分割0以下）は 0", () => {
    expect(allocationPerNameYen(settings({ splits: 0 }))).toBe(0);
  });

  it("株数 = floor(配分額 ÷ 前日終値)", () => {
    expect(computeShares({ allocationYen: 125_000, prevClose: 1000, currentTotalShares: 0 })).toBe(125);
    expect(computeShares({ allocationYen: 125_000, prevClose: 1100, currentTotalShares: 0 })).toBe(113); // floor(113.6)
  });
  it("前日終値が配分額超なら 0株（見送り）", () => {
    expect(computeShares({ allocationYen: 125_000, prevClose: 200_000, currentTotalShares: 0 })).toBe(0);
  });
  it("1銘柄円ハードリミットで上限（前日終値ベース）", () => {
    // alloc 1,000,000 / 100 = 10,000株 だが 1銘柄500,000円 → floor(500000/100)=5,000株、さらに総株数1,000で頭打ち
    expect(computeShares({ allocationYen: 1_000_000, prevClose: 100, currentTotalShares: 0 })).toBe(HARD_LIMIT_TOTAL_SHARES);
  });
  it("総保有株数ハードリミット（残枠のみ建てる）", () => {
    expect(computeShares({ allocationYen: 125_000, prevClose: 100, currentTotalShares: 990 })).toBe(10);
    expect(computeShares({ allocationYen: 125_000, prevClose: 100, currentTotalShares: 1000 })).toBe(0);
  });

  it("totalOpenShares は保有株数の合計", () => {
    expect(totalOpenShares([position({ shares: 100 }), position({ shares: 50, id: "x" })])).toBe(150);
  });
});

describe("仮想約定（翌営業日始値）", () => {
  it("買い: 始値で約定 → filled（entryPrice=始値・entryDate=約定日）", () => {
    const r = fillBuyOrder({ order: buyOrder({ shares: 100 }), openPrice: 1010, fillDate: "2026-04-10", currentTotalShares: 0 });
    expect(r.outcome).toBe("filled");
    expect(r.position).toMatchObject({ shares: 100, entryPrice: 1010, entryDate: "2026-04-10", code: "7203" });
  });
  it("買い: 始値取得不可 → 失効(lapsed)", () => {
    const r = fillBuyOrder({ order: buyOrder(), openPrice: null, fillDate: "2026-04-10", currentTotalShares: 0 });
    expect(r.outcome).toBe("lapsed");
    expect(r.position).toBeNull();
    expect(r.reason).toContain("失効");
  });
  it("買い: 約定時に総株数リミットで0株 → 見送り(skipped)", () => {
    const r = fillBuyOrder({ order: buyOrder({ shares: 100 }), openPrice: 1000, fillDate: "2026-04-10", currentTotalShares: 1000 });
    expect(r.outcome).toBe("skipped");
    expect(r.position).toBeNull();
  });
  it("買い: 始値ギャップで1銘柄円リミットが効き株数を縮小", () => {
    // 始値 600,000円/株 → floor(500000/600000)=0株 → 見送り
    const r = fillBuyOrder({ order: buyOrder({ shares: 1 }), openPrice: 600_000, fillDate: "2026-04-10", currentTotalShares: 0 });
    expect(r.outcome).toBe("skipped");
  });

  it("売り: 始値で約定 → 確定損益を計算", () => {
    const r = fillSellOrder({ position: position({ shares: 100, entryPrice: 1000 }), openPrice: 1100, fillDate: "2026-04-20", exitReason: "利確" });
    expect(r.outcome).toBe("filled");
    expect(r.trade).toMatchObject({ exitPrice: 1100, pnlYen: 10_000, pnlPct: 10, exitReason: "利確" });
  });
  it("売り: 始値取得不可 → 失効（手仕舞い持ち越し）", () => {
    const r = fillSellOrder({ position: position(), openPrice: null, fillDate: "2026-04-20", exitReason: "損切り" });
    expect(r.outcome).toBe("lapsed");
    expect(r.trade).toBeNull();
  });
});

describe("損益計算", () => {
  it("realizedPnlYen / pnlPct / unrealizedPnlYen", () => {
    expect(realizedPnlYen(1000, 1100, 100)).toBe(10_000);
    expect(pnlPct(1000, 900)).toBeCloseTo(-10, 6);
    expect(pnlPct(0, 900)).toBe(0); // ゼロ除算回避
    expect(unrealizedPnlYen(position({ shares: 100, entryPrice: 1000 }), 1050)).toBe(5_000);
  });
});

describe("口座反映（applyBuyFill / applySellFill）", () => {
  it("買い約定でポジション追加", () => {
    const a = applyBuyFill(emptyAccount(), position(), "2026-04-10T00:00:00.000Z");
    expect(a.positions).toHaveLength(1);
    expect(a.updatedAt).toBe("2026-04-10T00:00:00.000Z");
  });
  it("売り約定でポジション除去・確定損益追加", () => {
    const p = position();
    const withPos = applyBuyFill(emptyAccount(), p, "2026-04-10");
    const sold = fillSellOrder({ position: p, openPrice: 1100, fillDate: "2026-04-20", exitReason: "利確" });
    const a = applySellFill(withPos, p.id, sold.trade!, "2026-04-20");
    expect(a.positions).toHaveLength(0);
    expect(a.closedTrades).toHaveLength(1);
  });
});

describe("総資産（equity）とキルスイッチ", () => {
  const accountWith = (over: Partial<PaperAccount> = {}): PaperAccount => ({ ...emptyAccount(), ...over });

  it("equity = 運用資金 + 確定損益 + 含み損益", () => {
    const acc = accountWith({
      positions: [position({ shares: 100, entryPrice: 1000, code: "7203" })],
      closedTrades: [
        { id: "t1", code: "9984", strategyId: "pullback", shares: 10, entryDate: "2026-01-01", entryPrice: 1000, exitDate: "2026-01-10", exitPrice: 1200, exitReason: "利確", pnlYen: 2000, pnlPct: 20, holdingDays: 9 },
      ],
    });
    const eq = computeEquity(acc, settings(), new Map([["7203", 1050]]));
    expect(eq.realizedPnlYen).toBe(2000);
    expect(eq.unrealizedPnlYen).toBe(5000); // (1050-1000)*100
    expect(eq.equityYen).toBe(500_000 + 2000 + 5000);
  });
  it("現在値が取得できない銘柄は建値評価（含み損益0）", () => {
    const acc = accountWith({ positions: [position({ shares: 100, entryPrice: 1000, code: "7203" })] });
    const eq = computeEquity(acc, settings(), new Map()); // 価格なし
    expect(eq.unrealizedPnlYen).toBe(0);
    expect(eq.equityYen).toBe(500_000);
  });

  it("ドローダウン -10% 以下でキルスイッチ発動", () => {
    // 含み損 -60,000円（資金比 -12%）→ 発動
    const acc = accountWith({ positions: [position({ shares: 100, entryPrice: 1000, code: "7203" })] });
    const ks = evaluateKillSwitch(acc, settings(), new Map([["7203", 400]]), "2026-04-10T00:00:00.000Z");
    expect(ks.active).toBe(true);
    expect(ks.reason).toContain("停止");
    expect(ks.drawdownPctAtTrigger).toBeCloseTo(-12, 6);
  });
  it("ドローダウンが閾値未満なら発動しない", () => {
    const acc = accountWith({ positions: [position({ shares: 100, entryPrice: 1000, code: "7203" })] });
    const ks = evaluateKillSwitch(acc, settings(), new Map([["7203", 950]]), "2026-04-10"); // -1%
    expect(ks.active).toBe(false);
  });
  it("発動中は回復しても維持（明示再開まで解除しない）", () => {
    const active: PaperAccount = accountWith({
      killSwitch: { active: true, reason: "停止済み", triggeredAt: "2026-04-01", drawdownPctAtTrigger: -12 },
    });
    const ks = evaluateKillSwitch(active, settings(), new Map(), "2026-04-10"); // 損益0でも維持
    expect(ks.active).toBe(true);
    expect(resumeKillSwitch().active).toBe(false); // 明示再開で解除
  });
});
