/**
 * アラート判定（純関数）
 *
 * ルール（実装を正とする・v1.7.0 で確定）:
 *  - 現在価格が損切りライン以下                        → STOP_HIT（赤・最優先）
 *  - 現在価格が損切りラインに接近                      → STOP_NEAR（赤）
 *      判定式は「現在価格を基準」に (price - stop) / price <= 0.03（＝3%）。
 *      ※「損切りライン基準」((price - stop)/stop) ではない点に注意。
 *        例: price=100, stop=97 → 0.03 でちょうど発火（境界はテストで固定済み）。
 *      将来「損切りライン基準」へ変更する場合、同じ乖離幅でも発火閾値が変わり、
 *      既存の行ハイライト/通知の発火数が変化する（リリース後の挙動変更となるため要慎重）。
 *  - RSI >= 80                                        → RSI_HOT（過熱・橙）
 *  - 損益率 <= -5%                                     → LOSS_DANGER（危険・赤）
 *  - 損益率 >= +20%                                    → TAKE_PROFIT（利確検討・緑）
 */
import type { Holding, Stock } from "@/lib/types";

export type AlertLevel = "danger" | "caution" | "profit";

export interface Alert {
  kind: "STOP_HIT" | "STOP_NEAR" | "RSI_HOT" | "LOSS_DANGER" | "TAKE_PROFIT";
  level: AlertLevel;
  label: string;
  subject: string;
}

export const STOP_NEAR_THRESHOLD = 0.03;
export const RSI_HOT = 80;
export const LOSS_DANGER_PCT = -5;
export const TAKE_PROFIT_PCT = 20;

export function pnl(h: { buy_price: number; shares: number }, price: number) {
  const value = price * h.shares;
  const cost = h.buy_price * h.shares;
  const diff = value - cost;
  const pct = cost === 0 ? 0 : (diff / cost) * 100;
  return { value, cost, diff, pct };
}

function stopAndRsiAlerts(
  subject: string,
  price: number | null,
  stop: number | null,
  rsi: number | null
): Alert[] {
  const out: Alert[] = [];
  if (price != null && stop != null && stop > 0) {
    if (price <= stop) {
      out.push({ kind: "STOP_HIT", level: "danger", label: "損切りライン到達", subject });
    } else if ((price - stop) / price <= STOP_NEAR_THRESHOLD) {
      out.push({ kind: "STOP_NEAR", level: "danger", label: "損切りライン接近", subject });
    }
  }
  if (rsi != null && rsi >= RSI_HOT) {
    out.push({ kind: "RSI_HOT", level: "caution", label: `RSI ${rsi} 過熱警告`, subject });
  }
  return out;
}

/** ウォッチ銘柄（保有していなくても発火するアラート） */
export function stockAlerts(s: Stock): Alert[] {
  return stopAndRsiAlerts(`${s.name} (${s.code})`, s.current_price, s.stop_loss, s.rsi);
}

/** 保有株のアラート（損切り・RSIに加えて損益率判定） */
export function holdingAlerts(h: Holding, s: Stock): Alert[] {
  const subject = `${s.name} (${s.code})`;
  const stop = h.stop_loss ?? s.stop_loss;
  const out = stopAndRsiAlerts(subject, s.current_price, stop, s.rsi);
  if (s.current_price != null) {
    const { pct } = pnl(h, s.current_price);
    if (pct <= LOSS_DANGER_PCT) {
      out.push({
        kind: "LOSS_DANGER",
        level: "danger",
        label: `損益率 ${pct.toFixed(1)}% 危険`,
        subject,
      });
    } else if (pct >= TAKE_PROFIT_PCT) {
      out.push({
        kind: "TAKE_PROFIT",
        level: "profit",
        label: `損益率 +${pct.toFixed(1)}% 利確検討`,
        subject,
      });
    }
  }
  return out;
}

/** 保有株の行ハイライト用の総合判定 */
export function holdingDangerLevel(h: Holding, s: Stock): AlertLevel | null {
  const alerts = holdingAlerts(h, s);
  if (alerts.some((a) => a.level === "danger")) return "danger";
  if (alerts.some((a) => a.level === "profit")) return "profit";
  if (alerts.some((a) => a.level === "caution")) return "caution";
  return null;
}
