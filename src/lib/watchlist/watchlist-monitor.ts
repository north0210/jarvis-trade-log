/**
 * Phase 55 (v1.3): Watchlist 自動監視（完全ローカル・外部API追加なし）。
 * 登録銘柄を定期チェックし、条件に合致した銘柄を検出して履歴・通知に残す。
 * LINE/ニュース監視は行わない。ブラウザ通知は許可時のみ（notification-service経由）。
 */
import { getStockRepository } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getTradeRepository } from "@/lib/storage/tradeRepository";
import { ensureSeeded, getPrimaryStrategyId } from "@/lib/storage/strategyRepository";
import { analyzePortfolio, getCashPosition } from "@/lib/analysis/portfolio";
import { runMonteCarlo } from "@/lib/analytics/montecarlo";
import { getDashboardRuns } from "@/lib/settings/performance";
import { runBacktest } from "@/lib/analysis/backtest";
import { evaluateDiscipline } from "@/lib/discipline/rules";
import { evaluateRisk } from "@/lib/risk/risk-engine";
import { analyzeFactors } from "@/lib/analytics/factor-analysis";
import { adaptiveScoreStock, getAdaptiveScoreSettings } from "@/lib/score/adaptive-score";
import { scoreStock } from "@/lib/score";
import { getThresholds } from "@/lib/settings/thresholds";
import { getBacktestSummaries } from "@/lib/analytics/backtest-engine";
import { buildAdvisorReport } from "@/lib/advisor/advisor-engine";
import { getPerStockBacktestMap } from "@/lib/advisor/advisor-provider";
import { notify } from "@/lib/notifications/notification-service";

const SETTINGS_KEY = "jarvis-trade-log:watchlist-settings";
const PREV_KEY = "jarvis-trade-log:watchlist-prev";
const HIST_KEY = "jarvis-trade-log:watchlist-detections";

export interface WatchlistSettings {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
}
const DEFAULT_SETTINGS: WatchlistSettings = { enabled: false, intervalMinutes: 30, lastRunAt: null };

export type DetectionKind =
  | "scoreSurge"
  | "scoreDrop"
  | "rsiOverheat"
  | "rsiDip"
  | "volumeSurge"
  | "riskWorse"
  | "strongBuy"
  | "danger"
  | "sellCandidate"
  | "partialTP"
  | "advisorChange";

export interface Detection {
  id: string;
  at: string;
  code: string;
  name: string;
  kind: DetectionKind;
  message: string;
  level: "info" | "warning" | "danger";
}

interface PrevEntry {
  score: number;
  category: string;
  rsi: number | null;
  relVol: number | null;
}
interface PrevState {
  riskGrade: string;
  map: Record<string, PrevEntry>;
}

// ---- 設定 ----
export function getWatchlistSettings(): WatchlistSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw) as Partial<WatchlistSettings>;
    return {
      enabled: p.enabled === true,
      intervalMinutes: typeof p.intervalMinutes === "number" && p.intervalMinutes >= 5 ? p.intervalMinutes : 30,
      lastRunAt: typeof p.lastRunAt === "string" ? p.lastRunAt : null,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function setWatchlistSettings(patch: Partial<WatchlistSettings>): WatchlistSettings {
  const merged = { ...getWatchlistSettings(), ...patch };
  if (typeof window !== "undefined") window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

// ---- 履歴 ----
function readHist(): Detection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HIST_KEY);
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? (p as Detection[]) : [];
  } catch {
    return [];
  }
}
function writeHist(list: Detection[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 100)));
}
export function listDetections(): Detection[] {
  return readHist().slice().sort((a, b) => b.at.localeCompare(a.at));
}
export function clearDetections(): void {
  writeHist([]);
}
export function detectionCountSince(iso: string | null): number {
  if (!iso) return readHist().length;
  return readHist().filter((d) => d.at >= iso).length;
}

function readPrev(): PrevState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREV_KEY);
    return raw ? (JSON.parse(raw) as PrevState) : null;
  } catch {
    return null;
  }
}
function writePrev(s: PrevState) {
  if (typeof window !== "undefined") window.localStorage.setItem(PREV_KEY, JSON.stringify(s));
}

const gradeRank: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e6)}`);

/**
 * 監視チェックを1回実行。検出を履歴・通知へ保存し、prev を更新する。
 * @returns 今回の検出配列
 */
export async function runWatchlistCheck(at: string): Promise<Detection[]> {
  const [stocks, holdings, trades, strategies] = await Promise.all([
    getStockRepository().list(),
    getHoldingRepository().list(),
    getTradeRepository().list(),
    ensureSeeded(),
  ]);
  if (stocks.length === 0) {
    setWatchlistSettings({ lastRunAt: at });
    return [];
  }
  const cash = getCashPosition();
  const th = getThresholds();
  const portfolio = analyzePortfolio(stocks, holdings, cash);
  const mc = trades.length ? runMonteCarlo({ pnls: trades.map((t) => t.realizedPnl), capital: portfolio.totalAssets, runs: getDashboardRuns() }) : null;
  const discipline = evaluateDiscipline(stocks, holdings, trades, cash);
  const risk = mc ? evaluateRisk(portfolio, mc, runBacktest(trades), discipline, trades, th) : null;
  const factor = analyzeFactors(stocks, trades, strategies, risk, discipline);
  const weights = getAdaptiveScoreSettings().factorWeights;
  const adaptiveByCode: Record<string, number> = {};
  for (const s of stocks) adaptiveByCode[s.code] = adaptiveScoreStock(s, factor, weights).score;
  const primary = strategies.find((x) => x.id === getPrimaryStrategyId()) ?? strategies[0] ?? null;
  const advisor = buildAdvisorReport({ stocks, holdings, portfolio, risk, discipline, btSummaries: getBacktestSummaries(), primaryStrategy: primary, thresholds: th, adaptiveByCode, perStock: getPerStockBacktestMap() });
  const catByCode = new Map(advisor.items.map((i) => [i.code, i.category]));

  const prev = readPrev();
  const day = at.slice(0, 10);
  const detections: Detection[] = [];
  const push = (code: string, name: string, kind: DetectionKind, message: string, level: Detection["level"]) => {
    detections.push({ id: newId(), at, code, name, kind, message, level });
    notify(`Watchlist: ${name}`, message, `watchlist:${kind}:${code}:${day}`, "system", level, "watchlist");
  };

  const nextMap: Record<string, PrevEntry> = {};
  for (const s of stocks) {
    const sc = scoreStock(s).score;
    const cat = catByCode.get(s.code) ?? "avoid";
    const rsi = s.rsi ?? null;
    const relVol = s.relativeVolume ?? null;
    nextMap[s.code] = { score: sc, category: cat, rsi, relVol };
    const p = prev?.map[s.code];

    if (p) {
      if (sc - p.score >= 10) push(s.code, s.name, "scoreSurge", `Score が ${p.score}→${sc} に急上昇しています。`, "info");
      if (p.score - sc >= 10) push(s.code, s.name, "scoreDrop", `Score が ${p.score}→${sc} に急落しています。`, "warning");
      if (rsi != null && rsi >= th.rsiOverheat && (p.rsi == null || p.rsi < th.rsiOverheat)) push(s.code, s.name, "rsiOverheat", `RSI が ${rsi.toFixed(0)} と過熱域に入りました。`, "warning");
      if (rsi != null && rsi <= 40 && (p.rsi == null || p.rsi > 40)) push(s.code, s.name, "rsiDip", `RSI が ${rsi.toFixed(0)} と押し目域に入りました。`, "info");
      if (relVol != null && relVol >= th.relativeVolumeDanger && (p.relVol == null || p.relVol < th.relativeVolumeDanger)) push(s.code, s.name, "volumeSurge", `相対出来高が ${relVol.toFixed(1)}x に急増しています。`, "warning");
      if (cat !== p.category) {
        if (cat === "strongBuy") push(s.code, s.name, "strongBuy", "Advisor 判定が Strong Buy 化しました。", "info");
        else if (cat === "danger") push(s.code, s.name, "danger", "Advisor 判定が Danger 化しました。", "danger");
        else if (cat === "sellCandidate") push(s.code, s.name, "sellCandidate", "Advisor 判定が 損切り候補 化しました。", "danger");
        else if (cat === "partialTP") push(s.code, s.name, "partialTP", "Advisor 判定が 利確候補 化しました。", "warning");
        else push(s.code, s.name, "advisorChange", `Advisor 判定が ${p.category}→${cat} に変化しました。`, "info");
      }
    }
  }

  // グローバル・リスク悪化
  const nowGrade = risk?.riskGrade ?? "B";
  if (prev && gradeRank[nowGrade] < gradeRank[prev.riskGrade]) {
    push("—", "ポートフォリオ", "riskWorse", `Risk Grade が ${prev.riskGrade}→${nowGrade} に悪化しました。`, "danger");
  }

  if (detections.length > 0) writeHist([...detections, ...readHist()]);
  writePrev({ riskGrade: nowGrade, map: nextMap });
  setWatchlistSettings({ lastRunAt: at });
  return detections;
}
