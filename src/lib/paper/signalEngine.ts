/**
 * 日次シグナル生成エンジン（Phase 1 / Task 4）— 純関数。
 *
 * 執行モデル（ペーパーブローカーと同一）:
 * - シグナルは当日終値（調整後終値）確定後に生成 → 注文(PaperOrder)化してキューへ。
 * - 約定は翌営業日（翌データバー）の始値。生成と約定はセッションを跨ぐため、
 *   注文キューは K レジストリ経由で永続化する（signalEngineRepository）。
 *
 * 対象戦略は設定で ON/OFF（既定: C=relative-momentum / B=pullback 有効・A=trend-follow 無効）。
 * キルスイッチ発動中はシグナル**生成**を停止する（保留注文の約定は継続）。
 *
 * 本モジュールは副作用なし。取得・永続化・時刻注入は runSignalEngine / repository が担う。
 */
import type { SeriesPoint } from "@/lib/analytics/priceCache";
import type { TradingStrategy, StrategyBar, StrategyPosition } from "@/lib/strategy/signalStrategy";
import {
  type PaperOrder,
  type PaperAccount,
  type PaperBrokerSettings,
  fillBuyOrder,
  fillSellOrder,
  applyBuyFill,
  applySellFill,
  allocationPerNameYen,
  computeShares,
  totalOpenShares,
  positionCostYen,
} from "./paperBroker";

// ---- 系列ヘルパー ----

/** SeriesPoint[] → StrategyBar[]（adjClose・昇順・null除外）。 */
export function toStrategyBars(series: SeriesPoint[]): StrategyBar[] {
  return series
    .filter((p) => p.adjClose != null && Number.isFinite(p.adjClose))
    .map((p) => ({ date: p.date, close: p.adjClose as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** afterDate より後の最初のバー（＝翌営業日）の約定情報。無ければ null（未到来）。 */
export function nextFillBar(
  series: SeriesPoint[],
  afterDate: string
): { date: string; price: number; substitute: boolean } | null {
  const sorted = [...series].filter((p) => p.adjClose != null).sort((a, b) => a.date.localeCompare(b.date));
  for (const p of sorted) {
    if (p.date > afterDate) {
      const hasOpen = typeof p.adjOpen === "number" && Number.isFinite(p.adjOpen);
      return { date: p.date, price: hasOpen ? (p.adjOpen as number) : (p.adjClose as number), substitute: !hasOpen };
    }
  }
  return null;
}

/** entryDate より後の経過営業日数（保有バー数）。 */
function barsHeldSince(bars: StrategyBar[], entryDate: string): number {
  let n = 0;
  for (const b of bars) if (b.date > entryDate) n++;
  return n;
}

// ---- 約定（保留注文の消化） ----

export type FillOutcomeKind = "filled" | "lapsed" | "skipped" | "pending";
export interface FillLogEntry {
  code: string;
  side: "buy" | "sell";
  outcome: FillOutcomeKind;
  date?: string;
  reason: string;
}
export interface FillPendingResult {
  account: PaperAccount;
  /** 未約定で残る注文（翌営業日未到来・売り失効の持ち越し）。 */
  remaining: PaperOrder[];
  substituteFills: number;
  log: FillLogEntry[];
}

/**
 * 保留注文を翌営業日始値で約定する（純関数）。
 * - 翌営業日データ未到来 → 保留継続（remaining）。
 * - 買い: 約定 or 見送り(0株)。見送りは破棄。
 * - 売り: 対象ポジションが既に無ければスキップ。始値取得不可は持ち越し。
 */
export function fillPendingOrders(params: {
  orders: PaperOrder[];
  seriesByCode: Map<string, SeriesPoint[]>;
  account: PaperAccount;
  now: string;
}): FillPendingResult {
  let account = params.account;
  const remaining: PaperOrder[] = [];
  const log: FillLogEntry[] = [];
  let substituteFills = 0;

  for (const order of params.orders) {
    const series = params.seriesByCode.get(order.code) ?? [];
    const bar = nextFillBar(series, order.signalDate);
    if (!bar) {
      remaining.push(order);
      log.push({ code: order.code, side: order.side, outcome: "pending", reason: "翌営業日データ未到来" });
      continue;
    }
    if (order.side === "buy") {
      const r = fillBuyOrder({ order, openPrice: bar.price, fillDate: bar.date, currentTotalShares: totalOpenShares(account.positions) });
      if (r.outcome === "filled" && r.position) {
        // 現金ガード: 約定額が現金残高を超える注文は skip（資金不足）。破棄する。
        const cost = positionCostYen(r.position);
        if (cost > account.cash) {
          log.push({ code: order.code, side: "buy", outcome: "skipped", date: bar.date, reason: `資金不足（現金¥${Math.round(account.cash)} < 必要¥${Math.round(cost)}）` });
          continue;
        }
        account = { ...applyBuyFill(account, r.position, params.now), cash: account.cash - cost };
        if (bar.substitute) substituteFills++;
        log.push({ code: order.code, side: "buy", outcome: "filled", date: bar.date, reason: order.reason });
      } else {
        log.push({ code: order.code, side: "buy", outcome: r.outcome, date: bar.date, reason: r.reason || order.reason });
      }
    } else {
      const pos = account.positions.find((p) => p.id === order.positionId);
      if (!pos) {
        log.push({ code: order.code, side: "sell", outcome: "skipped", reason: "対象ポジションなし（既決済）" });
        continue;
      }
      const r = fillSellOrder({ position: pos, openPrice: bar.price, fillDate: bar.date, exitReason: order.reason });
      if (r.outcome === "filled" && r.trade) {
        // 売却代金を現金へ戻す。
        account = { ...applySellFill(account, pos.id, r.trade, params.now), cash: account.cash + r.trade.exitPrice * r.trade.shares };
        if (bar.substitute) substituteFills++;
        log.push({ code: order.code, side: "sell", outcome: "filled", date: bar.date, reason: order.reason });
      } else if (r.outcome === "lapsed") {
        remaining.push(order);
        log.push({ code: order.code, side: "sell", outcome: "lapsed", reason: r.reason });
      } else {
        log.push({ code: order.code, side: "sell", outcome: r.outcome, reason: r.reason });
      }
    }
  }
  return { account, remaining, substituteFills, log };
}

// ---- シグナル生成（新規注文の作成） ----

export interface GenerateResult {
  orders: PaperOrder[];
  /** キルスイッチで生成停止したか。 */
  blocked: boolean;
  log: string[];
}

/**
 * 保有ポジションの手仕舞い＋有効戦略の新規建てシグナルを生成する（純関数）。
 * - 手仕舞い: 保有ポジションの戦略の exitRule を評価（戦略が無効でも保有分は評価）。
 * - 新規建て: enabledIds の戦略のみ・未保有・キュー未登録の候補について entryRule を評価。
 * - キルスイッチ発動中は何も生成しない（blocked=true）。
 * - 株数はハードリミット＋キュー内の未約定買いを予約済みとして算入。0株は見送り。
 */
export function generateDailyOrders(params: {
  strategies: readonly TradingStrategy[];
  enabledIds: Set<string>;
  seriesByCode: Map<string, SeriesPoint[]>;
  entryCodes: string[];
  account: PaperAccount;
  settings: PaperBrokerSettings;
  killSwitchActive: boolean;
  existingOrders: PaperOrder[];
}): GenerateResult {
  if (params.killSwitchActive) {
    return { orders: [], blocked: true, log: ["キルスイッチ発動中: シグナル生成を停止しました。"] };
  }
  const orders: PaperOrder[] = [];
  const log: string[] = [];
  const byId = new Map(params.strategies.map((s) => [s.id, s]));
  const pendingSellPosIds = new Set(params.existingOrders.filter((o) => o.side === "sell").map((o) => o.positionId));
  const pendingBuyKeys = new Set(params.existingOrders.filter((o) => o.side === "buy").map((o) => `${o.strategyId}:${o.code}`));
  const heldKeys = new Set(params.account.positions.map((p) => `${p.strategyId}:${p.code}`));

  // キュー内の未約定買いも保有予約として株数に算入（総保有株数リミットの二重取り防止）。
  let reservedShares =
    totalOpenShares(params.account.positions) + params.existingOrders.filter((o) => o.side === "buy").reduce((n, o) => n + o.shares, 0);

  // 分割上限: 同時保有（保有ポジション＋キュー内の未約定買い）＋新規 を splits 銘柄以内に制限（過剰発注抑制）。
  const maxSlots = params.settings.splits > 0 ? params.settings.splits : 0;
  let slotsUsed = params.account.positions.length + params.existingOrders.filter((o) => o.side === "buy").length;
  let cappedLogged = false;

  // 1) 手仕舞い（保有ポジション）。
  for (const pos of params.account.positions) {
    if (pendingSellPosIds.has(pos.id)) continue;
    const strat = byId.get(pos.strategyId);
    const series = params.seriesByCode.get(pos.code);
    if (!strat || !series) continue;
    const bars = toStrategyBars(series);
    if (bars.length === 0) continue;
    const stratPos: StrategyPosition = { entryDate: pos.entryDate, entryPrice: pos.entryPrice, barsHeld: barsHeldSince(bars, pos.entryDate) };
    const sig = strat.exitRule(stratPos, bars);
    if (sig.action === "exit") {
      const last = bars[bars.length - 1];
      orders.push({ code: pos.code, name: pos.name, strategyId: pos.strategyId, side: "sell", signalDate: last.date, shares: pos.shares, prevClose: last.close, reason: sig.reason, positionId: pos.id });
      log.push(`手仕舞い: ${pos.code}（${strat.name}）${sig.reason}`);
    }
  }

  // 2) 新規建て（有効戦略のみ・未保有・キュー未登録・分割上限内）。
  const logCapOnce = () => {
    if (!cappedLogged) {
      log.push(`分割上限（同時保有 ${maxSlots} 銘柄）に達したため新規建てを抑制しました。`);
      cappedLogged = true;
    }
  };
  for (const code of params.entryCodes) {
    if (slotsUsed >= maxSlots) {
      logCapOnce();
      break;
    }
    const series = params.seriesByCode.get(code);
    if (!series) continue;
    const bars = toStrategyBars(series);
    if (bars.length === 0) continue;
    const last = bars[bars.length - 1];
    for (const strat of params.strategies) {
      if (slotsUsed >= maxSlots) {
        logCapOnce();
        break;
      }
      if (!params.enabledIds.has(strat.id)) continue;
      const key = `${strat.id}:${code}`;
      if (heldKeys.has(key) || pendingBuyKeys.has(key)) continue;
      const sig = strat.entryRule(bars);
      if (sig.action !== "enter") continue;
      const shares = computeShares({ allocationYen: allocationPerNameYen(params.settings), prevClose: last.close, currentTotalShares: reservedShares });
      if (shares <= 0) {
        log.push(`建て見送り(0株): ${code}（${strat.name}）`);
        continue;
      }
      orders.push({ code, strategyId: strat.id, side: "buy", signalDate: last.date, shares, prevClose: last.close, reason: sig.reason });
      reservedShares += shares;
      slotsUsed += 1;
      log.push(`建て: ${code}（${strat.name}）${shares}株 ${sig.reason}`);
    }
  }

  return { orders, blocked: false, log };
}
