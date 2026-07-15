/**
 * ペーパーブローカー（仮想約定・ポジション管理・損益計算）— Phase 1 / Task 2。
 *
 * 実際の発注は一切行わない。楽天かぶミニ寄付取引を模倣し、手数料・スプレッド 0 円と仮定する。
 * すべて副作用なしの純関数（alerts.ts / signalStrategy.ts と同方針）。永続化は paperRepository が担う。
 *
 * 執行モデル:
 * - シグナルは当日終値確定後（鮮度 fresh 後）に生成 → 注文（PaperOrder）化。
 * - 約定は翌営業日の始値（取引カレンダー準拠）。始値が取得できない日（特別気配等）は「失効(lapsed)」。
 * - 建玉株数 = floor(1銘柄配分額 ÷ 前日終値)。0 株なら「見送り(skipped)」。
 *
 * 資金管理:
 * - 運用資金 / 分割数 → 1銘柄配分額 = 運用資金 ÷ 分割数（設定で変更可能）。
 * - ハードリミット（設定でも越えられない定数）: 1銘柄 500,000円 / 総保有 1,000株。
 * - キルスイッチ: 総資産が運用資金比 -10% でシグナル生成停止（明示再開まで維持）。
 */
import { daysBetween } from "@/lib/analysis/trades";

// ---- 資金管理設定・ハードリミット ----

/** 資金管理設定（設定画面で変更可能。以下は初期値）。 */
export interface PaperBrokerSettings {
  /** 運用資金（円）。 */
  capitalYen: number;
  /** 分割数（1銘柄配分額 = capitalYen ÷ splits）。 */
  splits: number;
  /** キルスイッチ発動ドローダウン（%・正の値。運用資金比 -この値% で発動）。 */
  killSwitchDrawdownPct: number;
}

export const DEFAULT_PAPER_BROKER_SETTINGS: Readonly<PaperBrokerSettings> = {
  capitalYen: 500_000,
  splits: 4,
  killSwitchDrawdownPct: 10,
};

/** ハードリミット（設定でも越えられない絶対上限・定数）。 */
export const HARD_LIMIT_PER_NAME_YEN = 500_000; // 1銘柄あたり最大投資額
export const HARD_LIMIT_TOTAL_SHARES = 1_000; // 総保有株数

// ---- ドメイン型 ----

export type OrderSide = "buy" | "sell";

/** 翌営業日始値で約定させる注文（シグナル→注文）。 */
export interface PaperOrder {
  code: string;
  name?: string;
  strategyId: string;
  side: OrderSide;
  /** シグナル生成日（当日終値確定日）。 */
  signalDate: string; // YYYY-MM-DD
  /** buy: 建玉株数（floor(配分÷前日終値)・リミット適用済み）/ sell: 手仕舞い株数。 */
  shares: number;
  /** シグナル日の終値（株数算出根拠・記録用）。 */
  prevClose: number;
  /** シグナル根拠（戦略の reason）。 */
  reason: string;
  /** sell のとき対象ポジション ID。 */
  positionId?: string;
}

/** 保有ポジション（仮想）。 */
export interface PaperPosition {
  id: string;
  code: string;
  name?: string;
  strategyId: string;
  shares: number; // 正の整数
  entryDate: string; // 約定日（翌営業日始値の日）YYYY-MM-DD
  entryPrice: number; // 約定価格（始値）
  entryReason: string;
}

/** 確定済み取引（クローズ）。 */
export interface PaperTrade {
  id: string;
  code: string;
  name?: string;
  strategyId: string;
  shares: number;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitReason: string;
  pnlYen: number; // (exit-entry)*shares
  pnlPct: number; // (exit-entry)/entry*100
  holdingDays: number | null;
}

/** キルスイッチ状態（発動後はユーザーの明示再開まで維持）。 */
export interface KillSwitchState {
  active: boolean;
  reason: string;
  triggeredAt: string | null; // ISO
  drawdownPctAtTrigger: number | null;
}

export const INACTIVE_KILL_SWITCH: Readonly<KillSwitchState> = {
  active: false,
  reason: "",
  triggeredAt: null,
  drawdownPctAtTrigger: null,
};

/** ペーパートレード口座（永続化する集約状態）。 */
export interface PaperAccount {
  positions: PaperPosition[];
  closedTrades: PaperTrade[];
  killSwitch: KillSwitchState;
  /** 現金残高（円）。買い約定で減算・売り約定で加算。約定時の資金ガードに使用。 */
  cash: number;
  updatedAt: string; // ISO
}

/** 空口座を新規生成（毎回フレッシュな配列/オブジェクトを返す・現金は 0）。 */
export function emptyAccount(): PaperAccount {
  return { positions: [], closedTrades: [], killSwitch: { ...INACTIVE_KILL_SWITCH }, cash: 0, updatedAt: "" };
}

/**
 * 現金残高の後方互換初期化: 運用資金 − 建玉建値合計。
 * cash 未保存の旧口座（本フィールド導入前）をロードする際に用いる。
 */
export function initialCash(positions: PaperPosition[], capitalYen: number): number {
  return capitalYen - positions.reduce((s, p) => s + positionCostYen(p), 0);
}

// ---- 約定結果 ----

export type FillOutcome = "filled" | "lapsed" | "skipped";

export interface BuyFillResult {
  outcome: FillOutcome;
  position: PaperPosition | null;
  /** lapsed / skipped の理由（filled は ""）。 */
  reason: string;
}

export interface SellFillResult {
  outcome: FillOutcome;
  trade: PaperTrade | null;
  reason: string;
}

// ---- ID（決定的・採番不要） ----

export function positionId(code: string, strategyId: string, entryDate: string): string {
  return `${strategyId}:${code}:${entryDate}`;
}
export function tradeId(pos: PaperPosition, exitDate: string): string {
  return `${pos.id}->${exitDate}`;
}

// ---- 資金管理・株数算出 ----

/** 1銘柄あたりの配分額（円）。ハードリミット（1銘柄円）で上限クランプ。不正設定は 0。 */
export function allocationPerNameYen(settings: PaperBrokerSettings): number {
  if (!(settings.capitalYen > 0) || !(settings.splits > 0)) return 0;
  return Math.min(settings.capitalYen / settings.splits, HARD_LIMIT_PER_NAME_YEN);
}

/** 現在の総保有株数。 */
export function totalOpenShares(positions: PaperPosition[]): number {
  return positions.reduce((n, p) => n + p.shares, 0);
}

/**
 * 建玉株数 = floor(配分額 ÷ 前日終値)。
 * ハードリミット（1銘柄円＝前日終値ベース／総保有株数）を適用。0 株なら見送り。
 */
export function computeShares(params: {
  allocationYen: number;
  prevClose: number;
  currentTotalShares: number;
}): number {
  const { allocationYen, prevClose, currentTotalShares } = params;
  if (!(allocationYen > 0) || !(prevClose > 0)) return 0;
  let shares = Math.floor(allocationYen / prevClose);
  // 1銘柄あたり金額ハードリミット（前日終値ベース）。
  shares = Math.min(shares, Math.floor(HARD_LIMIT_PER_NAME_YEN / prevClose));
  // 総保有株数ハードリミット。
  const remaining = HARD_LIMIT_TOTAL_SHARES - Math.max(0, currentTotalShares);
  shares = Math.min(shares, Math.max(0, remaining));
  return shares > 0 ? shares : 0;
}

// ---- 損益計算 ----

export function realizedPnlYen(entryPrice: number, exitPrice: number, shares: number): number {
  return (exitPrice - entryPrice) * shares;
}
export function pnlPct(entryPrice: number, exitPrice: number): number {
  if (!(entryPrice > 0)) return 0;
  return ((exitPrice - entryPrice) / entryPrice) * 100;
}
export function unrealizedPnlYen(position: PaperPosition, currentPrice: number): number {
  return (currentPrice - position.entryPrice) * position.shares;
}
export function positionCostYen(position: PaperPosition): number {
  return position.entryPrice * position.shares;
}
export function positionValueYen(position: PaperPosition, currentPrice: number): number {
  return currentPrice * position.shares;
}

// ---- 仮想約定（翌営業日始値） ----

/**
 * 買い注文を翌営業日始値で約定する。
 * - 始値なし（null / 非正）→ 失効(lapsed)。
 * - 約定時にもハードリミット（始値ベース1銘柄円・総株数）を再適用し、0 株なら見送り(skipped)。
 */
export function fillBuyOrder(params: {
  order: PaperOrder;
  openPrice: number | null;
  fillDate: string; // 翌営業日 YYYY-MM-DD
  currentTotalShares: number;
}): BuyFillResult {
  const { order, openPrice, fillDate, currentTotalShares } = params;
  if (openPrice == null || !(openPrice > 0)) {
    return { outcome: "lapsed", position: null, reason: "始値取得不可（特別気配等）で失効" };
  }
  let shares = Math.max(0, Math.floor(order.shares));
  shares = Math.min(shares, Math.floor(HARD_LIMIT_PER_NAME_YEN / openPrice));
  const remaining = HARD_LIMIT_TOTAL_SHARES - Math.max(0, currentTotalShares);
  shares = Math.min(shares, Math.max(0, remaining));
  if (shares <= 0) {
    return { outcome: "skipped", position: null, reason: "配分/リミットにより株数0で見送り" };
  }
  const position: PaperPosition = {
    id: positionId(order.code, order.strategyId, fillDate),
    code: order.code,
    name: order.name,
    strategyId: order.strategyId,
    shares,
    entryDate: fillDate,
    entryPrice: openPrice,
    entryReason: order.reason,
  };
  return { outcome: "filled", position, reason: "" };
}

/**
 * 売り注文（手仕舞い）を翌営業日始値で約定する。
 * - 始値なし（null / 非正）→ 失効(lapsed)。ポジションは継続（呼び出し側で持ち越し）。
 */
export function fillSellOrder(params: {
  position: PaperPosition;
  openPrice: number | null;
  fillDate: string;
  exitReason: string;
}): SellFillResult {
  const { position, openPrice, fillDate, exitReason } = params;
  if (openPrice == null || !(openPrice > 0)) {
    return { outcome: "lapsed", trade: null, reason: "始値取得不可（特別気配等）で失効（手仕舞い持ち越し）" };
  }
  const trade: PaperTrade = {
    id: tradeId(position, fillDate),
    code: position.code,
    name: position.name,
    strategyId: position.strategyId,
    shares: position.shares,
    entryDate: position.entryDate,
    entryPrice: position.entryPrice,
    exitDate: fillDate,
    exitPrice: openPrice,
    exitReason,
    pnlYen: realizedPnlYen(position.entryPrice, openPrice, position.shares),
    pnlPct: pnlPct(position.entryPrice, openPrice),
    holdingDays: daysBetween(position.entryDate, fillDate),
  };
  return { outcome: "filled", trade, reason: "" };
}

// ---- 口座への反映（純関数・新しい口座を返す） ----

export function applyBuyFill(account: PaperAccount, position: PaperPosition, now: string): PaperAccount {
  return { ...account, positions: [...account.positions, position], updatedAt: now };
}

export function applySellFill(account: PaperAccount, posId: string, trade: PaperTrade, now: string): PaperAccount {
  return {
    ...account,
    positions: account.positions.filter((p) => p.id !== posId),
    closedTrades: [...account.closedTrades, trade],
    updatedAt: now,
  };
}

// ---- 総資産（equity）とキルスイッチ ----

export interface EquitySnapshot {
  capitalYen: number;
  realizedPnlYen: number;
  unrealizedPnlYen: number;
  /** 総資産 = 運用資金 + 確定損益 + 含み損益（手数料 0 前提）。 */
  equityYen: number;
  /** 運用資金比のドローダウン（%）。 */
  drawdownPct: number;
  /** 取得価格で値洗いした建玉数（マーク成功）。 */
  markedCount: number;
  /** 価格未取得で建値評価にフォールバックした建玉数。 */
  fallbackCount: number;
}

/**
 * 総資産（equity）を算出する。
 * 現在値が取得できない銘柄は建値評価（含み損益 0）として安全側に扱う。
 */
export function computeEquity(
  account: PaperAccount,
  settings: PaperBrokerSettings,
  priceByCode: Map<string, number | null>
): EquitySnapshot {
  const realized = account.closedTrades.reduce((s, t) => s + t.pnlYen, 0);
  let unrealized = 0;
  let markedCount = 0;
  let fallbackCount = 0;
  for (const p of account.positions) {
    const px = priceByCode.get(p.code);
    const marked = typeof px === "number" && px > 0;
    const mark = marked ? (px as number) : p.entryPrice; // 取得不能は建値評価
    if (marked) markedCount++;
    else fallbackCount++;
    unrealized += (mark - p.entryPrice) * p.shares;
  }
  const capital = settings.capitalYen;
  const equity = capital + realized + unrealized;
  const drawdownPct = capital > 0 ? ((equity - capital) / capital) * 100 : 0;
  return { capitalYen: capital, realizedPnlYen: realized, unrealizedPnlYen: unrealized, equityYen: equity, drawdownPct, markedCount, fallbackCount };
}

/**
 * キルスイッチを評価する（純関数）。
 * - 既に発動中なら現状維持（明示再開まで解除しない）。
 * - ドローダウンが -killSwitchDrawdownPct% 以下で新規発動。
 */
export function evaluateKillSwitch(
  account: PaperAccount,
  settings: PaperBrokerSettings,
  priceByCode: Map<string, number | null>,
  now: string
): KillSwitchState {
  if (account.killSwitch.active) return account.killSwitch;
  const eq = computeEquity(account, settings, priceByCode);
  const threshold = -Math.abs(settings.killSwitchDrawdownPct);
  if (eq.drawdownPct <= threshold) {
    return {
      active: true,
      reason: `総資産が運用資金比 ${eq.drawdownPct.toFixed(1)}%（閾値 ${threshold}%）に達したためシグナル生成を停止しました。`,
      triggeredAt: now,
      drawdownPctAtTrigger: eq.drawdownPct,
    };
  }
  return { ...INACTIVE_KILL_SWITCH };
}

/** キルスイッチを明示解除（ユーザー操作での再開）。 */
export function resumeKillSwitch(): KillSwitchState {
  return { ...INACTIVE_KILL_SWITCH };
}
