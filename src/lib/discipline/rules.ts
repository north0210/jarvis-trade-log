/**
 * 取引ルール違反検知（Rule Engine・完全ローカル・純関数）。
 * 保有株・銘柄・取引履歴・ポートフォリオから規律違反を検出し、規律スコアを算出する。
 * 既存の analyzePortfolio / holdingAlerts / scoreStock を再利用（それらは変更しない）。
 */
import type { Holding, Stock, Trade } from "@/lib/types";
import { holdingAlerts } from "@/lib/alerts";
import { scoreStock } from "@/lib/score";
import { analyzePortfolio } from "@/lib/analysis/portfolio";

export type DisciplineLevel = "info" | "warning" | "danger";

export interface DisciplineResult {
  id: string;
  level: DisciplineLevel;
  title: string;
  message: string;
  relatedStockCode: string | null;
  relatedStockName: string | null;
  createdAt: string;
}

export interface DisciplineReport {
  results: DisciplineResult[];
  score: number;
  dangerCount: number;
  warningCount: number;
  infoCount: number;
  comments: string[];
}

const pctStr = (r: number) => (r * 100).toFixed(1);

export function evaluateDiscipline(
  stocks: Stock[],
  holdings: Holding[],
  trades: Trade[],
  cash: number
): DisciplineReport {
  const now = new Date().toISOString();
  const byId = new Map(stocks.map((s) => [s.id, s]));
  const portfolio = analyzePortfolio(stocks, holdings, cash);
  const results: DisciplineResult[] = [];

  const push = (
    id: string,
    level: DisciplineLevel,
    title: string,
    message: string,
    stock?: Stock
  ) =>
    results.push({
      id,
      level,
      title,
      message,
      relatedStockCode: stock?.code ?? null,
      relatedStockName: stock?.name ?? null,
      createdAt: now,
    });

  // 保有を銘柄単位に集約
  const agg = new Map<string, { stock: Stock; hs: Holding[]; shares: number; cost: number }>();
  for (const h of holdings) {
    const stock = byId.get(h.stock_id);
    if (!stock) continue;
    const cur = agg.get(h.stock_id) ?? { stock, hs: [], shares: 0, cost: 0 };
    cur.hs.push(h);
    cur.shares += h.shares;
    cur.cost += h.buy_price * h.shares;
    agg.set(h.stock_id, cur);
  }

  for (const { stock, hs, shares, cost } of Array.from(agg.values())) {
    const avg = shares > 0 ? cost / shares : 0;
    const stopLoss = hs.find((x) => x.stop_loss != null)?.stop_loss ?? null;
    const takeProfit = hs.find((x) => x.take_profit != null)?.take_profit ?? null;
    const synth: Holding = {
      id: "",
      stock_id: stock.id,
      buy_price: avg,
      shares,
      stop_loss: stopLoss,
      take_profit: takeProfit,
    };
    const alerts = holdingAlerts(synth, stock);

    // 2. 損切りライン超過
    if (alerts.some((a) => a.kind === "STOP_HIT"))
      push(`stop-hit-${stock.code}`, "danger", "損切りライン超過", `${stock.name} が損切りラインを下回っています。`, stock);
    // 7. 損益率 -5% 以下を放置
    if (alerts.some((a) => a.kind === "LOSS_DANGER"))
      push(`loss-${stock.code}`, "danger", "含み損 -5% 放置", `${stock.name} の含み損が拡大しています。損切りラインを確認してください。`, stock);
    // 3. RSI80以上で保有（過熱買い）
    if (alerts.some((a) => a.kind === "RSI_HOT"))
      push(`rsi-${stock.code}`, "warning", "過熱圏での保有", `${stock.name} は RSI 過熱圏です。高値掴みに注意してください。`, stock);
    // 1. 損切り未設定
    if (stopLoss == null && stock.stop_loss == null)
      push(`no-stop-${stock.code}`, "warning", "損切り未設定", `${stock.name} に損切りラインが設定されていません。`, stock);
    // 8. 利確目標未設定
    if (takeProfit == null && stock.take_profit == null)
      push(`no-tp-${stock.code}`, "info", "利確目標未設定", `${stock.name} に利確目標が設定されていません。`, stock);
    // 6. Grade C/D 銘柄を保有
    const g = scoreStock(stock).grade;
    if (g === "C" || g === "D")
      push(`lowgrade-${stock.code}`, "warning", "低評価銘柄の保有", `${stock.name} は Grade ${g} です。保有継続の是非を検討してください。`, stock);
  }

  // 4. 1銘柄集中 40%以上
  if (portfolio.maxPosition && portfolio.maxPosition.ratio >= 0.4)
    push("concentration", "danger", "1銘柄集中", `${portfolio.maxPosition.name} が ${pctStr(portfolio.maxPosition.ratio)}% を占めています。`);
  // 5. 同一テーマ集中 60%以上
  const topTheme = portfolio.byTheme[0];
  if (topTheme && topTheme.ratio >= 0.6)
    push("theme-concentration", "danger", "テーマ集中", `${topTheme.key}テーマが ${pctStr(topTheme.ratio)}% を占めています。`);
  // 9. 現金比率 10%未満
  if (holdings.length > 0 && portfolio.cashRatio < 0.1)
    push("low-cash", "warning", "現金比率不足", `現金比率が ${pctStr(portfolio.cashRatio)}% です。押し目用資金が不足しています。`);

  // 10. 連続損失 3回以上
  const sorted = trades.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let streak = 0;
  for (const t of sorted) {
    if (t.realizedPnl < 0) streak++;
    else break;
  }
  if (streak >= 3)
    push("loss-streak", "danger", "連続損失", `直近 ${streak} 連敗中です。取引サイズの抑制を推奨します。`);

  const dangerCount = results.filter((r) => r.level === "danger").length;
  const warningCount = results.filter((r) => r.level === "warning").length;
  const infoCount = results.filter((r) => r.level === "info").length;
  const score = Math.max(0, 100 - dangerCount * 15 - warningCount * 8 - infoCount * 3);

  // JARVIS 警告コメント
  const comments: string[] = [];
  const has = (t: string) => results.some((r) => r.title === t);
  if (has("損切り未設定"))
    comments.push("損切りライン未設定の銘柄があります。出口戦略なしの突撃は、戦略というより趣味です、ボス。");
  if (has("テーマ集中"))
    comments.push(`${topTheme?.key ?? "特定"}テーマへの集中が高まっています。成長性は魅力的ですが、同じ方向に全砲門を向けるのは少々単純です。`);
  if (has("1銘柄集中"))
    comments.push("1銘柄への集中が過度です。分散は最良のリスク管理である、と私は考えます、ボス。");
  if (has("連続損失"))
    comments.push("連続損失が発生しています。次の取引サイズを抑えることを推奨します。");
  if (has("含み損 -5% 放置"))
    comments.push("含み損が拡大している銘柄を放置しています。損切りは早きに如かず、です。");
  if (comments.length === 0 && score >= 90)
    comments.push("規律は良好に保たれています。お見事です、ボス。");
  if (comments.length === 0)
    comments.push("軽微な指摘はありますが、規律は概ね維持されています。");

  return { results, score, dangerCount, warningCount, infoCount, comments };
}
