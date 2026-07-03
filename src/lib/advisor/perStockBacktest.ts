/**
 * Phase 54 (v1.2): per-stock バックテスト接続口（設計のみ・将来Phase用API）。
 * 現段階では計算は行わず、Advisor と銘柄別バックテスト指標を結ぶインターフェースを定義する。
 * 将来 v1.3 で実データ（価格系列）から算出した指標を供給する想定。完全ローカル・外部API不使用。
 */

/** 銘柄別バックテスト指標。 */
export interface PerStockBacktest {
  code: string;
  pf: number | null; // プロフィットファクター
  maxDD: number | null; // 最大ドローダウン(%)
  winRate: number | null; // 勝率(0-1)
  cagr: number | null; // 年平均成長率(%)
  ruinProbability: number | null; // MC破産確率(0-1)
  expectedValue: number | null; // 1取引あたり期待リターン(%)
  tradeCount: number | null; // 総取引回数
  savedAt: string | null; // 最新計算日時(ISO)
}

/** コード→指標のマップ（Advisor へ注入する形）。 */
export type PerStockBacktestMap = Record<string, PerStockBacktest>;

/**
 * 供給元プロバイダのインターフェース（将来実装）。
 * v1.2 では未実装のため、常に空マップを返す no-op プロバイダを既定とする。
 */
export interface PerStockBacktestProvider {
  readonly name: string;
  getMap(codes: string[]): PerStockBacktestMap;
}

/** v1.2 既定：未接続（空マップ）。Advisor は市場平均シグナルにフォールバックする。 */
export const noopPerStockBacktestProvider: PerStockBacktestProvider = {
  name: "noop",
  getMap: () => ({}),
};

/** 現在の供給マップを取得（v1.2 は常に空）。将来は provider を差し替えるだけで接続可能。 */
export function getPerStockBacktest(codes: string[], provider: PerStockBacktestProvider = noopPerStockBacktestProvider): PerStockBacktestMap {
  return provider.getMap(codes);
}
