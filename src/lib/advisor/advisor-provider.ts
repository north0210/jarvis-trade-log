/**
 * Phase 56 (v1.4): Advisor へ銘柄別BT指標を供給するプロバイダ（完全ローカル）。
 * 保存済み銘柄別BT結果（stock-backtest）を PerStockBacktestMap に変換し、
 * Advisor エンジンの接続口へ渡す。外部API不使用。
 */
import { listStockBtResults } from "./stock-backtest";
import type { PerStockBacktestMap } from "./perStockBacktest";

/** 保存済みBT結果から銘柄別指標マップを構築（同一銘柄は最新を採用）。 */
export function getPerStockBacktestMap(): PerStockBacktestMap {
  const map: PerStockBacktestMap = {};
  for (const r of listStockBtResults()) {
    if (map[r.code]) continue; // listStockBtResults は保存日時降順 → 最初＝最新
    map[r.code] = {
      code: r.code,
      pf: r.profitFactor,
      maxDD: r.maxDrawdownPct,
      winRate: r.winRate,
      cagr: r.cagr,
      ruinProbability: r.mcRuin,
      expectedValue: r.expectedValuePct ?? null,
      tradeCount: r.tradeCount,
      savedAt: r.savedAt,
    };
  }
  return map;
}
