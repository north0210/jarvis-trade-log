/**
 * TradingView 埋込の設定・ヘルパー（表示層のみ）。
 *
 * 表示 ON/OFF は localStorage に保存する。
 *   key: jarvis-trade-log:tv-enabled  （既定 ON）
 *
 * ※ 分析ロジック（alerts.ts / score.ts / repository / types.ts）には一切依存しない。
 *    キー文字列は中央レジストリ（storage/keys.ts）の名前付き定数 K を参照する（6-1）。
 */
import { K } from "@/lib/storage/keys";

const TV_ENABLED_KEY = K.tvEnabled;

/** TradingView 表示が有効か（未設定時は既定 ON）。 */
export function isTradingViewEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(TV_ENABLED_KEY) !== "false";
}

/** TradingView 表示の ON/OFF を保存する。 */
export function setTradingViewEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TV_ENABLED_KEY, String(enabled));
}

/** 銘柄コードを TradingView シンボル（東証）へ変換する。 */
export function tradingViewSymbol(code: string): string {
  return `TSE:${code}`;
}
