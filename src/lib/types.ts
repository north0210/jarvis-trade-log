export type StockStatus = "買い候補" | "押し目待ち" | "保有中" | "見送り" | "危険";
export type StockRank = "S" | "A" | "B" | "C";
export type MacdState =
  | "ゴールデンクロス"
  | "デッドクロス"
  | "上昇中"
  | "下降中"
  | "横ばい"
  | "不明";

export interface Stock {
  id: string;
  code: string;
  name: string;
  market: string | null;
  theme: string | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  sales_growth: number | null;
  operating_margin: number | null;
  rsi: number | null;
  macd: MacdState;
  current_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  rank: StockRank;
  status: StockStatus;
  memo: string | null;
  price_updated_at: string | null;
  // Phase 42: 出来高（任意・非破壊追加）
  volume?: number;
  volumeTrend?: "increasing" | "decreasing" | "flat" | "unknown";
  relativeVolume?: number;
}

export interface Holding {
  id: string;
  stock_id: string;
  buy_price: number;
  shares: number;
  stop_loss: number | null;
  take_profit: number | null;
  memo?: string | null; // Phase 13: 保有株メモ（任意・非破壊追加）
  created_at?: string | null; // Phase 19: 取得日時（保有期間算出用・任意）
  score_at_entry?: number | null; // Phase 19: 取得時 JARVIS Score（任意）
  stocks?: Stock; // joined
}

// Phase 39: 戦略ランキングスナップショット。src/lib/backtest/ranking-snapshot.ts が扱う。
export interface StrategyRankingRow {
  strategyId: string;
  strategyName: string;
  rank: number;
  cagr: number;
  profitFactor: number | null;
  maxDrawdown: number;
  winRate: number;
  expectedValue: number;
  sharpe: number;
  tradeCount: number;
}
export interface StrategyRankingSnapshot {
  id: string;
  date: string; // YYYY-MM-DD
  period: string; // 例 "3年"
  initialCapital: number;
  targetStockCount: number;
  rankingResults: StrategyRankingRow[];
  bestStrategy: string;
  worstStrategy: string;
  averageCagr: number;
  averagePf: number;
  averageMaxDrawdown: number;
  averageWinRate: number;
  jarvisComment: string;
  createdAt: string; // ISO datetime
}

// Phase 32: レポートスナップショット。src/lib/report/snapshot.ts が扱う。
export interface ReportSnapshot {
  id: string;
  date: string; // YYYY-MM-DD
  period: "daily" | "weekly" | "monthly";
  totalAssets: number;
  totalPnl: number;
  realizedPnl: number;
  winRate: number; // 0〜1
  riskGrade: string;
  riskScore: number;
  disciplineScore: number;
  mentalScore: number;
  portfolioScore: number;
  bestStrategy: string;
  worstStrategy: string;
  bestFactor: string;
  worstFactor: string;
  cagr: number;
  maxDrawdown: number;
  ruinProbability: number;
  jarvisSummary: string;
  // Phase 40: 市況・セクター統合（任意・非破壊追加）
  marketState?: string;
  riskMode?: string;
  heatScore?: number;
  maxSector?: string;
  sectorConcentration?: number; // 0〜1
  source?: "auto" | "manual"; // Phase 41: 保存元（未定義は従来手動）
  createdAt: string; // ISO datetime
}

// Phase 21: 売買戦略テンプレート。src/lib/storage/strategyRepository.ts が扱う。
// 数値条件は null で「その条件は判定しない」を意味する。allowedGrades は空配列で「全Grade可」。
export interface Strategy {
  id: string;
  name: string;
  description: string;
  minScore: number | null;
  allowedGrades: string[];
  maxRsi: number | null;
  minRoe: number | null;
  minOperatingMargin: number | null;
  minSalesGrowth: number | null;
  maxPer: number | null;
  maxPbr: number | null;
  requiresStopLoss: boolean;
  maxPositionRate: number | null; // %（1銘柄比率の上限）
  targetProfitRate: number | null; // %（利確目安・参考値）
  maxLossRate: number | null; // %（損切り目安・参考値）
  // Phase 43: 出来高エントリー条件（任意・非破壊追加）
  minRelativeVolume?: number | null;
  requiredVolumeTrend?: "increasing" | "decreasing" | "flat" | null;
  avoidVolumeSpikeWithHighRsi?: boolean;
  createdAt: string;
}

// Phase 19: 確定売買の記録。src/lib/storage/tradeRepository.ts が扱う。
export interface Trade {
  id: string;
  date: string; // 売却日 YYYY-MM-DD
  stockCode: string;
  stockName: string;
  theme: string | null;
  action: "sellPartial" | "sellAll";
  buyPrice: number; // 平均取得単価
  sellPrice: number;
  shares: number;
  realizedPnl: number;
  realizedPnlRate: number;
  holdingDays: number | null;
  scoreAtEntry: number | null;
  scoreAtExit: number | null;
  reason: string | null;
  memo: string | null;
  strategyId?: string | null; // Phase 22: 紐付けた戦略（任意・非破壊追加）
  strategyName?: string | null; // Phase 22: 戦略名スナップショット
  createdAt: string; // ISO datetime
}

// Supabase スキーマ（0001_init.sql）対応の旧型。残置（Phase 4 以降は Journal を使用）。
export interface JournalEntry {
  id: string;
  entry_date: string;
  market_note: string | null;
  traded_stocks: string | null;
  buy_reason: string | null;
  sell_reason: string | null;
  emotion_note: string | null;
  reflection: string | null;
  jarvis_comment: string | null;
}

// Phase 4: 運用日誌（localStorage 版）。src/lib/storage/journalRepository.ts が扱う。
export interface Journal {
  id: string;
  date: string; // YYYY-MM-DD
  marketMemo: string | null;
  tradeMemo: string | null;
  boughtStocks: string | null;
  soldStocks: string | null;
  buyReason: string | null;
  sellReason: string | null;
  emotion: string | null;
  reflection: string | null;
  jarvisComment: string | null;
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}
