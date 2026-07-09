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

/**
 * J-Quants の5桁コードを TradingView（東証）の4桁表記へ正規化する。
 *
 * J-Quants は普通株を「4桁コード＋末尾0」の5桁で表す（例: 7203→72030 / 137A→137A0）。
 * TradingView は 4 桁（英字含む）表記を期待するため、この末尾0を除去する。
 *  - 5桁かつ末尾が "0" → 末尾を除去（72030→7203 / 137A0→137A）
 *  - 末尾が "0" 以外（優先株等の5桁, 例 25935）→ そのまま
 *  - 5桁以外（既に4桁・空文字など）→ そのまま
 */
export function normalizeTseCode(code: string): string {
  if (code.length === 5 && code.endsWith("0")) return code.slice(0, 4);
  return code;
}

/** 銘柄コードを TradingView シンボル（東証）へ変換する（5桁→4桁正規化を適用）。 */
export function tradingViewSymbol(code: string): string {
  return `TSE:${normalizeTseCode(code)}`;
}

/**
 * 個別銘柄の TradingView チャートページ URL（外部リンク用）。
 *
 * 無料の埋め込みウィジェットは日本の個別株データに非対応のため、
 * TradingView サイト側で開く外部リンクを生成する（4桁正規化を再利用）。
 */
export function tradingViewChartUrl(code: string): string {
  return `https://jp.tradingview.com/chart/?symbol=${tradingViewSymbol(code)}`;
}
