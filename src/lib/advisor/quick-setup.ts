/**
 * Phase 61 (v1.7): クイックセットアップ。
 * 銘柄コード入力だけで「登録 → 価格/RSI/MACD/出来高 自動取得 → Advisor評価 → AIコメント → 保存」を一括実行。
 * ファンダ(PER/PBR/ROE/営業利益率/売上成長率)は外部制約で自動取得できないため手入力fallback（欠損明示）。
 * 完全ローカル・外部ニュース/RSS/LINE/注文なし・投資助言ではない。
 */
import { getStockRepository, type StockInput } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded, getPrimaryStrategyId } from "@/lib/storage/strategyRepository";
import { getProviderMode } from "@/lib/pricing/settings";
import { updateStockPrice } from "@/lib/pricing/priceUpdater";
import { scoreStock } from "@/lib/score";
import { analyzePortfolio, getCashPosition } from "@/lib/analysis/portfolio";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { getDashboardRuns } from "@/lib/settings/performance";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateDiscipline } from "@/lib/discipline/rules";
import { evaluateRisk } from "@/lib/risk/risk-engine";
import { analyzeFactors } from "@/lib/analytics/factor-analysis";
import { adaptiveScoreStock, getAdaptiveScoreSettings } from "@/lib/score/adaptive-score";
import { getBacktestSummaries } from "@/lib/analytics/backtest-engine";
import { getThresholds } from "@/lib/settings/thresholds";
import { buildAdvisorReport } from "@/lib/advisor/advisor-engine";
import { getPerStockBacktestMap } from "@/lib/advisor/advisor-provider";
import { templateComment } from "@/lib/advisor/ai-layer";
import { getAiConfig, effectiveAiMode } from "@/lib/advisor/advisor-ai-settings";
import type { AdvisorItem } from "@/lib/advisor/advisorTypes";

export interface QuickSetupResult {
  ok: boolean;
  code: string;
  name: string;
  created: boolean; // 新規作成したか
  autoFilled: string[]; // 自動取得できた項目
  missing: string[]; // 手入力が必要な欠損項目
  priceMsg: string;
  score: number;
  grade: string;
  advisor: AdvisorItem | null;
  aiComment: string | null; // AIモードOFFなら null
  steps: string[]; // 実行ログ（UI表示用）
}

const emptyStock = (code: string, name: string): StockInput => ({
  code: code.trim(),
  name: name.trim() || code.trim(),
  market: null,
  theme: null,
  per: null,
  pbr: null,
  roe: null,
  sales_growth: null,
  operating_margin: null,
  rsi: null,
  macd: "不明",
  current_price: null,
  stop_loss: null,
  take_profit: null,
  rank: "B",
  status: "買い候補",
  memo: null,
  price_updated_at: null,
});

export async function quickSetup(code: string, name: string): Promise<QuickSetupResult> {
  const steps: string[] = [];
  const repo = getStockRepository();
  const trimmed = code.trim();
  if (!trimmed) {
    return { ok: false, code, name, created: false, autoFilled: [], missing: [], priceMsg: "銘柄コードを入力してください。", score: 0, grade: "D", advisor: null, aiComment: null, steps };
  }

  // 1) 登録（既存ならそのまま）
  let list = await repo.list();
  let stock = list.find((s) => s.code === trimmed);
  let created = false;
  if (!stock) {
    stock = await repo.create(emptyStock(trimmed, name));
    created = true;
    steps.push(`銘柄登録: ${stock.name}（${stock.code}）`);
  } else {
    steps.push(`既存銘柄を使用: ${stock.name}（${stock.code}）`);
  }

  // 2) 価格/RSI/MACD/出来高 自動取得
  let priceMsg: string;
  if (getProviderMode() === "jquants-ready") {
    const r = await updateStockPrice(stock.id);
    priceMsg = r.message;
    steps.push(r.ok ? "自動取得: 現在価格 / RSI / MACD / 相対出来高 / 出来高トレンド" : `自動取得失敗（手入力へfallback）: ${r.message}`);
  } else {
    priceMsg = "手入力モードです（設定でJ-Quantsへ切替すると自動取得）。価格・指標は編集画面で入力してください。";
    steps.push("自動取得スキップ: 手入力モード");
  }

  // 3) 最新状態を読み直し
  list = await repo.list();
  stock = list.find((s) => s.code === trimmed) ?? stock;

  const autoFilled: string[] = [];
  if (stock.current_price != null) autoFilled.push("現在価格");
  if (stock.rsi != null) autoFilled.push("RSI");
  if (stock.macd && stock.macd !== "不明") autoFilled.push("MACD");
  if (stock.relativeVolume != null) autoFilled.push("相対出来高");
  if (stock.volumeTrend && stock.volumeTrend !== "unknown") autoFilled.push("出来高トレンド");

  const missing: string[] = [];
  if (stock.per == null) missing.push("PER");
  if (stock.pbr == null) missing.push("PBR");
  if (stock.roe == null) missing.push("ROE");
  if (stock.operating_margin == null) missing.push("営業利益率");
  if (stock.sales_growth == null) missing.push("売上成長率");
  if (stock.rsi == null) missing.push("RSI");
  if (stock.current_price == null) missing.push("現在価格");

  // 4) Score
  const sc = scoreStock(stock);
  steps.push(`JARVIS Score 算出: ${sc.score}（Grade ${sc.grade}）`);

  // 5) Advisor 生成（全体コンテキストで評価）
  const [holdings, trades, strategies] = await Promise.all([getHoldingRepository().list(), getTradeRepository().list(), ensureSeeded()]);
  const cash = getCashPosition();
  const th = getThresholds();
  const portfolio = analyzePortfolio(list, holdings, cash);
  const mc = trades.length ? runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: getDashboardRuns() }) : null;
  const discipline = evaluateDiscipline(list, holdings, trades, cash);
  const risk = mc ? evaluateRisk(portfolio, mc, runBacktest(trades), discipline, trades, th) : null;
  const factor = analyzeFactors(list, trades, strategies, risk, discipline);
  const weights = getAdaptiveScoreSettings().factorWeights;
  const adaptiveByCode: Record<string, number> = {};
  for (const s of list) adaptiveByCode[s.code] = adaptiveScoreStock(s, factor, weights).score;
  const primary = strategies.find((x) => x.id === getPrimaryStrategyId()) ?? strategies[0] ?? null;
  const report = buildAdvisorReport({ stocks: list, holdings, portfolio, risk, discipline, btSummaries: getBacktestSummaries(), primaryStrategy: primary, thresholds: th, adaptiveByCode, perStock: getPerStockBacktestMap() });
  const advisor = report.items.find((i) => i.code === trimmed) ?? null;
  if (advisor) steps.push(`Advisor 判定: ${advisor.grade}（${advisor.category}）`);

  // 6) AIコメント（OFFなら生成しない）
  let aiComment: string | null = null;
  if (effectiveAiMode() !== "off" && advisor) {
    aiComment = templateComment({ title: `${stock.name}（${stock.code}）`, facts: advisor.reasons }, getAiConfig().style, getAiConfig().detail);
    steps.push("AIコメント生成（ローカル・判断補助）");
  }

  steps.push("localStorage 保存完了。Dashboard / Watchlist は次回読込で反映されます。");

  return { ok: true, code: trimmed, name: stock.name, created, autoFilled, missing, priceMsg, score: sc.score, grade: sc.grade, advisor, aiComment, steps };
}
