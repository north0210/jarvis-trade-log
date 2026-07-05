"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HelpTooltip from "@/components/HelpTooltip";
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getJournalRepository } from "@/lib/storage/journalRepository";
import type { Holding, Journal, Stock } from "@/lib/types";
import { holdingAlerts, stockAlerts, pnl, type Alert } from "@/lib/alerts";
import { getLastBackup, formatBackupTime } from "@/lib/storage/exportService";
import { getGenerations } from "@/lib/backup/backup-service";
import { getDashboardRuns } from "@/lib/settings/performance";
import { scoreStock, type ScoreResult } from "@/lib/score";
import JarvisCommentPanel from "@/components/JarvisCommentPanel";
import { analyzePortfolio, getCashPosition, type PortfolioAnalysis } from "@/lib/analysis/portfolio";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { analyzeTrades } from "@/lib/analysis/trades";
import type { Trade } from "@/lib/types";
import { evaluateDiscipline, type DisciplineReport } from "@/lib/discipline/rules";
import { ensureSeeded, getPrimaryStrategyId } from "@/lib/storage/strategyRepository";
import { matchStrategy } from "@/lib/strategy/match";
import { analyzeByStrategy, type StrategyStat } from "@/lib/analysis/strategyPerf";
import { generateImprovements, getDismissedImprovements, type Improvement } from "@/lib/strategy/rule-improver";
import { runMonteCarlo, type MonteCarloResult } from "@/lib/analytics/montecarlo";
import { getBacktestSummaries, type BacktestSummary } from "@/lib/analytics/backtest-engine";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateRisk, type RiskReport } from "@/lib/risk/risk-engine";
import { getThresholds, isGradeDanger, DEFAULT_THRESHOLDS, type ThresholdSettings } from "@/lib/settings/thresholds";
import { analyzeFactors, type FactorAnalysis } from "@/lib/analytics/factor-analysis";
import { adaptiveScoreStock, getAdaptiveScoreSettings, type AdaptiveScoreSettings } from "@/lib/score/adaptive-score";
import { analyzeMental, type MentalAnalysis } from "@/lib/mental/mental-analysis";
import { getReportSnapshotRepository, compareSnapshots, type CompareRow } from "@/lib/report/snapshot";
import { getAutoReportSettings, nextDueLabel, type ReportFrequency } from "@/lib/report/auto-report";
import { summarizeVolumeAlerts, type VolumeAlertSummary } from "@/lib/alerts/volume-alerts";
import { buildVolumeReport } from "@/lib/report/volume-report";
import { buildAdvisorReport } from "@/lib/advisor/advisor-engine";
import type { AdvisorCounts, AdvisorItem, AdvisorCategory } from "@/lib/advisor/advisorTypes";
import { rankingComment } from "@/lib/advisor/ranking";
import { CATEGORY_LABELS } from "@/lib/advisor/advisorTypes";
import { listFavorites } from "@/lib/advisor/favorites";
import ReleaseChecklist from "@/components/ReleaseChecklist";
import Onboarding from "@/components/Onboarding";
import ScreenerTop10Widget from "@/components/ScreenerTop10Widget";
import AiComment from "@/components/AiComment";
import { aiCommentCount } from "@/lib/advisor/ai-comment";
import { latestStockBtResult, type StockBtResult } from "@/lib/advisor/stock-backtest";
import { getPerStockBacktestMap } from "@/lib/advisor/advisor-provider";
import { listDetections } from "@/lib/watchlist/watchlist-monitor";
import {
  getNotificationSettings,
  permissionState,
  getLastNotification,
  getNotifications,
  notifyDisciplineWarning,
  notifyVolumeAlert,
  notifyRiskWarning,
} from "@/lib/notifications/notification-service";
import { computeMarketRadar, type MarketRadarResult } from "@/lib/market/market-radar";
import { computeSectorHeatmap, type SectorHeatmap } from "@/lib/market/sector-heatmap";
import { generateRebalance, type RebalanceSuggestion } from "@/lib/portfolio/rebalance-engine";
import { getStrategyRankingSnapshotRepository } from "@/lib/backtest/ranking-snapshot";
import type { ReportSnapshot, Strategy, StrategyRankingSnapshot } from "@/lib/types";
import { isTradingViewEnabled } from "@/lib/tradingview";
import dynamic from "next/dynamic";
import {
  getProviderMode,
  providerModeLabel,
  getJQuantsStatus,
  type JQuantsStatusRecord,
} from "@/lib/pricing/settings";
import type { PriceProviderMode } from "@/lib/pricing/provider";
import { getLatestUpdateLog, type PriceUpdateLog } from "@/lib/pricing/priceUpdater";
import {
  getAutoUpdateSettings,
  getAutoUpdateRuntime,
  getNextAutoUpdateAt,
  subscribeAutoUpdate,
  type AutoUpdateSettings,
} from "@/lib/pricing/auto-update";

const gradeTone: Record<ScoreResult["grade"], string> = {
  S: "text-profit",
  A: "text-arc",
  B: "text-arc",
  C: "text-caution",
  D: "text-danger",
};

const TradingViewChart = dynamic(() => import("@/components/TradingViewChart"), { ssr: false });
const repo = getStockRepository();
const holdingRepo = getHoldingRepository();
const journalRepo = getJournalRepository();
const tradeRepo = getTradeRepository();
const snapshotRepo = getReportSnapshotRepository();
const rankingRepo = getStrategyRankingSnapshotRepository();

const fmt = (n: number) =>
  n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });

const StatCard = memo(function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "profit" | "danger";
}) {
  const color =
    tone === "profit" ? "text-profit" : tone === "danger" ? "text-danger" : "text-arc";
  return (
    <div className="hud-panel p-4">
      <p className="hud-label">{label}</p>
      <p className={`font-mono text-3xl mt-2 ${color}`}>{value}</p>
    </div>
  );
});

export default function Dashboard() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [backupInfo, setBackupInfo] = useState<{ iso: string | null; generations: number }>({ iso: null, generations: 0 });
  const [tvEnabled, setTvEnabled] = useState(false);
  const [providerMode, setProviderMode] = useState<PriceProviderMode>("manual");
  const [jqStatus, setJqStatus] = useState<JQuantsStatusRecord | null>(null);
  const [priceLog, setPriceLog] = useState<PriceUpdateLog | null>(null);
  const [auto, setAuto] = useState<AutoUpdateSettings>({
    enabled: false,
    intervalMinutes: 30,
    lastAutoUpdateAt: null,
  });
  const [autoRunning, setAutoRunning] = useState(false);
  const [nextAt, setNextAt] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioAnalysis | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [discipline, setDiscipline] = useState<DisciplineReport | null>(null);
  const [strategySummary, setStrategySummary] = useState<
    { name: string; matchCount: number; violationCount: number; warning: string | null; count: number } | null
  >(null);
  const [bestStrategy, setBestStrategy] = useState<StrategyStat | null>(null);
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [mc, setMc] = useState<MonteCarloResult | null>(null);
  const [btSummaries, setBtSummaries] = useState<BacktestSummary[]>([]);
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [factor, setFactor] = useState<FactorAnalysis | null>(null);
  const [adaptive, setAdaptive] = useState<AdaptiveScoreSettings | null>(null);
  const [mental, setMental] = useState<MentalAnalysis | null>(null);
  const [snapshot, setSnapshot] = useState<{ latest: ReportSnapshot; rows: CompareRow[] } | null>(null);
  const [radar, setRadar] = useState<MarketRadarResult | null>(null);
  const [sector, setSector] = useState<SectorHeatmap | null>(null);
  const [rebalance, setRebalance] = useState<RebalanceSuggestion[]>([]);
  const [ranking, setRanking] = useState<{ latest: StrategyRankingSnapshot; prevBest: string | null } | null>(null);
  const [autoReport, setAutoReport] = useState<{ enabled: boolean; frequency: ReportFrequency; count: number; lastAuto: string | null; nextDue: string } | null>(null);
  const [volAlerts, setVolAlerts] = useState<VolumeAlertSummary | null>(null);
  const [volMax, setVolMax] = useState<{ name: string; code: string; rv: number } | null>(null);
  const [advisorCounts, setAdvisorCounts] = useState<AdvisorCounts | null>(null);
  const [advisorAt, setAdvisorAt] = useState<string | null>(null);
  const [advItems, setAdvItems] = useState<AdvisorItem[]>([]);
  const [missingStocks, setMissingStocks] = useState<{ code: string; name: string; missing: string[] }[]>([]);
  const [topN, setTopN] = useState<3 | 5 | 10>(5);
  const [favs, setFavs] = useState<string[]>([]);
  const [updatedByCode, setUpdatedByCode] = useState<Record<string, string | null>>({});
  const [assetTrend, setAssetTrend] = useState<{ weekPct: number | null; monthPct: number | null }>({ weekPct: null, monthPct: null });
  const [ext, setExt] = useState<{ aiCount: number; bt: StockBtResult | null; watchCount: number; advisorChange: number; btCount: number; btUncounted: number; btAvg: number | null; avgPf: number | null; avgDD: number | null; avgCagr: number | null; btBest: { name: string; grade: string } | null } | null>(null);
  const [thresholds, setThresholdsState] = useState<ThresholdSettings>(DEFAULT_THRESHOLDS);
  const [notifInfo, setNotifInfo] = useState<{
    enabled: boolean;
    permission: string;
    last: { title: string; at: string } | null;
    unread: number;
    dangerUnread: number;
    recent: { id: string; title: string; at: string; level: string }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [s, h, j] = await Promise.all([repo.list(), holdingRepo.list(), journalRepo.list()]);
    const byId = new Map(s.map((x) => [x.id, x]));
    setStocks(s);
    // 銘柄マスタを join（localStorage は stock_id のみ保持するため）
    setHoldings(h.map((x) => ({ ...x, stocks: byId.get(x.stock_id) })));
    setJournals(j); // Repository 側で最新順ソート済み
    setLastBackup(formatBackupTime(getLastBackup()));
    setBackupInfo({ iso: getLastBackup(), generations: getGenerations().length });
    setTvEnabled(isTradingViewEnabled());
    setProviderMode(getProviderMode());
    setJqStatus(getJQuantsStatus());
    setPriceLog(getLatestUpdateLog());
    setAuto(getAutoUpdateSettings());
    setAutoRunning(getAutoUpdateRuntime().running);
    setNextAt(getNextAutoUpdateAt());
    const cash = getCashPosition();
    const port = analyzePortfolio(s, h, cash);
    setPortfolio(port);
    const t = await tradeRepo.list();
    setTrades(t);
    const disciplineReport = evaluateDiscipline(s, h, t, cash);
    setDiscipline(disciplineReport);

    // 主戦略サマリー
    const strats = await ensureSeeded();
    const primary = strats.find((x) => x.id === getPrimaryStrategyId()) ?? strats[0] ?? null;
    if (primary) {
      let matchCount = 0;
      let violationCount = 0;
      let warning: string | null = null;
      for (const stock of s) {
        const hs = h.filter((x) => x.stock_id === stock.id);
        const held = hs.length > 0;
        const shares = hs.reduce((a, x) => a + x.shares, 0);
        const cost = hs.reduce((a, x) => a + x.buy_price * x.shares, 0);
        const value = held ? (stock.current_price != null ? stock.current_price * shares : cost) : 0;
        const positionRatio = held && port.totalValue > 0 ? value / port.totalValue : null;
        const hasStopLoss = hs.some((x) => x.stop_loss != null) || stock.stop_loss != null;
        const r = matchStrategy(primary, stock, scoreStock(stock), { positionRatio, hasStopLoss });
        if (r.status === "match") matchCount++;
        if (held && r.violations.length > 0) {
          violationCount++;
          if (!warning) warning = `${stock.name}: ${r.violations[0]}`;
        }
      }
      setStrategySummary({ name: primary.name, matchCount, violationCount, warning, count: strats.length });
    }
    // 戦略別成績（最も成績の良い戦略）
    const perf = analyzeByStrategy(t, strats);
    setBestStrategy(perf.length ? perf[0] : null);

    // ルール改善提案
    const dismissed = getDismissedImprovements();
    const imps = generateImprovements(
      t,
      strats,
      { maxRatio: port.maxPosition?.ratio ?? 0, maxName: port.maxPosition?.name ?? null },
      "—"
    ).filter((i) => !dismissed.includes(i.id));
    setImprovements(imps);

    // モンテカルロ リスク予測（Dashboardは軽量に 500 回）
    const mcResult = t.length > 0 ? runMonteCarlo({ pnls: t.map((x) => x.realizedPnl), capital: port.totalAssets, runs: getDashboardRuns() }) : null;
    setMc(mcResult);
    setBtSummaries(getBacktestSummaries());

    // 通知しきい値（Phase 49・ユーザー設定を参照）
    const th = getThresholds();
    setThresholdsState(th);
    // Risk Engine 統合
    const riskReport = mcResult ? evaluateRisk(port, mcResult, runBacktest(t), disciplineReport, t, th) : null;
    setRisk(riskReport);
    // Factor 分析
    const factorResult = analyzeFactors(s, t, strats, riskReport, disciplineReport);
    setFactor(t.length > 0 ? factorResult : null);
    setAdaptive(getAdaptiveScoreSettings());
    const mentalResult = t.length > 0 ? analyzeMental(j, t) : null;
    setMental(mentalResult);
    // Market Radar
    const radarResult = s.length > 0
      ? computeMarketRadar({ stocks: s, portfolio: port, risk: riskReport, mc: mcResult, discipline: disciplineReport, mental: mentalResult, factor: factorResult })
      : null;
    setRadar(radarResult);
    const sectorResult = s.length > 0 ? computeSectorHeatmap(s, h) : null;
    setSector(sectorResult);
    const vs = summarizeVolumeAlerts(s, {
      relativeVolumeWarning: th.relativeVolumeWarning,
      relativeVolumeDanger: th.relativeVolumeDanger,
      rsiOverheat: th.rsiOverheat,
    });
    setVolAlerts(vs.alerts.length > 0 ? vs : null);
    const volReport = buildVolumeReport(s, {
      relativeVolumeWarning: th.relativeVolumeWarning,
      relativeVolumeDanger: th.relativeVolumeDanger,
      rsiOverheat: th.rsiOverheat,
    });
    setVolMax(volReport.maxRelVol && volReport.maxRelVol.relativeVolume != null ? { name: volReport.maxRelVol.name, code: volReport.maxRelVol.code, rv: volReport.maxRelVol.relativeVolume } : null);
    // リバランス提案
    setRebalance(
      s.length > 0
        ? generateRebalance({ portfolio: port, risk: riskReport, marketRadar: radarResult, sector: sectorResult, holdings: h, stocks: s, cash, now: "—" })
        : []
    );
    // JARVIS Advisor 要約（統合レイヤー・非破壊）
    const advWeights = getAdaptiveScoreSettings().factorWeights;
    const advAdaptive: Record<string, number> = {};
    for (const st of s) advAdaptive[st.code] = adaptiveScoreStock(st, factorResult, advWeights).score;
    const advReport = buildAdvisorReport({
      stocks: s,
      holdings: h,
      portfolio: port,
      risk: riskReport,
      discipline: disciplineReport,
      btSummaries: getBacktestSummaries(),
      primaryStrategy: primary,
      thresholds: th,
      adaptiveByCode: advAdaptive,
      perStock: getPerStockBacktestMap(),
    });
    setAdvisorCounts(advReport.hasData ? advReport.counts : null);
    setAdvisorAt(advReport.hasData ? new Date().toISOString() : null);
    setAdvItems(advReport.items.slice().sort((a, b) => b.composite - a.composite));
    setFavs(listFavorites());
    setUpdatedByCode(Object.fromEntries(s.map((x) => [x.code, x.price_updated_at])));
    setMissingStocks(
      s
        .map((st) => {
          const miss = [st.per == null && "PER", st.pbr == null && "PBR", st.roe == null && "ROE", st.operating_margin == null && "営業利益率", st.sales_growth == null && "売上成長率", st.rsi == null && "RSI"].filter(Boolean) as string[];
          return miss.length > 0 ? { code: st.code, name: st.name, missing: miss } : null;
        })
        .filter((x): x is { code: string; name: string; missing: string[] } => x !== null)
        .slice(0, 8)
    );

    // v1.3 拡張要約（localStorage 参照・軽量）
    const dets = listDetections();
    const advisorChangeKinds = new Set(["strongBuy", "danger", "sellCandidate", "partialTP", "advisorChange"]);
    const btItems = advReport.items.filter((i) => i.btScore != null);
    const btWithDetail = advReport.items.filter((i) => i.bt);
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const btBest = btItems.slice().sort((a, b) => (b.btScore ?? 0) - (a.btScore ?? 0))[0] ?? null;
    setExt({
      aiCount: aiCommentCount(),
      bt: latestStockBtResult(),
      watchCount: dets.length,
      advisorChange: dets.filter((d) => advisorChangeKinds.has(d.kind)).length,
      btCount: btItems.length,
      btUncounted: advReport.items.length - btItems.length,
      btAvg: btItems.length ? btItems.reduce((a, i) => a + (i.btScore ?? 0), 0) / btItems.length : null,
      avgPf: avg(btWithDetail.map((i) => i.bt!.pf).filter((n): n is number => n != null)),
      avgDD: avg(btWithDetail.map((i) => i.bt!.maxDD).filter((n): n is number => n != null)),
      avgCagr: avg(btWithDetail.map((i) => i.bt!.cagr).filter((n): n is number => n != null)),
      btBest: btBest && btBest.btGrade ? { name: btBest.name, grade: btBest.btGrade } : null,
    });

    const snaps = await snapshotRepo.list();
    setSnapshot(snaps.length ? { latest: snaps[0], rows: compareSnapshots(snaps[0], snaps[1] ?? null) } : null);
    // 今週/今月の資産変化（スナップショット比較）
    const curAssets = port.totalAssets;
    const backPct = (days: number): number | null => {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const past = snaps.find((x) => x.date <= cutoff);
      return past && past.totalAssets > 0 ? ((curAssets - past.totalAssets) / past.totalAssets) * 100 : null;
    };
    setAssetTrend({ weekPct: backPct(7), monthPct: backPct(30) });
    const ar = getAutoReportSettings();
    setAutoReport({ enabled: ar.enabled, frequency: ar.frequency, count: snaps.length, lastAuto: snaps.find((s) => s.source === "auto")?.date ?? null, nextDue: nextDueLabel() });
    const rankSnaps = await rankingRepo.list();
    setRanking(rankSnaps.length ? { latest: rankSnaps[0], prevBest: rankSnaps[1]?.bestStrategy ?? null } : null);

    // 通知トリガ（許可・設定・同日重複は notification-service 側で制御）
    const dangerDisc = disciplineReport.results.filter((rr) => rr.level === "danger").length;
    if (dangerDisc > 0) notifyDisciplineWarning(dangerDisc);
    vs.alerts.filter((a) => a.level === "danger").forEach((a) => notifyVolumeAlert(a));
    if (riskReport) {
      if (isGradeDanger(riskReport.riskGrade, th.riskGradeDanger)) notifyRiskWarning("grade", `総合リスクが Grade ${riskReport.riskGrade} です。防御的な配分を検討してください。`);
      if (riskReport.ruinProbability >= th.ruinProbabilityDanger / 100) notifyRiskWarning("ruin", `破産確率が ${(riskReport.ruinProbability * 100).toFixed(1)}% に上昇しています。`);
      if (riskReport.halfCapitalProbability >= th.halfCapitalProbabilityDanger / 100) notifyRiskWarning("halve", `資産半減確率が ${(riskReport.halfCapitalProbability * 100).toFixed(1)}% に達しています。`);
    }
    const nset = getNotificationSettings();
    const nlast = getLastNotification();
    const nrecs = getNotifications();
    setNotifInfo({
      enabled: nset.enabled,
      permission: permissionState(),
      last: nlast ? { title: nlast.title, at: nlast.at } : null,
      unread: nrecs.filter((r) => !r.read).length,
      dangerUnread: nrecs.filter((r) => !r.read && r.level === "danger").length,
      recent: nrecs.slice(0, 3).map((r) => ({ id: r.id, title: r.title, at: r.createdAt, level: r.level })),
    });

    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // 自動更新の開始/完了に追随して再描画（価格・スコア・ステータスを反映）
    return subscribeAutoUpdate(() => {
      refresh();
    });
  }, [refresh]);

  const latestJournals = useMemo(() => journals.slice(0, 3), [journals]);

  const tradeStats = useMemo(() => {
    const a = analyzeTrades(trades);
    const month = new Date().toISOString().slice(0, 7);
    const thisMonth = trades.filter((t) => t.date.slice(0, 7) === month);
    return {
      totalPnl: a.totalRealizedPnl,
      winRate: a.winRate,
      count: a.count,
      monthPnl: thisMonth.reduce((x, t) => x + t.realizedPnl, 0),
      monthCount: thisMonth.length,
      recent: trades.slice(0, 3),
    };
  }, [trades]);

  // JARVIS Score: 全銘柄を採点しスコア降順に並べる
  const scored = useMemo(
    () =>
      stocks
        .map((s) => ({ stock: s, result: scoreStock(s) }))
        .sort((a, b) => b.result.score - a.result.score),
    [stocks]
  );
  const topPick = scored[0] ?? null;

  const stockById = useMemo(
    () => new Map(stocks.map((s) => [s.id, s])),
    [stocks]
  );

  const totals = useMemo(() => {
    let cost = 0;
    let value = 0;
    for (const h of holdings) {
      const s = h.stocks ?? stockById.get(h.stock_id);
      if (!s || s.current_price == null) {
        cost += h.buy_price * h.shares;
        value += h.buy_price * h.shares; // 価格未入力は簿価扱い
        continue;
      }
      const r = pnl(h, s.current_price);
      cost += r.cost;
      value += r.value;
    }
    const diff = value - cost;
    const pct = cost === 0 ? 0 : (diff / cost) * 100;
    return { cost, value, diff, pct };
  }, [holdings, stockById]);

  const alerts: Alert[] = useMemo(() => {
    const out: Alert[] = [];
    const heldStockIds = new Set(holdings.map((h) => h.stock_id));
    for (const h of holdings) {
      const s = h.stocks ?? stockById.get(h.stock_id);
      if (s) out.push(...holdingAlerts(h, s));
    }
    for (const s of stocks) {
      if (!heldStockIds.has(s.id)) out.push(...stockAlerts(s));
    }
    const order = { danger: 0, caution: 1, profit: 2 } as const;
    return out.sort((a, b) => order[a.level] - order[b.level]);
  }, [holdings, stocks, stockById]);

  const candidates = useMemo(
    () =>
      stocks
        .filter((s) => s.status === "買い候補" || s.status === "押し目待ち")
        .sort((a, b) => a.rank.localeCompare(b.rank)),
    [stocks]
  );

  // ダッシュボードは永続化済みの価格・指標（stock.current_price / rsi / macd）を表示するのみ。
  // 価格の取得・更新は銘柄／設定画面の「価格更新」→ PriceProvider（priceUpdater）に一本化。
  // ここでは実API通信を行わない（自動取得はしない設計）。

  if (loading)
    return <p className="hud-label animate-pulse">SYSTEM BOOT — データ照会中…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-x-6 gap-y-1">
        <p className="hud-label">
          PRICE PROVIDER:{" "}
          <span
            className={
              providerMode === "manual"
                ? "text-arc"
                : jqStatus?.status === "connected"
                  ? "text-profit"
                  : jqStatus?.status === "error"
                    ? "text-danger"
                    : "text-caution"
            }
          >
            {providerModeLabel(providerMode, jqStatus)}
          </span>
        </p>
        <p className="hud-label">
          RSI AUTO:{" "}
          <span className={providerMode === "jquants-ready" ? "text-profit" : "text-arcdim"}>
            {providerMode === "jquants-ready" ? "ON" : "OFF"}
          </span>
        </p>
        <p className="hud-label">
          AUTO UPDATE:{" "}
          <span className={auto.enabled ? "text-profit" : "text-arcdim"}>
            {auto.enabled ? "ON" : "OFF"}
          </span>
          {auto.enabled && <span className="text-arcdim"> / {auto.intervalMinutes}分間隔</span>}
        </p>
        {portfolio && (
          <>
            <p className="hud-label">
              PORTFOLIO 危険度:{" "}
              <span
                className={
                  portfolio.riskLevel === "danger"
                    ? "text-danger"
                    : portfolio.riskLevel === "caution"
                      ? "text-caution"
                      : "text-profit"
                }
              >
                {portfolio.riskLevel === "danger" ? "危険" : portfolio.riskLevel === "caution" ? "注意" : "安全"}
              </span>
              <span className="text-arcdim"> / 現金比率 {(portfolio.cashRatio * 100).toFixed(1)}%</span>
            </p>
            {portfolio.maxPosition && (
              <p className="hud-label">
                最大集中:{" "}
                <span className={portfolio.maxPosition.ratio * 100 >= thresholds.oneStockWeightWarning ? "text-danger" : "text-arc"}>
                  {portfolio.maxPosition.name} {(portfolio.maxPosition.ratio * 100).toFixed(1)}%
                </span>
              </p>
            )}
          </>
        )}
        {discipline && (
          <p className="hud-label">
            <HelpTooltip termKey="disciplinescore" label="規律スコア" />:{" "}
            <span
              className={
                discipline.score >= thresholds.disciplineScoreWarning ? "text-profit" : discipline.score >= 50 ? "text-caution" : "text-danger"
              }
            >
              {discipline.score}
            </span>
            {discipline.dangerCount > 0 && <span className="text-danger"> / 重大違反 {discipline.dangerCount}</span>}
          </p>
        )}
        <p className="hud-label">
          最終価格更新:{" "}
          <span className={priceLog ? "text-arc" : "text-arcdim"}>
            {priceLog ? formatBackupTime(priceLog.date) ?? "未実施" : "未実施"}
          </span>
          {priceLog && (
            <span className="text-arcdim">
              {" "}(成功 {priceLog.successCount} / 失敗 {priceLog.failedCount})
            </span>
          )}
        </p>
        {auto.enabled && (
          <p className="hud-label">
            次回自動更新:{" "}
            <span className="text-arc">{formatBackupTime(nextAt) ?? "算出待ち"}</span>
          </p>
        )}
        <p className="hud-label">
          最終バックアップ:{" "}
          <span className={lastBackup ? "text-arc" : "text-arcdim"}>
            {lastBackup ?? "未実施"}
          </span>
        </p>
      </div>

      <Onboarding />

      <ReleaseChecklist />

      <ScreenerTop10Widget />

      {(() => {
        const dangerCats = new Set(["danger", "sellCandidate", "reduce"]);
        const picks = advItems.filter((i) => !dangerCats.has(i.category)).slice(0, 3);
        const dangerN = advItems.filter((i) => dangerCats.has(i.category)).length;
        const topPick = picks[0] ?? null;
        const pctCls = (n: number | null) => (n == null ? "text-arcdim" : n >= 0 ? "text-profit" : "text-danger");
        const pctTxt = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
        return (
          <section className="hud-panel p-4 border-arc/50 shadow-arc">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="hud-label text-arc">🌅 今日の確認（朝30秒）</h2>
              <div className="flex flex-wrap gap-1">
                <Link href="/advisor-ranking" className="hud-btn text-xs px-3 py-1">ランキング</Link>
                <Link href="/advisor" className="hud-btn text-xs px-3 py-1">Advisor</Link>
                <Link href="/portfolio" className="hud-btn text-xs px-3 py-1">PF</Link>
                <Link href="/holdings" className="hud-btn text-xs px-3 py-1">保有株</Link>
                <Link href="/notifications" className="hud-btn text-xs px-3 py-1">通知</Link>
                <Link href="/report" className="hud-btn text-xs px-3 py-1">レポート</Link>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              {/* 1. Portfolio概要 */}
              <div className="rounded border border-line/60 p-3">
                <p className="hud-label">◈ ポートフォリオ</p>
                <p className="font-mono text-lg mt-1 text-arc">¥{fmt(portfolio?.totalAssets ?? totals.value)}</p>
                <p className={`font-mono text-sm ${totals.diff >= 0 ? "text-profit" : "text-danger"}`}>
                  含み損益 {totals.diff >= 0 ? "+" : ""}¥{fmt(totals.diff)}（{totals.pct >= 0 ? "+" : ""}{totals.pct.toFixed(1)}%）
                </p>
                <p className="text-xs text-arcdim mt-1">現金 {portfolio ? (portfolio.cashRatio * 100).toFixed(0) : "—"}% / 保有 {portfolio?.holdingCount ?? 0}銘柄</p>
                <p className="text-xs mt-1 font-mono">
                  今週 <span className={pctCls(assetTrend.weekPct)}>{pctTxt(assetTrend.weekPct)}</span> / 今月 <span className={pctCls(assetTrend.monthPct)}>{pctTxt(assetTrend.monthPct)}</span>
                </p>
              </div>
              {/* 2. Today's Picks Top3 */}
              <div className="rounded border border-line/60 p-3">
                <p className="hud-label">⭐ Today&apos;s Picks</p>
                {picks.length === 0 ? (
                  <p className="text-xs text-arcdim mt-1">候補なし（銘柄登録・価格更新を）</p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-xs font-mono">
                    {picks.map((p, i) => (
                      <li key={p.code}><span className="text-arc">{i + 1}. {p.code} {p.name}</span> <span className="text-arcdim">{p.composite}/{p.grade}</span></li>
                    ))}
                  </ul>
                )}
              </div>
              {/* 3. 危険・監視・通知 */}
              <div className="rounded border border-line/60 p-3">
                <p className="hud-label">⚠ 要確認</p>
                <p className={`font-mono text-sm mt-1 ${dangerN > 0 ? "text-danger" : "text-arcdim"}`}>危険候補 {dangerN}件</p>
                <p className={`font-mono text-sm ${ext && ext.watchCount > 0 ? "text-caution" : "text-arcdim"}`}>Watchlist検出 {ext?.watchCount ?? 0}件</p>
                <p className={`font-mono text-sm ${notifInfo && notifInfo.dangerUnread > 0 ? "text-danger" : "text-arcdim"}`}>未読danger {notifInfo?.dangerUnread ?? 0}件</p>
                <p className="text-xs text-arcdim mt-1">Advisor変化 {ext?.advisorChange ?? 0}件</p>
              </div>
              {/* 4. AI Summary 一言 */}
              <div className="rounded border border-arc/30 p-3">
                <p className="hud-label">🧠 JARVIS 一言</p>
                <p className="text-xs font-mono text-[#cfeaff] mt-1 leading-relaxed">
                  {topPick ? rankingComment(topPick, 0) : dangerN > 0 ? "危険候補があります。規律を優先してください。" : "際立った候補はありません。静観が妥当です、ボス。"}
                </p>
                <p className="text-[10px] text-arcdim mt-1">※ 判断補助・投資助言ではありません</p>
              </div>
            </div>
            <p className="text-xs text-arcdim mt-2">夜は「レポート」で3分振り返り。詳細は下部の各パネルへ。</p>
          </section>
        );
      })()}

      <section className="hud-panel p-3 flex flex-wrap items-center gap-2">
        <span className="hud-label">初めての方へ:</span>
        <Link href="/help" className="hud-btn text-xs px-3 py-1">📘 使い方を見る</Link>
        <Link href="/help" className="hud-btn text-xs px-3 py-1">✅ 今日の確認手順</Link>
        <span className="text-xs text-arcdim">※ 本アプリは判断補助であり投資助言ではありません。</span>
      </section>

      <section className="hud-panel p-4 border-arc/30">
        <h2 className="hud-label mb-2">🧭 今日見る順番</h2>
        <ol className="flex flex-wrap items-center gap-2 text-sm font-mono">
          {[
            { n: 1, href: "/risk", label: "リスク", hint: "危険度・集中を確認" },
            { n: 2, href: "/notifications", label: "通知", hint: "未読の重大通知" },
            { n: 3, href: "/holdings", label: "保有株", hint: "損切り/利確の距離" },
            { n: 4, href: "/rebalance", label: "調整", hint: "偏りの是正提案" },
            { n: 5, href: "/report", label: "レポート", hint: "全体を1枚で記録" },
          ].map((s) => (
            <li key={s.n} className="flex items-center gap-2">
              <Link href={s.href} className="hud-btn text-xs px-3 py-1">
                <span className="text-arc">{s.n}.</span> {s.label}
                <span className="text-arcdim"> — {s.hint}</span>
              </Link>
              {s.n < 5 && <span className="text-arcdim">→</span>}
            </li>
          ))}
        </ol>
        <p className="text-xs text-arcdim mt-2">迷ったら、この順に確認すれば要点を押さえられます、ボス。</p>
      </section>

      {(() => {
        const iso = backupInfo.iso;
        const t = iso ? new Date(iso).getTime() : NaN;
        const days = Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
        const status =
          days == null ? { text: "未実施（バックアップ推奨）", cls: "text-danger" }
          : days >= 14 ? { text: `前回から ${days} 日（要バックアップ）`, cls: "text-caution" }
          : { text: `前回から ${days} 日（良好）`, cls: "text-profit" };
        return (
          <section className="hud-panel p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="hud-label">🛟 バックアップ状態</h2>
              <Link href="/backup" className="hud-btn text-xs px-3 py-1">バックアップ/復元 →</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm font-mono">
              <div className="rounded border border-line/60 p-3">
                <p className="hud-label">最終バックアップ</p>
                <p className="mt-1 text-arc">{formatBackupTime(iso) ?? "未実施"}</p>
              </div>
              <div className="rounded border border-line/60 p-3">
                <p className="hud-label">状態</p>
                <p className={`mt-1 ${status.cls}`}>{status.text}</p>
              </div>
              <div className="rounded border border-line/60 p-3">
                <p className="hud-label">自動退避</p>
                <p className="mt-1 text-arcdim">{backupInfo.generations} 世代 保持中</p>
              </div>
            </div>
          </section>
        );
      })()}

      {autoRunning && (
        <p className="hud-label text-arc animate-pulse text-right">
          価格データを自動更新中です、ボス
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="総投資額" value={`¥${fmt(totals.cost)}`} />
        <StatCard label="現在評価額" value={`¥${fmt(totals.value)}`} />
        <StatCard
          label="含み損益"
          value={`${totals.diff >= 0 ? "+" : ""}¥${fmt(totals.diff)}`}
          tone={totals.diff > 0 ? "profit" : totals.diff < 0 ? "danger" : "neutral"}
        />
        <StatCard
          label="含み損益率"
          value={`${totals.pct >= 0 ? "+" : ""}${totals.pct.toFixed(2)}%`}
          tone={totals.pct > 0 ? "profit" : totals.pct < 0 ? "danger" : "neutral"}
        />
      </div>

      {radar && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">🛰 マーケットレーダー</h2>
            <Link href="/market-radar" className="hud-btn text-xs px-3 py-1">市況詳細 →</Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="hud-label">Market State</p>
              <p className={`font-mono text-xl mt-1 ${radar.marketState === "Panic" || radar.marketState === "Bear" ? "text-danger" : radar.marketState === "Bull" ? "text-profit" : "text-arc"}`}>{radar.marketState}</p>
            </div>
            <div>
              <p className="hud-label">Risk Mode</p>
              <p className={`font-mono text-xl mt-1 ${radar.riskMode === "Risk Off" ? "text-danger" : radar.riskMode === "Risk On" ? "text-profit" : "text-arc"}`}>{radar.riskMode}</p>
            </div>
            <div>
              <p className="hud-label">Heat Score</p>
              <p className={`font-mono text-xl mt-1 ${radar.heatScore >= 75 ? "text-danger" : radar.heatScore >= 50 ? "text-caution" : "text-arc"}`}>{radar.heatScore}</p>
            </div>
            <div>
              <p className="hud-label">現金推奨</p>
              <p className="font-mono text-xl mt-1 text-arc">{radar.cashRecommendation}%</p>
            </div>
          </div>
          {sector && sector.sectors.length > 0 && (
            <div className="mt-3 pt-3 border-t border-line/60 grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <p className="hud-label">最強セクター</p>
                <p className="font-mono text-sm mt-1 text-arc">{sector.strongest ? `${sector.strongest.sectorName} (${sector.strongest.heatScore.toFixed(0)})` : "—"}</p>
              </div>
              <div>
                <p className="hud-label">最過熱セクター</p>
                <p className="font-mono text-sm mt-1 text-caution">{sector.hottest && sector.hottest.averageRsi != null ? `${sector.hottest.sectorName} (RSI${sector.hottest.averageRsi.toFixed(0)})` : "—"}</p>
              </div>
              <div>
                <p className="hud-label">最大保有テーマ</p>
                <p className="font-mono text-sm mt-1 text-[#cfeaff]">{sector.maxHoldingSector ? `${sector.maxHoldingSector.sectorName} ${(sector.maxHoldingSector.portfolioWeight * 100).toFixed(0)}%` : "—"}</p>
              </div>
              <div>
                <p className="hud-label">セクター集中</p>
                <p className={`font-mono text-sm mt-1 ${sector.maxHoldingSector && sector.maxHoldingSector.portfolioWeight >= 0.5 ? "text-danger" : "text-arcdim"}`}>
                  {sector.maxHoldingSector && sector.maxHoldingSector.portfolioWeight >= 0.5 ? "集中警告" : "許容範囲"}
                </p>
              </div>
              <div className="col-span-2 lg:col-span-4 flex justify-end">
                <Link href="/sector-heatmap" className="hud-btn text-xs px-3 py-1">セクター詳細 →</Link>
              </div>
            </div>
          )}
        </section>
      )}

      {rebalance.length > 0 && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">
              ♻ リバランス提案{" "}
              <span className="text-caution">{rebalance.length}件</span>
              <span className="text-arcdim">（高優先 {rebalance.filter((r) => r.priority === "high").length}件）</span>
            </h2>
            <Link href="/rebalance" className="hud-btn text-xs px-3 py-1">調整提案 →</Link>
          </div>
          <ul className="space-y-1 text-sm font-mono">
            {rebalance.slice(0, 3).map((r) => (
              <li
                key={r.id}
                className={`px-3 py-1.5 rounded border ${
                  r.priority === "high" ? "border-danger/50 text-danger bg-danger/5" : r.priority === "medium" ? "border-caution/50 text-caution bg-caution/5" : "border-line text-arcdim"
                }`}
              >
                [{r.priority === "high" ? "高" : r.priority === "medium" ? "中" : "低"}] {r.stockName}
                {r.stockCode !== "—" && <span className="opacity-70">（{r.stockCode}）</span>} — {r.expectedImpact}
              </li>
            ))}
          </ul>
        </section>
      )}

      {advisorCounts && (
        <section className="hud-panel p-4 border-arc/40">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">🛰 JARVIS Advisor <span className="text-arcdim">— 最新判定 {formatBackupTime(advisorAt) ?? "—"}</span></h2>
            <Link href="/advisor" className="hud-btn text-xs px-3 py-1">Advisor を開く →</Link>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {([
              { label: "Strong Buy", v: advisorCounts.strongBuy, cls: "text-profit" },
              { label: "Buy", v: advisorCounts.buy, cls: "text-arc" },
              { label: "Watch", v: advisorCounts.watch, cls: "text-arc" },
              { label: "利益確定候補", v: advisorCounts.partialTP, cls: "text-caution" },
              { label: "損切り候補", v: advisorCounts.sellCandidate, cls: advisorCounts.sellCandidate > 0 ? "text-danger" : "text-arcdim" },
              { label: "危険", v: advisorCounts.danger, cls: advisorCounts.danger > 0 ? "text-danger" : "text-arcdim" },
            ] as const).map((c) => (
              <div key={c.label} className="rounded border border-line/60 p-3 text-center">
                <p className="hud-label">{c.label}</p>
                <p className={`font-mono text-2xl mt-1 ${c.cls}`}>{c.v}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-arcdim mt-2">※ 判断補助であり投資助言ではありません。詳細と根拠は Advisor 画面で確認できます、ボス。</p>
        </section>
      )}

      {advItems.length > 0 && (() => {
        const dangerSet: AdvisorCategory[] = ["danger", "sellCandidate", "reduce"];
        const picks = advItems.filter((i) => !dangerSet.includes(i.category)).slice(0, topN);
        const dangers = advItems.filter((i) => dangerSet.includes(i.category)).sort((a, b) => a.composite - b.composite);
        const catShort = (c: AdvisorItem["category"]) => CATEGORY_LABELS[c].split("（")[0];
        return (
          <section className="hud-panel p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="hud-label">⭐ Today&apos;s JARVIS Picks</h2>
              <div className="flex gap-1">
                {[3, 5, 10].map((n) => (
                  <button key={n} className={`hud-btn text-xs px-3 py-1 ${topN === n ? "text-arc border-arc/60" : "text-arcdim"}`} onClick={() => setTopN(n as 3 | 5 | 10)}>Top{n}</button>
                ))}
                <Link href="/advisor-ranking" className="hud-btn text-xs px-3 py-1">ランキング →</Link>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {picks.map((it, i) => (
                <div key={it.code} className="rounded border border-line/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-display tracking-wider text-arc">{i + 1}位 {it.code} {it.name}</span>
                    <span className="font-mono text-sm">{it.composite}/{it.grade}</span>
                  </div>
                  <p className={`text-xs font-mono mt-1 ${it.category === "strongBuy" || it.category === "buy" ? "text-profit" : "text-arc"}`}>{catShort(it.category)}</p>
                  <ul className="mt-1 text-xs font-mono text-[#cfeaff]">
                    {it.reasons.slice(0, 3).map((r, j) => <li key={j}>・{r}</li>)}
                  </ul>
                  <p className="text-[11px] text-arcdim mt-1 font-mono">
                    PF {it.bt?.pf != null ? it.bt.pf.toFixed(2) : "—"} / 期待値 {it.bt?.expectedValue != null ? `${it.bt.expectedValue.toFixed(1)}%` : "—"} / DD {it.bt?.maxDD != null ? `${it.bt.maxDD.toFixed(0)}%` : "—"} / 勝率 {it.bt?.winRate != null ? `${(it.bt.winRate * 100).toFixed(0)}%` : "—"}
                    {updatedByCode[it.code] ? ` / 更新 ${updatedByCode[it.code]!.slice(0, 10)}` : " / 手入力"}
                  </p>
                  <p className="text-xs text-arcdim mt-1 font-mono">JARVIS: {rankingComment(it, 0)}</p>
                  <div className="flex gap-2 mt-2">
                    <Link href="/stocks" className="hud-btn text-xs px-2 py-0.5">評価</Link>
                    <Link href="/advisor" className="hud-btn text-xs px-2 py-0.5">Advisor</Link>
                  </div>
                </div>
              ))}
            </div>
            {(() => {
              const favItems = advItems.filter((i) => favs.includes(i.code));
              return favItems.length > 0 ? (
                <div className="mt-3 rounded border border-arc/30 p-3">
                  <p className="hud-label text-arc mb-1">★ My Favorites（{favItems.length}）</p>
                  <ul className="space-y-0.5 text-xs font-mono">
                    {favItems.map((f) => (
                      <li key={f.code}><span className="text-arc">{f.code} {f.name}</span><span className="text-arcdim"> — {f.composite}/{f.grade} / {CATEGORY_LABELS[f.category].split("（")[0]}</span></li>
                    ))}
                  </ul>
                  <Link href="/advisor-ranking" className="hud-btn text-xs px-3 py-1 mt-2 inline-block">ランキングで管理 →</Link>
                </div>
              ) : null;
            })()}
            {dangers.length > 0 && (
              <div className="mt-3 rounded border border-danger/40 p-3">
                <p className="hud-label text-danger mb-1">⚠ 危険候補（{dangers.length}）</p>
                <ul className="space-y-0.5 text-xs font-mono">
                  {dangers.slice(0, 5).map((d) => (
                    <li key={d.code}><span className="text-danger">{d.code} {d.name}</span><span className="text-arcdim"> — {catShort(d.category)} / {d.reasons.slice(0, 3).join(" / ")}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {missingStocks.length > 0 && (
              <div className="mt-3 rounded border border-caution/40 p-3">
                <p className="hud-label text-caution mb-1">◇ データ不足（Advisor精度低下）</p>
                <ul className="space-y-0.5 text-xs font-mono">
                  {missingStocks.map((m) => (
                    <li key={m.code}><span className="text-arc">{m.code} {m.name}</span><span className="text-caution"> — 不足: {m.missing.join("/")}</span></li>
                  ))}
                </ul>
                <Link href="/stocks" className="hud-btn text-xs px-3 py-1 mt-2 inline-block">銘柄管理で補完 →</Link>
              </div>
            )}
            <p className="text-xs text-arcdim mt-2">※ 判断補助であり投資助言ではありません。</p>
          </section>
        );
      })()}

      {advisorCounts && (
        <AiComment
          ctx={{
            title: "Dashboard",
            facts: [
              `Strong Buy ${advisorCounts.strongBuy} / Buy ${advisorCounts.buy} / Watch ${advisorCounts.watch} / Danger ${advisorCounts.danger}`,
              risk ? `Risk Grade ${risk.riskGrade} / 破産確率 ${(risk.ruinProbability * 100).toFixed(1)}%` : "リスク: データ不足",
              ext && ext.avgPf != null ? `BT反映 ${ext.btCount}銘柄 / 平均PF ${ext.avgPf.toFixed(2)}` : "個別BT未反映（市場平均評価）",
            ],
          }}
        />
      )}

      {ext && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">🧩 拡張（AI/BT/Watchlist）</h2>
            <div className="flex gap-2">
              <Link href="/advisor" className="hud-btn text-xs px-3 py-1">AIコメント →</Link>
              <Link href="/stock-backtest" className="hud-btn text-xs px-3 py-1">銘柄別BT →</Link>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded border border-line/60 p-3">
              <p className="hud-label">AIコメント</p>
              <p className="font-mono text-2xl mt-1 text-arc">{ext.aiCount}件</p>
            </div>
            <div className="rounded border border-line/60 p-3">
              <p className="hud-label">Watchlist検出</p>
              <p className={`font-mono text-2xl mt-1 ${ext.watchCount > 0 ? "text-caution" : "text-arcdim"}`}>{ext.watchCount}件</p>
            </div>
            <div className="rounded border border-line/60 p-3">
              <p className="hud-label">Advisor変化</p>
              <p className={`font-mono text-2xl mt-1 ${ext.advisorChange > 0 ? "text-arc" : "text-arcdim"}`}>{ext.advisorChange}件</p>
            </div>
            <div className="rounded border border-line/60 p-3">
              <p className="hud-label">銘柄別BT最新</p>
              <p className="font-mono text-sm mt-1 text-arc">{ext.bt ? `${ext.bt.name} CAGR ${ext.bt.cagr.toFixed(0)}%` : "—"}</p>
            </div>
          </div>
          <div className="mt-3 rounded border border-arc/30 p-3">
            <p className="hud-label">🧪 BT品質（Advisor反映）</p>
            {ext.btCount === 0 ? (
              <p className="text-xs text-arcdim mt-1 font-mono">銘柄別BT未実行。<Link href="/stock-backtest" className="text-arc hover:underline">銘柄別BT</Link> を実行するとAdvisor評価へ反映されます。</p>
            ) : (
              <p className="text-sm font-mono mt-1 text-[#cfeaff]">
                BT済 {ext.btCount}銘柄 / 未計算 {ext.btUncounted}銘柄 ／ 平均BTスコア <span className="text-arc">{ext.btAvg != null ? ext.btAvg.toFixed(0) : "—"}</span>
                {" "}／ 平均PF <span className="text-arc">{ext.avgPf != null ? ext.avgPf.toFixed(2) : "—"}</span> / DD <span className="text-caution">{ext.avgDD != null ? `${ext.avgDD.toFixed(0)}%` : "—"}</span> / CAGR <span className="text-arc">{ext.avgCagr != null ? `${ext.avgCagr.toFixed(0)}%` : "—"}</span>
                {ext.btBest && <> ／ 最良 <span className="text-profit">{ext.btBest.name}（BT {ext.btBest.grade}）</span></>}
              </p>
            )}
          </div>
        </section>
      )}

      {volAlerts && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">📊 出来高アラート</h2>
            <Link href="/report" className="hud-btn text-xs px-3 py-1">出来高レポート →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
            <div>
              <p className="hud-label"><HelpTooltip termKey="relativevolume" label="出来高急増" /></p>
              <p className={`font-mono text-xl mt-1 ${volAlerts.spikeCount > 0 ? "text-caution" : "text-arc"}`}>{volAlerts.spikeCount}件</p>
            </div>
            <div>
              <p className="hud-label"><HelpTooltip termKey="rsi" label="過熱出来高" /></p>
              <p className={`font-mono text-xl mt-1 ${volAlerts.overheatCount > 0 ? "text-danger" : "text-arc"}`}>{volAlerts.overheatCount}件</p>
            </div>
            <div>
              <p className="hud-label"><HelpTooltip termKey="volumetrend" label="出来高低下" /></p>
              <p className="font-mono text-xl mt-1 text-arcdim">{volAlerts.dropCount}件</p>
            </div>
            <div>
              <p className="hud-label"><HelpTooltip termKey="relativevolume" label="最大相対出来高" /></p>
              <p className="font-mono text-sm mt-1 text-arc">{volMax ? `${volMax.name} ${volMax.rv.toFixed(1)}x` : "—"}</p>
            </div>
          </div>
          <ul className="space-y-1 text-sm font-mono">
            {volAlerts.alerts.slice(0, 3).map((a) => (
              <li
                key={a.id}
                className={`px-3 py-1.5 rounded border ${
                  a.level === "danger" ? "border-danger/50 text-danger bg-danger/5" : a.level === "warning" ? "border-caution/50 text-caution bg-caution/5" : "border-arc/50 text-arc bg-arc/5"
                }`}
              >
                {a.stockName}（{a.stockCode}）: {a.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="hud-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="hud-label">🛰 JARVIS SCORE — 最有力候補</h2>
          <div className="flex gap-2">
            <Link href="/comparison" className="hud-btn text-xs px-3 py-1">銘柄比較 →</Link>
            <Link href="/portfolio" className="hud-btn text-xs px-3 py-1">PF分析 →</Link>
            <Link href="/simulator" className="hud-btn text-xs px-3 py-1">試算 →</Link>
            <Link href="/report" className="hud-btn text-xs px-3 py-1">レポート出力 →</Link>
          </div>
        </div>
        {topPick == null ? (
          <p className="text-arcdim text-sm">
            採点対象なし。銘柄管理から銘柄を追加してください。
          </p>
        ) : (
          <div className="grid md:grid-cols-[auto,1fr] gap-6 items-start">
            <div className="flex items-end gap-6">
              <div>
                <p className="hud-label">Score</p>
                <p className={`font-mono text-5xl mt-1 ${gradeTone[topPick.result.grade]}`}>
                  {topPick.result.score}
                </p>
              </div>
              <div>
                <p className="hud-label">Grade</p>
                <p className={`font-mono text-5xl mt-1 ${gradeTone[topPick.result.grade]}`}>
                  {topPick.result.grade}
                </p>
              </div>
              <div>
                <p className="hud-label">Recommendation</p>
                <p className="font-display text-2xl mt-1 text-arc">
                  {topPick.result.recommendation}
                </p>
              </div>
            </div>
            <div>
              <p className="font-mono text-arc mb-2">
                {topPick.stock.name}{" "}
                <span className="text-arcdim">({topPick.stock.code})</span>
              </p>
              <p className="hud-label mb-1">分析理由</p>
              <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono text-[#cfeaff]">
                {topPick.result.reasons.map((r, i) => (
                  <li key={i}>・{r}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {topPick && adaptive?.enabled && factor && (() => {
          const a = adaptiveScoreStock(topPick.stock, factor, adaptive.factorWeights);
          return (
            <p className="hud-label mt-3">
              Score {a.baseScore} / Adaptive <span className={gradeTone[a.grade]}>{a.score}</span> / 補正{" "}
              <span className={a.adjustment > 0 ? "text-profit" : a.adjustment < 0 ? "text-danger" : "text-arcdim"}>
                {a.adjustment >= 0 ? "+" : ""}{a.adjustment}
              </span>
            </p>
          );
        })()}
        {topPick && (
          <div className="mt-4">
            <JarvisCommentPanel
              key={topPick.stock.id}
              stock={topPick.stock}
              scoreResult={topPick.result}
              alerts={stockAlerts(topPick.stock)}
            />
          </div>
        )}
        {scored.length > 1 && (
          <div className="mt-4 pt-3 border-t border-line/60">
            <p className="hud-label mb-2">スコアランキング</p>
            <ul className="space-y-1 text-sm font-mono">
              {scored.slice(0, 5).map(({ stock, result }, i) => (
                <li key={stock.id} className="flex items-center justify-between">
                  <span className="text-arcdim">
                    {i + 1}. {stock.name} ({stock.code})
                  </span>
                  <span>
                    <span className={gradeTone[result.grade]}>{result.grade}</span>{" "}
                    <span className="text-arc">{result.score}</span>{" "}
                    <span className="text-arcdim">{result.recommendation}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {tvEnabled && (
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">
            📈 チャート{topPick ? ` — ${topPick.stock.name} (${topPick.stock.code})` : ""}
          </h2>
          <TradingViewChart code={topPick?.stock.code} height={460} />
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">⚠ 危険アラート</h2>
          {alerts.length === 0 ? (
            <p className="text-arcdim text-sm">
              異常なし。全システム正常稼働中です、ボス。
            </p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li
                  key={i}
                  className={`flex justify-between items-center text-sm font-mono px-3 py-2 rounded border ${
                    a.level === "danger"
                      ? "border-danger/50 text-danger bg-danger/5 shadow-dangerGlow"
                      : a.level === "caution"
                        ? "border-caution/50 text-caution bg-caution/5"
                        : "border-profit/50 text-profit bg-profit/5"
                  }`}
                >
                  <span>{a.subject}</span>
                  <span>{a.label}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">◎ 買い候補銘柄</h2>
          {candidates.length === 0 ? (
            <p className="text-arcdim text-sm">
              候補なし。銘柄管理から追加してください。
            </p>
          ) : (
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="hud-label text-left">
                  <th className="pb-2 font-normal">銘柄</th>
                  <th className="pb-2 font-normal">状態</th>
                  <th className="pb-2 font-normal text-right">現在値</th>
                  <th className="pb-2 font-normal text-right">Rank</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((s) => (
                  <tr key={s.id} className="border-t border-line/60">
                    <td className="py-2">
                      {s.name} <span className="text-arcdim">({s.code})</span>
                    </td>
                    <td className="py-2 text-arcdim">{s.status}</td>
                    <td className="py-2 text-right">
                      {s.current_price != null ? `¥${fmt(s.current_price)}` : "—"}
                    </td>
                    <td className="py-2 text-right text-arc">{s.rank}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-3">✎ 運用日誌 — 最新ログ</h2>
        {latestJournals.length === 0 ? (
          <p className="text-arcdim text-sm">記録なし。運用日誌から記録を開始してください。</p>
        ) : (
          <ul className="space-y-3">
            {latestJournals.map((j, i) => {
              const digest =
                j.marketMemo ?? j.reflection ?? j.tradeMemo ?? j.jarvisComment ?? "（本文なし）";
              return (
                <li
                  key={j.id}
                  className={`rounded border px-3 py-2 ${
                    i === 0
                      ? "border-arc/50 bg-arc/5 shadow-arc" // 最新1件を強調
                      : "border-line/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-arc text-sm">
                      {j.date}
                      {i === 0 && <span className="hud-label ml-2">LATEST</span>}
                    </span>
                  </div>
                  <p className="text-sm text-[#cfeaff] mt-1 line-clamp-2 whitespace-pre-wrap">
                    {digest}
                  </p>
                  {j.jarvisComment && (
                    <p className="text-xs text-arc mt-1 line-clamp-1">JARVIS: {j.jarvisComment}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="hud-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="hud-label">▤ 取引実績</h2>
          <div className="flex gap-2">
            <Link href="/history" className="hud-btn text-xs px-3 py-1">取引履歴 →</Link>
            <Link href="/backtest" className="hud-btn text-xs px-3 py-1">検証 →</Link>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div>
            <p className="hud-label">実現損益</p>
            <p className={`font-mono text-xl mt-1 ${tradeStats.totalPnl > 0 ? "text-profit" : tradeStats.totalPnl < 0 ? "text-danger" : "text-arc"}`}>
              {tradeStats.totalPnl >= 0 ? "+" : ""}¥{fmt(tradeStats.totalPnl)}
            </p>
          </div>
          <div>
            <p className="hud-label">勝率</p>
            <p className="font-mono text-xl mt-1 text-arc">
              {tradeStats.count > 0 ? `${(tradeStats.winRate * 100).toFixed(0)}%` : "—"}
            </p>
          </div>
          <div>
            <p className="hud-label">今月の成績</p>
            <p className={`font-mono text-xl mt-1 ${tradeStats.monthPnl > 0 ? "text-profit" : tradeStats.monthPnl < 0 ? "text-danger" : "text-arc"}`}>
              {tradeStats.monthCount > 0 ? `${tradeStats.monthPnl >= 0 ? "+" : ""}¥${fmt(tradeStats.monthPnl)}` : "—"}
            </p>
          </div>
        </div>
        {tradeStats.recent.length === 0 ? (
          <p className="text-arcdim text-sm">取引履歴なし。保有株の売却時に記録されます。</p>
        ) : (
          <ul className="space-y-1 text-sm font-mono">
            {tradeStats.recent.map((t) => (
              <li key={t.id} className="flex justify-between border-t border-line/60 py-1">
                <span className="text-arcdim">{t.date} {t.stockName}（{t.stockCode}）</span>
                <span className={t.realizedPnl >= 0 ? "text-profit" : "text-danger"}>
                  {t.realizedPnl >= 0 ? "+" : ""}¥{fmt(t.realizedPnl)}（{t.realizedPnlRate >= 0 ? "+" : ""}{t.realizedPnlRate.toFixed(1)}%）
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {discipline && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">
              ⚖ 規律モニター — スコア{" "}
              <span className={discipline.score >= 90 ? "text-profit" : discipline.score >= 50 ? "text-caution" : "text-danger"}>
                {discipline.score}
              </span>
              <span className="text-arcdim"> / 重大 {discipline.dangerCount} ・ 警告 {discipline.warningCount}</span>
            </h2>
            <Link href="/discipline" className="hud-btn text-xs px-3 py-1">規律詳細 →</Link>
          </div>
          {discipline.results.length === 0 ? (
            <p className="text-arcdim text-sm">検知された違反はありません。規律は完璧です、ボス。</p>
          ) : (
            <ul className="space-y-1 text-sm font-mono">
              {discipline.results
                .slice()
                .sort((a, b) => {
                  const o = { danger: 0, warning: 1, info: 2 } as const;
                  return o[a.level] - o[b.level];
                })
                .slice(0, 3)
                .map((r) => (
                  <li
                    key={r.id}
                    className={`px-3 py-1.5 rounded border ${
                      r.level === "danger"
                        ? "border-danger/50 text-danger bg-danger/5"
                        : r.level === "warning"
                          ? "border-caution/50 text-caution bg-caution/5"
                          : "border-arc/50 text-arc bg-arc/5"
                    }`}
                  >
                    {r.title}
                    {r.relatedStockName && <span className="text-arcdim"> — {r.relatedStockName}（{r.relatedStockCode}）</span>}
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {strategySummary && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">
              ✵ 主戦略 — <span className="text-arc">{strategySummary.name}</span>
              <span className="text-arcdim"> / 登録 {strategySummary.count} 件 ・ 適合 {strategySummary.matchCount} 件 ・ 戦略違反 </span>
              <span className={strategySummary.violationCount > 0 ? "text-danger" : "text-arcdim"}>
                {strategySummary.violationCount} 件
              </span>
            </h2>
            <Link href="/strategy" className="hud-btn text-xs px-3 py-1">戦略編集 →</Link>
          </div>
          {strategySummary.warning ? (
            <p className="text-sm font-mono text-danger border border-danger/50 bg-danger/5 rounded px-3 py-2">
              最新の戦略警告: {strategySummary.warning}
            </p>
          ) : (
            <p className="text-arcdim text-sm">保有銘柄は主戦略の条件を満たしています、ボス。</p>
          )}
          {bestStrategy && (
            <p className="hud-label mt-3">
              最も成績の良い戦略:{" "}
              <span className="text-arc">{bestStrategy.name}</span>
              <span className="text-arcdim">
                {" "}（勝率 {(bestStrategy.winRate * 100).toFixed(0)}% ・{" "}
              </span>
              <span className={bestStrategy.totalRealizedPnl >= 0 ? "text-profit" : "text-danger"}>
                {bestStrategy.totalRealizedPnl >= 0 ? "+" : ""}¥{fmt(bestStrategy.totalRealizedPnl)}
              </span>
              <span className="text-arcdim">）</span>
            </p>
          )}
          {improvements.length > 0 && (
            <div className="mt-3 pt-3 border-t border-line/60 flex items-center justify-between">
              <p className="hud-label">
                ルール改善提案:{" "}
                <span className="text-caution">{improvements.length} 件</span>
                <span className="text-arcdim">
                  {" "}（高信頼 {improvements.filter((i) => i.confidence === "high").length} 件）
                </span>
                <span className="text-arc"> — 最新: {improvements[0].title}（{improvements[0].strategyName}）</span>
              </p>
              <Link href="/rule-improver" className="hud-btn text-xs px-3 py-1">改善提案 →</Link>
            </div>
          )}
        </section>
      )}

      {mc && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">🎲 リスク予測（モンテカルロ / 500回）</h2>
            <Link href="/montecarlo" className="hud-btn text-xs px-3 py-1">MC詳細 →</Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="hud-label">破産確率</p>
              <p className={`font-mono text-xl mt-1 ${mc.ruinProb > 0.05 ? "text-danger" : "text-arc"}`}>{(mc.ruinProb * 100).toFixed(1)}%</p>
            </div>
            <div>
              <p className="hud-label">期待リターン</p>
              <p className={`font-mono text-xl mt-1 ${mc.expectedReturnPct >= 0 ? "text-profit" : "text-danger"}`}>
                {mc.expectedReturnPct >= 0 ? "+" : ""}{mc.expectedReturnPct.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="hud-label">DD95</p>
              <p className="font-mono text-xl mt-1 text-caution">{mc.dd95.toFixed(1)}%</p>
            </div>
            <div>
              <p className="hud-label">5連敗以上確率</p>
              <p className={`font-mono text-xl mt-1 ${mc.probStreakGE5 > 0.3 ? "text-danger" : "text-arc"}`}>{(mc.probStreakGE5 * 100).toFixed(1)}%</p>
            </div>
          </div>
        </section>
      )}

      {risk && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">
              🛡 リスク総合 — Grade{" "}
              <span
                className={
                  risk.riskGrade === "D" ? "text-danger" : risk.riskGrade === "C" ? "text-caution" : "text-arc"
                }
              >
                {risk.riskGrade}
              </span>
              <span className="text-arcdim"> / Score {risk.riskScore}</span>
            </h2>
            <Link href="/risk" className="hud-btn text-xs px-3 py-1">リスク詳細 →</Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="hud-label">破産確率</p>
              <p className={`font-mono text-xl mt-1 ${risk.ruinProbability > 0.05 ? "text-danger" : "text-arc"}`}>{(risk.ruinProbability * 100).toFixed(1)}%</p>
            </div>
            <div>
              <p className="hud-label">最大DD95</p>
              <p className="font-mono text-xl mt-1 text-caution">{risk.dd95.toFixed(1)}%</p>
            </div>
            <div>
              <p className="hud-label">VaR95(1取引)</p>
              <p className="font-mono text-xl mt-1 text-danger">¥{fmt(risk.var95)}</p>
            </div>
            <div>
              <p className="hud-label">重大リスク件数</p>
              <p className={`font-mono text-xl mt-1 ${risk.dangerCount > 0 ? "text-danger" : "text-arc"}`}>{risk.dangerCount}</p>
            </div>
          </div>
        </section>
      )}

      {factor && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">◆ ファクター</h2>
            <Link href="/factor" className="hud-btn text-xs px-3 py-1">要因分析 →</Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <p className="hud-label">最強Factor</p>
              <p className="font-mono text-lg mt-1 text-arc">
                {factor.bestFactor ? `${factor.bestFactor.label} (+${(factor.bestFactor.contribution * 100).toFixed(0)}%)` : "—"}
              </p>
            </div>
            <div>
              <p className="hud-label">最弱Factor</p>
              <p className="font-mono text-lg mt-1 text-danger">
                {factor.worstFactor ? `${factor.worstFactor.label} (${(factor.worstFactor.contribution * 100).toFixed(0)}%)` : "—"}
              </p>
            </div>
            <div>
              <p className="hud-label">Factor警告</p>
              <p className={`font-mono text-lg mt-1 ${factor.worstFactor ? "text-caution" : "text-arc"}`}>
                {factor.worstFactor ? `${factor.worstFactor.label} が損益にマイナス寄与` : "顕著な悪影響なし"}
              </p>
            </div>
          </div>
        </section>
      )}

      {mental && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">
              🧠 メンタル — Score{" "}
              <span className={mental.mentalScore >= 80 ? "text-profit" : mental.mentalScore >= 60 ? "text-arc" : mental.mentalScore >= 45 ? "text-caution" : "text-danger"}>
                {mental.mentalScore}
              </span>
            </h2>
            <Link href="/mental" className="hud-btn text-xs px-3 py-1">心理分析 →</Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <p className="hud-label">危険感情</p>
              <p className="font-mono text-lg mt-1 text-danger">
                {mental.riskEmotion && mental.riskEmotion.avgPnl < 0 ? mental.riskEmotion.emotion : "—"}
              </p>
            </div>
            <div>
              <p className="hud-label">好成績感情</p>
              <p className="font-mono text-lg mt-1 text-arc">
                {mental.bestEmotion && mental.bestEmotion.avgPnl > 0 ? mental.bestEmotion.emotion : "—"}
              </p>
            </div>
            <div>
              <p className="hud-label">直近メンタル警告</p>
              <p className={`font-mono text-sm mt-1 ${mental.afterLoss.count >= 2 && mental.afterLoss.avgPnl < 0 ? "text-caution" : "text-arcdim"}`}>
                {mental.afterLoss.count >= 2 && mental.afterLoss.avgPnl < 0 ? "連敗後の再エントリーで損失拡大" : "顕著な警告なし"}
              </p>
            </div>
          </div>
        </section>
      )}

      {(radar || risk) && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">🗒 最新レポート要約</h2>
            <Link href="/report" className="hud-btn text-xs px-3 py-1">レポート出力 →</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <p className="hud-label">Market State</p>
              <p className={`font-mono text-lg mt-1 ${radar?.marketState === "Panic" || radar?.marketState === "Bear" ? "text-danger" : radar?.marketState === "Bull" ? "text-profit" : "text-arc"}`}>{radar?.marketState ?? "—"}</p>
            </div>
            <div>
              <p className="hud-label">Risk Grade</p>
              <p className={`font-mono text-lg mt-1 ${risk?.riskGrade === "D" ? "text-danger" : risk?.riskGrade === "C" ? "text-caution" : "text-arc"}`}>{risk?.riskGrade ?? "—"}</p>
            </div>
            <div>
              <p className="hud-label">最強Strategy</p>
              <p className="font-mono text-sm mt-1 text-arc">{ranking?.latest.bestStrategy ?? strategySummary?.name ?? "—"}</p>
            </div>
            <div>
              <p className="hud-label">最大集中テーマ</p>
              <p className="font-mono text-sm mt-1 text-[#cfeaff]">{sector?.maxHoldingSector ? `${sector.maxHoldingSector.sectorName} ${(sector.maxHoldingSector.portfolioWeight * 100).toFixed(0)}%` : "—"}</p>
            </div>
            <div>
              <p className="hud-label">高優先度提案</p>
              <p className={`font-mono text-lg mt-1 ${rebalance.filter((r) => r.priority === "high").length > 0 ? "text-danger" : "text-arc"}`}>{rebalance.filter((r) => r.priority === "high").length}件</p>
            </div>
          </div>
        </section>
      )}

      {snapshot && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">📚 保存済みレポート — {snapshot.latest.date}（前回比）</h2>
            <Link href="/report-history" className="hud-btn text-xs px-3 py-1">履歴比較 →</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {snapshot.rows
              .filter((r) => ["totalAssets", "realizedPnl", "riskScore", "mentalScore", "maxDrawdown"].includes(r.key))
              .map((r) => (
                <div key={r.key}>
                  <p className="hud-label">{r.label}</p>
                  <p className="font-mono text-sm mt-1 text-[#cfeaff]">{r.cur}</p>
                  <p className={`font-mono text-xs ${r.better === true ? "text-arc" : r.better === false ? "text-danger" : "text-arcdim"}`}>
                    {r.delta}
                  </p>
                </div>
              ))}
          </div>
        </section>
      )}

      {autoReport && (
        <section className="hud-panel p-4">
          <h2 className="hud-label mb-3">
            🗓 自動レポート:{" "}
            <span className={autoReport.enabled ? "text-profit" : "text-arcdim"}>{autoReport.enabled ? `ON（${autoReport.frequency}）` : "OFF"}</span>
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <p className="hud-label">最新自動保存日</p>
              <p className="font-mono text-lg mt-1 text-arc">{autoReport.lastAuto ?? "—"}</p>
            </div>
            <div>
              <p className="hud-label">次回保存目安</p>
              <p className="font-mono text-sm mt-1 text-[#cfeaff]">{autoReport.enabled ? autoReport.nextDue : "—"}</p>
            </div>
            <div>
              <p className="hud-label">保存件数</p>
              <p className="font-mono text-lg mt-1 text-arc">{autoReport.count}件</p>
            </div>
          </div>
        </section>
      )}

      {notifInfo && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">
              🔔 通知:{" "}
              <span className={notifInfo.enabled && notifInfo.permission === "granted" ? "text-profit" : "text-arcdim"}>
                {notifInfo.enabled ? "ON" : "OFF"}
              </span>
              <span className="text-arcdim">
                {" "}／ 許可: {notifInfo.permission === "granted" ? "許可" : notifInfo.permission === "denied" ? "拒否" : notifInfo.permission === "unsupported" ? "未対応" : "未設定"}
              </span>
            </h2>
            <div className="flex gap-2">
              <Link href="/notifications" className="hud-btn text-xs px-3 py-1">通知履歴 →</Link>
              <Link href="/settings" className="hud-btn text-xs px-3 py-1">通知設定 →</Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="rounded border border-line/60 p-3">
              <p className="hud-label">未読通知</p>
              <p className={`font-mono text-lg mt-1 ${notifInfo.unread > 0 ? "text-arc" : "text-arcdim"}`}>{notifInfo.unread}件</p>
            </div>
            <div className="rounded border border-line/60 p-3">
              <p className="hud-label">未読danger</p>
              <p className={`font-mono text-lg mt-1 ${notifInfo.dangerUnread > 0 ? "text-danger" : "text-arcdim"}`}>{notifInfo.dangerUnread}件</p>
            </div>
          </div>
          {notifInfo.dangerUnread > 0 && (
            <p className="text-sm font-mono text-danger mb-2">・未読のdanger通知が{notifInfo.dangerUnread}件あります。無視するには少々勇敢すぎます、ボス。</p>
          )}
          <p className="hud-label mb-1">最新通知</p>
          {notifInfo.recent.length === 0 ? (
            <p className="text-sm font-mono text-arcdim">通知履歴はありません。</p>
          ) : (
            <ul className="space-y-1">
              {notifInfo.recent.map((r) => (
                <li key={r.id} className="text-sm font-mono flex items-center justify-between">
                  <span className={r.level === "danger" ? "text-danger" : r.level === "warning" ? "text-caution" : "text-arc"}>{r.title}</span>
                  <span className="text-arcdim">{formatBackupTime(r.at) ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(() => {
        if (btSummaries.length === 0) return null;
        const avgCagr = btSummaries.reduce((a, s) => a + s.cagr, 0) / btSummaries.length;
        const best = btSummaries.slice().sort((a, b) => b.cagr - a.cagr)[0];
        const bestYears = btSummaries.map((s) => s.bestYear).filter((y): y is { year: string; returnPct: number } => !!y);
        const worstYears = btSummaries.map((s) => s.worstYear).filter((y): y is { year: string; returnPct: number } => !!y);
        const bestPeriod = bestYears.slice().sort((a, b) => b.returnPct - a.returnPct)[0] ?? null;
        const worstPeriod = worstYears.slice().sort((a, b) => a.returnPct - b.returnPct)[0] ?? null;
        const lowDd = btSummaries.slice().sort((a, b) => a.maxDrawdownPct - b.maxDrawdownPct)[0];
        return (
          <section className="hud-panel p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="hud-label">⧗ 実データ検証（バックテスト）</h2>
              <div className="flex gap-2">
                <Link href="/backtest-v2" className="hud-btn text-xs px-3 py-1">実証 →</Link>
                <Link href="/strategy-backtest" className="hud-btn text-xs px-3 py-1">一括BT →</Link>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <p className="hud-label">平均CAGR</p>
                <p className={`font-mono text-xl mt-1 ${avgCagr >= 0 ? "text-profit" : "text-danger"}`}>{avgCagr.toFixed(1)}%</p>
              </div>
              <div>
                <p className="hud-label">最強戦略（最高CAGR）</p>
                <p className="font-mono text-lg mt-1 text-arc">{best.strategyName}<span className="text-arcdim"> {best.cagr.toFixed(1)}%</span></p>
              </div>
              <div>
                <p className="hud-label">最低DD戦略</p>
                <p className="font-mono text-lg mt-1 text-profit">{lowDd.strategyName}<span className="text-arcdim"> {lowDd.maxDrawdownPct.toFixed(1)}%</span></p>
              </div>
              <div>
                <p className="hud-label">最良/最悪期間</p>
                <p className="font-mono text-sm mt-1">
                  <span className="text-profit">{bestPeriod ? `${bestPeriod.year} +${bestPeriod.returnPct.toFixed(0)}%` : "—"}</span>
                  {" / "}
                  <span className="text-danger">{worstPeriod ? `${worstPeriod.year} ${worstPeriod.returnPct.toFixed(0)}%` : "—"}</span>
                </p>
              </div>
            </div>
          </section>
        );
      })()}

      {ranking && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="hud-label">🏁 最新戦略ランキング — {ranking.latest.date}（{ranking.latest.period}）</h2>
            <Link href="/strategy-rank-history" className="hud-btn text-xs px-3 py-1">BT履歴 →</Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="hud-label">現在の最強戦略</p>
              <p className="font-mono text-lg mt-1 text-arc">{ranking.latest.bestStrategy}</p>
            </div>
            <div>
              <p className="hud-label">平均CAGR</p>
              <p className={`font-mono text-lg mt-1 ${ranking.latest.averageCagr >= 0 ? "text-profit" : "text-danger"}`}>{ranking.latest.averageCagr.toFixed(1)}%</p>
            </div>
            <div>
              <p className="hud-label">平均最大DD</p>
              <p className="font-mono text-lg mt-1 text-caution">{ranking.latest.averageMaxDrawdown.toFixed(1)}%</p>
            </div>
            <div>
              <p className="hud-label">ランキング変動</p>
              <p className={`font-mono text-sm mt-1 ${ranking.prevBest && ranking.prevBest !== ranking.latest.bestStrategy ? "text-caution" : "text-arcdim"}`}>
                {ranking.prevBest && ranking.prevBest !== ranking.latest.bestStrategy
                  ? `首位交代（前回: ${ranking.prevBest}）`
                  : "首位変わらず"}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
