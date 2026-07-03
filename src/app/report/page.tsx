"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import PageIntro from "@/components/PageIntro";
import HelpTooltip from "@/components/HelpTooltip";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getJournalRepository } from "@/lib/storage/journalRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded } from "@/lib/storage/strategyRepository";
import { analyzePortfolio, getCashPosition } from "@/lib/analysis/portfolio";
import { scoreStock } from "@/lib/score";
import { stockAlerts } from "@/lib/alerts";
import { analyzeTrades } from "@/lib/analysis/trades";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { getAnalysisRuns } from "@/lib/settings/performance";
import { buildVolumeReport } from "@/lib/report/volume-report";
import { buildAdvisorReport } from "@/lib/advisor/advisor-engine";
import { getAdvisorWeights, detectPreset, appliedPercents, WEIGHT_KEYS, WEIGHT_META } from "@/lib/settings/advisor-settings";
import { listAiComments } from "@/lib/advisor/ai-comment";
import { listStockBtResults } from "@/lib/advisor/stock-backtest";
import { getPerStockBacktestMap } from "@/lib/advisor/advisor-provider";
import { listDetections } from "@/lib/watchlist/watchlist-monitor";
import Disclaimer from "@/components/Disclaimer";
import AiComment from "@/components/AiComment";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateDiscipline } from "@/lib/discipline/rules";
import { evaluateRisk } from "@/lib/risk/risk-engine";
import { analyzeFactors } from "@/lib/analytics/factor-analysis";
import { analyzeMental } from "@/lib/mental/mental-analysis";
import { getBacktestSummaries } from "@/lib/analytics/backtest-engine";
import { adaptiveScoreStock, getAdaptiveScoreSettings } from "@/lib/score/adaptive-score";
import { generateImprovements, getDismissedImprovements } from "@/lib/strategy/rule-improver";
import { computeSnapshotFields, getReportSnapshotRepository } from "@/lib/report/snapshot";
import { computeMarketRadar } from "@/lib/market/market-radar";
import { computeSectorHeatmap } from "@/lib/market/sector-heatmap";
import { generateRebalance } from "@/lib/portfolio/rebalance-engine";
import { matchStrategy } from "@/lib/strategy/match";
import { getPrimaryStrategyId } from "@/lib/storage/strategyRepository";
import { getStrategyRankingSnapshotRepository } from "@/lib/backtest/ranking-snapshot";
import { VOLUME_TREND_LABEL } from "@/lib/indicators/volume";
import Link from "next/link";
import type { Holding, Journal, ReportSnapshot, Stock, Strategy, StrategyRankingSnapshot, Trade } from "@/lib/types";

const snapshotRepo = getReportSnapshotRepository();
const rankingRepo = getStrategyRankingSnapshotRepository();

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const journalRepo = getJournalRepository();
const tradeRepo = getTradeRepository();

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const yen = (n: number) => `${n >= 0 ? "+" : ""}¥${fmt(n)}`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

function Row({ label, value, tone }: { label: ReactNode; value: string; tone?: string }) {
  return (
    <div className="flex justify-between text-sm font-mono border-b border-line/40 py-1">
      <span className="text-arcdim">{label}</span>
      <span className={tone ?? "text-[#cfeaff]"}>{value}</span>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="hud-panel p-4 report-section">
      <h2 className="hud-label mb-3">{n}. {title}</h2>
      {children}
    </section>
  );
}

export default function ReportPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [cash, setCash] = useState(0);
  const [today, setToday] = useState("");
  const [period, setPeriod] = useState<ReportSnapshot["period"]>("weekly");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [rankingLatest, setRankingLatest] = useState<StrategyRankingSnapshot | null>(null);

  useEffect(() => {
    (async () => {
      const [s, h, j, t, strats] = await Promise.all([
        stockRepo.list(),
        holdingRepo.list(),
        journalRepo.list(),
        tradeRepo.list(),
        ensureSeeded(),
      ]);
      setStocks(s);
      setHoldings(h);
      setJournals(j);
      setTrades(t);
      setStrategies(strats);
      setCash(getCashPosition());
      setToday(new Date().toISOString().slice(0, 16).replace("T", " "));
      const ranks = await rankingRepo.list();
      setRankingLatest(ranks[0] ?? null);
    })();
  }, []);

  const d = useMemo(() => {
    const portfolio = analyzePortfolio(stocks, holdings, cash);
    const mc = trades.length ? runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: getAnalysisRuns() }) : null;
    const backtest = runBacktest(trades);
    const discipline = evaluateDiscipline(stocks, holdings, trades, cash);
    const risk = mc ? evaluateRisk(portfolio, mc, backtest, discipline, trades) : null;
    const factor = analyzeFactors(stocks, trades, strategies, risk, discipline);
    const mental = trades.length ? analyzeMental(journals, trades) : null;
    const tradeStats = analyzeTrades(trades);
    const btSummaries = getBacktestSummaries();
    const adaptive = getAdaptiveScoreSettings();

    const volume = buildVolumeReport(stocks);

    // JARVIS Advisor 統合
    const advWeights = getAdvisorWeights();
    const advAdaptive: Record<string, number> = {};
    for (const st of stocks) advAdaptive[st.code] = adaptiveScoreStock(st, factor, adaptive.factorWeights).score;
    const advPrimary = strategies.find((x) => x.id === getPrimaryStrategyId()) ?? strategies[0] ?? null;
    const advisor = buildAdvisorReport({ stocks, holdings, portfolio, risk, discipline, btSummaries, primaryStrategy: advPrimary, thresholds: undefined, weights: advWeights, adaptiveByCode: advAdaptive, perStock: getPerStockBacktestMap() });
    const aiLatest = listAiComments()[0] ?? null;
    const stockBt = listStockBtResults().slice(0, 5);
    const detections = listDetections();
    const scored = stocks.map((s) => ({ s, r: scoreStock(s) })).sort((a, b) => b.r.score - a.r.score);
    const topStocks = scored.slice(0, 5);
    const dangerStocks = stocks.filter((s) => stockAlerts(s).some((a) => a.level === "danger"));

    const dismissed = getDismissedImprovements();
    const improvements = generateImprovements(
      trades,
      strategies,
      { maxRatio: portfolio.maxPosition?.ratio ?? 0, maxName: portfolio.maxPosition?.name ?? null },
      "—"
    ).filter((i) => !dismissed.includes(i.id));

    const radar = stocks.length ? computeMarketRadar({ stocks, portfolio, risk, mc, discipline, mental, factor }) : null;
    const sector = stocks.length ? computeSectorHeatmap(stocks, holdings) : null;
    const rebalance = stocks.length ? generateRebalance({ portfolio, risk, marketRadar: radar, sector, holdings, stocks, cash, now: "—" }) : [];

    // 戦略サマリー（登録数・主戦略・違反数）
    const primary = strategies.find((x) => x.id === getPrimaryStrategyId()) ?? strategies[0] ?? null;
    let strategyViolations = 0;
    if (primary) {
      for (const stock of stocks) {
        const hs = holdings.filter((h) => h.stock_id === stock.id);
        if (hs.length === 0) continue;
        const shares = hs.reduce((a, x) => a + x.shares, 0);
        const cost = hs.reduce((a, x) => a + x.buy_price * x.shares, 0);
        const value = stock.current_price != null ? stock.current_price * shares : cost;
        const positionRatio = portfolio.totalValue > 0 ? value / portfolio.totalValue : null;
        const hasStopLoss = hs.some((x) => x.stop_loss != null) || stock.stop_loss != null;
        if (matchStrategy(primary, stock, scoreStock(stock), { positionRatio, hasStopLoss }).violations.length > 0) strategyViolations++;
      }
    }

    return { portfolio, mc, backtest, discipline, risk, factor, mental, tradeStats, btSummaries, adaptive, topStocks, dangerStocks, improvements, radar, sector, rebalance, volume, advisor, advWeights, aiLatest, stockBt, detections, strategyCount: strategies.length, primaryName: primary?.name ?? "—", strategyViolations };
  }, [stocks, holdings, journals, trades, strategies, cash]);

  const p = d.portfolio;

  const saveSnapshot = async () => {
    const fields = computeSnapshotFields(stocks, holdings, journals, trades, strategies, cash);
    await snapshotRepo.create({ date: new Date().toISOString().slice(0, 10), period, ...fields, source: "manual" });
    setSaveMsg(`スナップショットを保存しました（${period}）。`);
  };

  return (
    <div className="space-y-6">
      <PageIntro title="🗒 投資レポート" description="運用状況を1枚に集約し、PDF出力できます。" />
      <section className="hud-panel p-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-[0.2em] text-arc">J.A.R.V.I.S — 投資レポート</h1>
          <p className="hud-label mt-1">生成日時: {today}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <select className="hud-input w-28" value={period} onChange={(e) => setPeriod(e.target.value as ReportSnapshot["period"])}>
            <option value="daily">日次</option>
            <option value="weekly">週次</option>
            <option value="monthly">月次</option>
          </select>
          <button className="hud-btn" onClick={saveSnapshot}>現在の状態を保存</button>
          <Link href="/report-history" className="hud-btn text-xs px-3 py-1">履歴 →</Link>
          <button className="hud-btn" onClick={() => window.print()}>PDF出力</button>
        </div>
      </section>
      {saveMsg && <p className="text-profit text-sm font-mono no-print">{saveMsg}</p>}

      <Disclaimer compact />

      {/* 1. サマリー */}
      <Section n={1} title="サマリー">
        <div className="grid sm:grid-cols-2 gap-x-6">
          <Row label="総資産（現金込）" value={`¥${fmt(p.totalAssets)}`} tone="text-arc" />
          <Row label="現金比率" value={pct(p.cashRatio)} />
          <Row label="含み損益" value={yen(p.pnl)} tone={p.pnl >= 0 ? "text-profit" : "text-danger"} />
          <Row label="含み損益率" value={`${p.pnlPct >= 0 ? "+" : ""}${p.pnlPct.toFixed(2)}%`} tone={p.pnlPct >= 0 ? "text-profit" : "text-danger"} />
          <Row label="実現損益（累計）" value={yen(d.tradeStats.totalRealizedPnl)} tone={d.tradeStats.totalRealizedPnl >= 0 ? "text-profit" : "text-danger"} />
          <Row label="勝率" value={d.tradeStats.count ? `${(d.tradeStats.winRate * 100).toFixed(0)}% (${d.tradeStats.wins}/${d.tradeStats.count})` : "—"} />
          <Row label={<HelpTooltip termKey="riskgrade" label="Risk Grade" />} value={d.risk ? `${d.risk.riskGrade}（Score ${d.risk.riskScore}）` : "—"} />
          <Row label="Discipline Score" value={`${d.discipline.score}`} />
          <Row label="Mental Score" value={d.mental ? `${d.mental.mentalScore}` : "—"} />
          <Row label="保有銘柄数" value={`${p.holdingCount}`} />
        </div>
      </Section>

      {/* 2. ポートフォリオ */}
      <Section n={2} title="ポートフォリオ分析">
        <div className="grid md:grid-cols-2 gap-x-6">
          <div>
            <p className="hud-label mb-1">銘柄別 保有比率（上位）</p>
            {p.byStock.slice(0, 5).map((s) => <Row key={s.key} label={s.key} value={pct(s.ratio)} />)}
          </div>
          <div>
            <p className="hud-label mb-1">テーマ別 / Grade別</p>
            {p.byTheme.slice(0, 3).map((s) => <Row key={s.key} label={`テーマ:${s.key}`} value={pct(s.ratio)} />)}
            {p.byGrade.map((s) => <Row key={s.key} label={`Grade:${s.key}`} value={pct(s.ratio)} />)}
          </div>
        </div>
        <Row label="最大集中銘柄" value={p.maxPosition ? `${p.maxPosition.name} ${pct(p.maxPosition.ratio)}` : "—"} tone={p.maxPosition && p.maxPosition.ratio >= 0.4 ? "text-danger" : "text-[#cfeaff]"} />
      </Section>

      {/* 3. 銘柄スコア */}
      <Section n={3} title="銘柄スコア">
        <p className="hud-label mb-1">上位銘柄</p>
        {d.topStocks.map(({ s, r }) => {
          const adj = d.adaptive.enabled ? adaptiveScoreStock(s, d.factor, d.adaptive.factorWeights) : null;
          return (
            <Row
              key={s.id}
              label={`${s.name} (${s.code}) — ${r.grade}`}
              value={adj ? `Score ${r.score} → Adaptive ${adj.score}（${adj.adjustment >= 0 ? "+" : ""}${adj.adjustment}）` : `Score ${r.score}`}
              tone="text-arc"
            />
          );
        })}
        <p className="hud-label mb-1 mt-3">危険銘柄</p>
        {d.dangerStocks.length === 0 ? (
          <p className="text-arcdim text-sm">なし</p>
        ) : (
          d.dangerStocks.map((s) => <Row key={s.id} label={`${s.name} (${s.code})`} value={stockAlerts(s).map((a) => a.label).join(" / ")} tone="text-danger" />)
        )}
        <p className="hud-label mb-1 mt-3">出来高急増銘柄（相対出来高 ≥ 1.5x）</p>
        {stocks.filter((s) => s.relativeVolume != null && s.relativeVolume >= 1.5).length === 0 ? (
          <p className="text-arcdim text-sm">なし</p>
        ) : (
          stocks
            .filter((s) => s.relativeVolume != null && s.relativeVolume >= 1.5)
            .map((s) => (
              <Row
                key={s.id}
                label={`${s.name} (${s.code})`}
                value={`相対出来高 ${s.relativeVolume}x / トレンド ${VOLUME_TREND_LABEL[s.volumeTrend ?? "unknown"]}${s.rsi != null && s.rsi >= 80 ? " ・過熱注意" : ""}`}
                tone={s.rsi != null && s.rsi >= 80 ? "text-danger" : "text-arc"}
              />
            ))
        )}
      </Section>

      {/* 4. Risk Engine */}
      <Section n={4} title="Risk Engine">
        {d.risk ? (
          <div className="grid sm:grid-cols-2 gap-x-6">
            <Row label={<HelpTooltip termKey="var" label="VaR95（1取引）" />} value={`¥${fmt(d.risk.var95)}（${d.risk.var95Pct.toFixed(1)}%）`} tone="text-danger" />
            <Row label="CVaR95" value={`¥${fmt(d.risk.cvar95)}（${d.risk.cvar95Pct.toFixed(1)}%）`} tone="text-danger" />
            <Row label="DD95（MC）" value={`${d.risk.dd95.toFixed(1)}%`} tone="text-caution" />
            <Row label="最大DD（実績）" value={`${d.risk.maxDrawdown.toFixed(1)}%`} tone="text-caution" />
            <Row label="破産確率" value={pct(d.risk.ruinProbability)} tone={d.risk.ruinProbability > 0.05 ? "text-danger" : "text-[#cfeaff]"} />
            <Row label="資産半減確率" value={pct(d.risk.halfCapitalProbability)} tone={d.risk.halfCapitalProbability > 0.1 ? "text-danger" : "text-[#cfeaff]"} />
          </div>
        ) : (
          <p className="text-arcdim text-sm">取引履歴が不足しているため算出できません。</p>
        )}
      </Section>

      {/* 5. Backtest / MonteCarlo */}
      <Section n={5} title="Backtest / MonteCarlo">
        <div className="grid sm:grid-cols-2 gap-x-6">
          <Row label="実績PF" value={d.backtest.profitFactor != null ? d.backtest.profitFactor.toFixed(2) : "—"} />
          <Row label="実績 最大DD" value={`${d.backtest.maxDrawdownPct.toFixed(1)}%`} tone="text-caution" />
          <Row label="期待値/取引" value={yen(d.backtest.expectancy)} tone={d.backtest.expectancy >= 0 ? "text-profit" : "text-danger"} />
          <Row label="MC 期待リターン" value={d.mc ? `${d.mc.expectedReturnPct >= 0 ? "+" : ""}${d.mc.expectedReturnPct.toFixed(1)}%` : "—"} />
          <Row label="MC 95%信頼区間" value={d.mc ? `${d.mc.ci5Pct.toFixed(0)}〜${d.mc.ci95Pct.toFixed(0)}%` : "—"} />
          <Row label={<HelpTooltip termKey="cagr" label="実データ 平均CAGR" />} value={d.btSummaries.length ? `${(d.btSummaries.reduce((a, s) => a + s.cagr, 0) / d.btSummaries.length).toFixed(1)}%` : "未実行"} />
        </div>
      </Section>

      {/* 6. Factor */}
      <Section n={6} title="Factor分析">
        <Row label="最強Factor" value={d.factor.bestFactor ? `${d.factor.bestFactor.label}（寄与 +${(d.factor.bestFactor.contribution * 100).toFixed(0)}%）` : "—"} tone="text-arc" />
        <Row label="最弱Factor" value={d.factor.worstFactor ? `${d.factor.worstFactor.label}（寄与 ${(d.factor.worstFactor.contribution * 100).toFixed(0)}%）` : "—"} tone="text-danger" />
        {d.factor.factors.map((f) => (
          <Row key={f.key} label={f.label} value={`平均Score ${f.avgScore.toFixed(0)} / 寄与 ${(f.contribution * 100).toFixed(0)}%`} />
        ))}
      </Section>

      {/* 7. メンタル */}
      <Section n={7} title="取引メンタル分析">
        {d.mental ? (
          <>
            <Row label="Mental Score" value={`${d.mental.mentalScore}`} />
            <Row label="危険感情" value={d.mental.riskEmotion && d.mental.riskEmotion.avgPnl < 0 ? d.mental.riskEmotion.emotion : "—"} tone="text-danger" />
            <Row label="好成績感情" value={d.mental.bestEmotion && d.mental.bestEmotion.avgPnl > 0 ? d.mental.bestEmotion.emotion : "—"} tone="text-arc" />
            <ul className="mt-2 space-y-1 text-sm font-mono text-arcdim">
              {d.mental.comments.map((c, i) => <li key={i}>・{c}</li>)}
            </ul>
          </>
        ) : (
          <p className="text-arcdim text-sm">取引履歴が不足しています。</p>
        )}
      </Section>

      {/* 8. Market Radar */}
      <Section n={8} title="マーケットレーダー">
        {d.radar ? (
          <div className="grid sm:grid-cols-2 gap-x-6">
            <Row label="Market State" value={d.radar.marketState} tone="text-arc" />
            <Row label="Risk Mode" value={d.radar.riskMode} />
            <Row label="Heat Score" value={`${d.radar.heatScore}`} tone={d.radar.heatScore >= 75 ? "text-danger" : "text-[#cfeaff]"} />
            <Row label="現金推奨" value={`${d.radar.cashRecommendation}%（現在 ${(p.cashRatio * 100).toFixed(0)}%）`} />
          </div>
        ) : (
          <p className="text-arcdim text-sm">銘柄未登録。</p>
        )}
      </Section>

      {/* 9. Sector Heatmap */}
      <Section n={9} title="セクターヒートマップ">
        {d.sector ? (
          <div className="grid sm:grid-cols-2 gap-x-6">
            <Row label="最強セクター" value={d.sector.strongest ? `${d.sector.strongest.sectorName}（${d.sector.strongest.heatScore.toFixed(0)}）` : "—"} tone="text-arc" />
            <Row label="最過熱セクター" value={d.sector.hottest && d.sector.hottest.averageRsi != null ? `${d.sector.hottest.sectorName}（RSI ${d.sector.hottest.averageRsi.toFixed(0)}）` : "—"} />
            <Row label="最大保有テーマ" value={d.sector.maxHoldingSector ? `${d.sector.maxHoldingSector.sectorName}（${(d.sector.maxHoldingSector.portfolioWeight * 100).toFixed(0)}%）` : "—"} tone={d.sector.maxHoldingSector && d.sector.maxHoldingSector.portfolioWeight >= 0.5 ? "text-danger" : "text-[#cfeaff]"} />
            <Row label="セクター集中警告" value={d.sector.maxHoldingSector && d.sector.maxHoldingSector.portfolioWeight >= 0.5 ? "集中警告" : "許容範囲"} tone={d.sector.maxHoldingSector && d.sector.maxHoldingSector.portfolioWeight >= 0.5 ? "text-danger" : "text-arcdim"} />
          </div>
        ) : (
          <p className="text-arcdim text-sm">—</p>
        )}
      </Section>

      {/* 10. Volume Analysis */}
      <Section n={10} title="出来高分析">
        {!d.volume.hasData ? (
          <p className="text-arcdim text-sm">出来高データが不足しています。価格更新後に再解析します、ボス。</p>
        ) : (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-x-6">
              <Row label={<HelpTooltip termKey="relativevolume" label="出来高急増" />} value={`${d.volume.surgeCount} 件（うち危険 ${d.volume.dangerSurgeCount} 件）`} tone={d.volume.surgeCount > 0 ? "text-arc" : "text-arcdim"} />
              <Row label={<HelpTooltip termKey="rsi" label="RSI高値＋出来高急増" />} value={`${d.volume.overheatCount} 件`} tone={d.volume.overheatCount > 0 ? "text-danger" : "text-arcdim"} />
              <Row label={<HelpTooltip termKey="volumetrend" label="出来高急減/低下" />} value={`${d.volume.dropCount} 件`} tone={d.volume.dropCount > 0 ? "text-caution" : "text-arcdim"} />
              <Row label={<HelpTooltip termKey="relativevolume" label="最大相対出来高" />} value={d.volume.maxRelVol ? `${d.volume.maxRelVol.name}（${(d.volume.maxRelVol.relativeVolume ?? 0).toFixed(1)}x）` : "—"} tone="text-arc" />
              <Row label={<HelpTooltip termKey="volumetrend" label="出来高トレンド" />} value={`増 ${d.volume.trendDist.increasing} / 横 ${d.volume.trendDist.flat} / 減 ${d.volume.trendDist.decreasing}`} />
            </div>

            <div className="overflow-x-auto">
              <p className="hud-label mb-1"><HelpTooltip termKey="relativevolume" label="相対出来高ランキング（上位8）" /></p>
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="hud-label text-left">
                    {["#", "銘柄", "相対出来高", "トレンド", "RSI"].map((h) => <th key={h} className="pb-1 pr-3 font-normal">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {d.volume.ranking.slice(0, 8).map((r, i) => {
                    const rv = r.relativeVolume ?? 0;
                    const tone = rv >= d.volume.thresholds.relativeVolumeDanger ? "text-danger" : rv >= d.volume.thresholds.relativeVolumeWarning ? "text-caution" : "text-[#cfeaff]";
                    return (
                      <tr key={r.code} className="border-t border-line/60">
                        <td className="py-1 pr-3 text-arcdim">{i + 1}</td>
                        <td className="py-1 pr-3 text-arc">{r.name}<span className="text-arcdim"> ({r.code})</span></td>
                        <td className={`py-1 pr-3 ${tone}`}>{rv.toFixed(2)}x</td>
                        <td className="py-1 pr-3 text-arcdim">{r.volumeTrend}</td>
                        <td className="py-1 pr-3">{r.rsi != null ? r.rsi.toFixed(0) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="space-y-1 text-sm font-mono text-arc leading-relaxed">
              {d.volume.comments.map((c, i) => <li key={i}>・{c}</li>)}
            </ul>
          </div>
        )}
      </Section>

      {/* 11. JARVIS Advisor */}
      <Section n={11} title="JARVIS Advisor（判断補助）">
        {!d.advisor.hasData ? (
          <p className="text-arcdim text-sm">{d.advisor.comments[0]}</p>
        ) : (
          <div className="space-y-3">
            {/* サマリー件数 */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-6">
              <Row label={<HelpTooltip termKey="" label="Strong Buy" text="合成スコアが特に高く、押し目・低リスク・戦略適合・規律良好が揃った強気候補。断定ではありません。" />} value={`${d.advisor.counts.strongBuy} 件`} tone={d.advisor.counts.strongBuy > 0 ? "text-profit" : undefined} />
              <Row label="Buy" value={`${d.advisor.counts.buy} 件`} tone={d.advisor.counts.buy > 0 ? "text-arc" : undefined} />
              <Row label="Watch" value={`${d.advisor.counts.watch} 件`} />
              <Row label="Hold" value={`${d.advisor.counts.hold} 件`} />
              <Row label="Reduce" value={`${d.advisor.counts.reduce} 件`} tone={d.advisor.counts.reduce > 0 ? "text-caution" : undefined} />
              <Row label="Sell Candidate" value={`${d.advisor.counts.sellCandidate} 件`} tone={d.advisor.counts.sellCandidate > 0 ? "text-danger" : undefined} />
              <Row label={<HelpTooltip termKey="" label="Danger" text="損切りライン到達に加え、リスク悪化・出来高減少・規律違反などが重なった危険銘柄。防御的対応を検討。" />} value={`${d.advisor.counts.danger} 件`} tone={d.advisor.counts.danger > 0 ? "text-danger" : undefined} />
            </div>

            {/* 買い候補 Top10 */}
            <div className="overflow-x-auto">
              <p className="hud-label mb-1"><HelpTooltip termKey="" label="買い候補 Top10" text="Strong Buy / Buy を Advisor Score（合成）降順に最大10件表示します。" /></p>
              {[...d.advisor.byCategory.strongBuy, ...d.advisor.byCategory.buy].length === 0 ? (
                <p className="text-arcdim text-sm">現在、買い候補はありません。</p>
              ) : (
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="hud-label text-left">
                      {["コード", "銘柄", <HelpTooltip key="as" termKey="" label="Advisor Score" text="7指標を重み付けした0-100の合成スコア。高いほど条件が揃っている目安（投資助言ではありません）。" />, <HelpTooltip key="ag" termKey="" label="評価" text="Advisor Grade。合成スコアの段階（S/A+/A/B+/B/C/D）。" />, "推奨理由"].map((h, i) => <th key={i} className="pb-1 pr-3 font-normal">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.advisor.byCategory.strongBuy, ...d.advisor.byCategory.buy].sort((a, b) => b.composite - a.composite).slice(0, 10).map((it) => (
                      <tr key={it.code} className="border-t border-line/60">
                        <td className="py-1 pr-3 text-arc">{it.code}</td>
                        <td className="py-1 pr-3">{it.name}</td>
                        <td className="py-1 pr-3 text-arc">{it.composite}</td>
                        <td className="py-1 pr-3">{it.grade}</td>
                        <td className="py-1 pr-3 text-[#cfeaff]">{it.reasons.join(" / ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 警戒候補 */}
            <div>
              <p className="hud-label mb-1">警戒候補（Danger / Sell Candidate / Reduce）</p>
              {[...d.advisor.byCategory.danger, ...d.advisor.byCategory.sellCandidate, ...d.advisor.byCategory.reduce].length === 0 ? (
                <p className="text-arcdim text-sm">警戒候補はありません。</p>
              ) : (
                <ul className="space-y-1">
                  {[...d.advisor.byCategory.danger, ...d.advisor.byCategory.sellCandidate, ...d.advisor.byCategory.reduce].map((it) => (
                    <li key={it.code} className="text-sm font-mono">
                      <span className="text-danger">{it.code} {it.name}</span>
                      <span className="text-arcdim"> — {it.reasons.join(" / ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Advisor Snapshot（メタ情報） */}
            <div className="rounded border border-line/60 p-3">
              <p className="hud-label mb-1"><HelpTooltip termKey="" label="Advisor Snapshot" text="このレポート時点の Advisor 設定（保存日時・プリセット・使用重み）。印刷/PDFにも含まれます。" /></p>
              <p className="text-xs font-mono text-arcdim">保存日時: <span className="text-arc">{today}</span> ／ プリセット: <span className="text-arc">{detectPreset(d.advWeights)}</span></p>
              <p className="text-xs font-mono text-arcdim mt-1">
                使用重み（適用%）: {WEIGHT_KEYS.map((k) => `${WEIGHT_META[k].label} ${appliedPercents(d.advWeights)[k]}`).join(" / ")}
              </p>
            </div>

            {/* v1.3 拡張: 銘柄別BT / Watchlist / AIコメント */}
            {d.stockBt.length > 0 && (
              <div className="overflow-x-auto">
                <p className="hud-label mb-1"><HelpTooltip termKey="stockbt" label="銘柄別バックテスト（最新5件）" /></p>
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="hud-label text-left">{["銘柄", "戦略", "勝率", "PF", "最大DD", "CAGR"].map((h) => <th key={h} className="pb-1 pr-3 font-normal">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {d.stockBt.map((r) => (
                      <tr key={`${r.code}-${r.strategyId}`} className="border-t border-line/60">
                        <td className="py-1 pr-3 text-arc">{r.code} {r.name}</td>
                        <td className="py-1 pr-3">{r.strategyName}</td>
                        <td className="py-1 pr-3">{(r.winRate * 100).toFixed(0)}%</td>
                        <td className="py-1 pr-3">{r.profitFactor != null ? r.profitFactor.toFixed(2) : "—"}</td>
                        <td className="py-1 pr-3 text-caution">{r.maxDrawdownPct.toFixed(1)}%</td>
                        <td className={`py-1 pr-3 ${r.cagr >= 0 ? "text-profit" : "text-danger"}`}>{r.cagr.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(() => {
              const btd = d.advisor.items.filter((i) => i.bt);
              const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
              const avgPf = avg(btd.map((i) => i.bt!.pf).filter((n): n is number => n != null));
              const avgDD = avg(btd.map((i) => i.bt!.maxDD).filter((n): n is number => n != null));
              const avgCagr = avg(btd.map((i) => i.bt!.cagr).filter((n): n is number => n != null));
              return (
                <div className="grid sm:grid-cols-3 gap-x-6">
                  <Row label="BT反映 / 未計算" value={`${btd.length} / ${d.advisor.items.length - btd.length} 銘柄`} />
                  <Row label={<HelpTooltip termKey="pf" label="平均PF" />} value={avgPf != null ? avgPf.toFixed(2) : "—"} />
                  <Row label={<HelpTooltip termKey="dd" label="平均最大DD" />} value={avgDD != null ? `${avgDD.toFixed(1)}%` : "—"} tone="text-caution" />
                  <Row label={<HelpTooltip termKey="cagr" label="平均CAGR" />} value={avgCagr != null ? `${avgCagr.toFixed(1)}%` : "—"} />
                  <Row label={<HelpTooltip termKey="watchlist" label="Watchlist検出" />} value={`${d.detections.length} 件`} tone={d.detections.length > 0 ? "text-caution" : undefined} />
                  <Row label={<HelpTooltip termKey="advisorchange" label="Advisor変化" />} value={`${d.detections.filter((x) => ["strongBuy", "danger", "sellCandidate", "partialTP", "advisorChange"].includes(x.kind)).length} 件`} />
                </div>
              );
            })()}
            {d.aiLatest && (
              <div className="rounded border border-line/60 p-3">
                <p className="hud-label mb-1"><HelpTooltip termKey="aicomment" label="外部AIコメント（最新）" /></p>
                <p className="text-xs font-mono text-[#cfeaff] whitespace-pre-wrap">{d.aiLatest.answer}</p>
                <p className="text-xs text-arcdim mt-1">※ 外部AIコメントは参考情報です。売買判断はユーザー自身で行ってください。</p>
              </div>
            )}
            <div className="no-print">
              <AiComment
                ctx={{
                  title: "Report",
                  facts: [
                    `Advisor: Strong Buy ${d.advisor.counts.strongBuy} / Buy ${d.advisor.counts.buy} / Danger ${d.advisor.counts.danger}`,
                    d.risk ? `Risk Grade ${d.risk.riskGrade} / 破産確率 ${(d.risk.ruinProbability * 100).toFixed(1)}%` : "リスク: データ不足",
                    `総資産 ¥${fmt(d.portfolio.totalAssets)} / 現金比率 ${(d.portfolio.cashRatio * 100).toFixed(0)}%`,
                  ],
                }}
              />
            </div>

            {/* JARVIS所見 */}
            <ul className="space-y-1 text-sm font-mono text-arc leading-relaxed">
              {d.advisor.comments.map((c, i) => <li key={i}>・{c}</li>)}
              <li>・推奨は判断補助です。断定ではありません。</li>
            </ul>
          </div>
        )}
      </Section>

      {/* 12. Rebalance */}
      <Section n={12} title="リバランス提案">
        <Row label="高優先度提案" value={`${d.rebalance.filter((r) => r.priority === "high").length} 件 / 全 ${d.rebalance.length} 件`} tone={d.rebalance.some((r) => r.priority === "high") ? "text-danger" : "text-[#cfeaff]"} />
        <Row label="現金比率差分" value={d.radar ? `${(d.radar.cashRecommendation - p.cashRatio * 100).toFixed(0)}pt（推奨 ${d.radar.cashRecommendation}% - 現在 ${(p.cashRatio * 100).toFixed(0)}%）` : "—"} />
        <Row label="最大集中リスク" value={p.maxPosition ? `${p.maxPosition.name} ${pct(p.maxPosition.ratio)}` : "—"} />
        {d.rebalance.slice(0, 3).map((r) => <Row key={r.id} label={`提案: ${r.stockName}`} value={r.expectedImpact} tone="text-arcdim" />)}
      </Section>

      {/* 12. Strategy Ranking */}
      <Section n={13} title="戦略ランキング">
        {rankingLatest ? (
          <div className="grid sm:grid-cols-2 gap-x-6">
            <Row label="最新ランキング日" value={`${rankingLatest.date}（${rankingLatest.period}）`} />
            <Row label="最強Strategy" value={rankingLatest.bestStrategy} tone="text-arc" />
            <Row label="平均CAGR" value={`${rankingLatest.averageCagr.toFixed(1)}%`} tone={rankingLatest.averageCagr >= 0 ? "text-profit" : "text-danger"} />
            <Row label="平均PF" value={rankingLatest.averagePf.toFixed(2)} />
            <Row label="平均最大DD" value={`${rankingLatest.averageMaxDrawdown.toFixed(1)}%`} tone="text-caution" />
          </div>
        ) : (
          <p className="text-arcdim text-sm">戦略ランキング未保存（一括BT画面で保存してください）。</p>
        )}
      </Section>

      {/* 12. Strategy Editor Summary */}
      <Section n={14} title="戦略サマリー">
        <div className="grid sm:grid-cols-3 gap-x-6">
          <Row label="登録戦略数" value={`${d.strategyCount}`} />
          <Row label="主戦略" value={d.primaryName} tone="text-arc" />
          <Row label="戦略違反数（保有）" value={`${d.strategyViolations}`} tone={d.strategyViolations > 0 ? "text-danger" : "text-[#cfeaff]"} />
        </div>
      </Section>

      {/* 14. 総合所見 */}
      <Section n={15} title="JARVIS 総合所見">
        <p className="hud-label mb-1">現在の運用状態</p>
        <ul className="space-y-1 text-sm font-mono text-arc">
          <li>・市場環境: {d.radar ? `${d.radar.marketState} / ${d.radar.riskMode} / Heat ${d.radar.heatScore}` : "—"}</li>
          <li>・ポートフォリオリスク: 総合 {d.risk ? `Grade ${d.risk.riskGrade}` : "—"} / 規律 {d.discipline.score} / メンタル {d.mental ? d.mental.mentalScore : "—"}</li>
          <li>・戦略成績: {rankingLatest ? `最強 ${rankingLatest.bestStrategy}（平均CAGR ${rankingLatest.averageCagr.toFixed(1)}%）` : "未検証"}</li>
          <li>・セクター偏り: {d.sector?.maxHoldingSector ? `${d.sector.maxHoldingSector.sectorName} ${(d.sector.maxHoldingSector.portfolioWeight * 100).toFixed(0)}%` : "—"}</li>
          {d.risk?.overallComment.slice(0, 2).map((c, i) => <li key={i}>・{c}</li>)}
        </ul>
        <p className="hud-label mb-1 mt-3">改善提案</p>
        {d.improvements.length === 0 ? (
          <p className="text-arcdim text-sm">大きな改善点は見当たりません。</p>
        ) : (
          <ul className="space-y-1 text-sm font-mono text-[#cfeaff]">
            {d.improvements.slice(0, 4).map((im) => <li key={im.id}>・{im.strategyName}: {im.title}（{im.currentRule} → {im.suggestedRule}）</li>)}
          </ul>
        )}
        <p className="hud-label mb-1 mt-3">次回確認ポイント</p>
        <ul className="space-y-1 text-sm font-mono text-caution">
          {d.discipline.results.filter((r) => r.level === "danger").slice(0, 3).map((r) => <li key={r.id}>・{r.title}{r.relatedStockName ? `（${r.relatedStockName}）` : ""}</li>)}
          {d.discipline.results.filter((r) => r.level === "danger").length === 0 && <li className="text-arcdim">・重大な規律違反はありません。現状維持で問題なし、ボス。</li>}
        </ul>
      </Section>

      <p className="text-arcdim text-xs text-center no-print">※「PDF出力」→ 送信先で「PDFに保存」を選択してください。</p>
    </div>
  );
}
