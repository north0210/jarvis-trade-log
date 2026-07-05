"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import HelpTooltip from "@/components/HelpTooltip";
import Disclaimer from "@/components/Disclaimer";
import AiComment from "@/components/AiComment";
import { APP_LABEL } from "@/lib/version";
import {
  getAdvisorWeights,
  setAdvisorWeights,
  resetAdvisorWeights,
  normalizeTo100,
  sumWeights,
  appliedPercents,
  weightComment,
  PRESETS,
  WEIGHT_KEYS,
  WEIGHT_META,
  type PresetKey,
} from "@/lib/settings/advisor-settings";
import type { AdvisorWeights } from "@/lib/advisor/advisorTypes";
import {
  getWatchlistSettings,
  setWatchlistSettings,
  listDetections,
  clearDetections,
  runWatchlistCheck,
  type WatchlistSettings,
  type Detection,
} from "@/lib/watchlist/watchlist-monitor";
import {
  getAiConfig,
  setAiConfig,
  AI_MODES,
  COMMENT_STYLES,
  COMMENT_DETAILS,
  TEMPERATURES,
  MAX_TOKENS,
  providerReady,
  type AiMode,
  type AiConfig,
  type CommentStyle,
  type CommentDetail,
} from "@/lib/advisor/advisor-ai-settings";
import {
  getPerformanceMode,
  setPerformanceMode,
  PERF_PROFILES,
  type PerformanceMode,
} from "@/lib/settings/performance";
import {
  getThresholds,
  setThresholds,
  resetThresholds,
  sensitivityBias,
  type ThresholdSettings,
  type RiskGradeThreshold,
} from "@/lib/settings/thresholds";
import { exportAll, getLastBackup, formatBackupTime } from "@/lib/storage/exportService";
import { importAll } from "@/lib/storage/importService";
import { STORAGE_KEYS } from "@/lib/storage/keys";
import { getStockRepository, type StockInput } from "@/lib/storage/stockRepository";
import { getHoldingRepository } from "@/lib/storage/holdingRepository";
import { getJournalRepository } from "@/lib/storage/journalRepository";
import { isTradingViewEnabled, setTradingViewEnabled } from "@/lib/tradingview";
import {
  getProviderMode,
  setProviderMode,
  getJQuantsCredentials,
  setJQuantsCredentials,
  getJQuantsStatus,
  setJQuantsStatus,
  type JQuantsStatusRecord,
} from "@/lib/pricing/settings";
import { testJQuantsConnection } from "@/lib/pricing/jquantsClient";
import { updateAllPrices, getLatestUpdateLog, type PriceUpdateLog } from "@/lib/pricing/priceUpdater";
import {
  getAutoUpdateSettings,
  setAutoUpdateSettings,
  restartAutoUpdate,
  INTERVAL_OPTIONS,
  type AutoUpdateSettings,
} from "@/lib/pricing/auto-update";
import type { PriceProviderMode } from "@/lib/pricing/provider";
import { getAICommentSettings, setAICommentSettings } from "@/lib/analysis/ai-settings";
import { getLLMProviderStatus } from "@/lib/analysis/llm-commentary";
import { getAdaptiveScoreSettings, setAdaptiveScoreSettings } from "@/lib/score/adaptive-score";
import { getAutoReportSettings, setAutoReportSettings, type ReportFrequency } from "@/lib/report/auto-report";
import {
  getNotificationSettings,
  setNotificationSettings,
  requestPermission,
  permissionState,
  getRetentionPolicy,
  setRetentionPolicy,
  cleanupNotifications,
  type NotificationSettings,
  type PermissionState,
  type RetentionPolicy,
} from "@/lib/notifications/notification-service";
import type { MacdState, StockRank, StockStatus } from "@/lib/types";

const stockRepo = getStockRepository();
const holdingRepo = getHoldingRepository();
const journalRepo = getJournalRepository();

type Msg = { tone: "ok" | "err"; text: string } | null;

export default function SettingsPage() {
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [tvEnabled, setTvEnabled] = useState(true);
  const [mode, setMode] = useState<PriceProviderMode>("manual");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [jqStatus, setJqStatus] = useState<JQuantsStatusRecord | null>(null);
  const [testing, setTesting] = useState(false);
  const [priceUpdating, setPriceUpdating] = useState(false);
  const [lastLog, setLastLog] = useState<PriceUpdateLog | null>(null);
  const [auto, setAuto] = useState<AutoUpdateSettings>({
    enabled: false,
    intervalMinutes: 30,
    lastAutoUpdateAt: null,
  });
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProvider, setAiProvider] = useState<"anthropic" | "openai" | "none">("none");
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(false);
  const [autoReport, setAutoReport] = useState<{ enabled: boolean; frequency: ReportFrequency }>({ enabled: false, frequency: "daily" });
  const [notif, setNotif] = useState<NotificationSettings>({ enabled: false, report: true, discipline: true, volume: true, risk: true });
  const [notifPerm, setNotifPerm] = useState<PermissionState>("default");
  const [retention, setRetention] = useState<RetentionPolicy>("30");
  const [thresholds, setThresholdsState] = useState<ThresholdSettings | null>(null);
  const [perfMode, setPerfMode] = useState<PerformanceMode>("normal");
  const [advWeights, setAdvWeights] = useState<AdvisorWeights | null>(null);
  const [watch, setWatch] = useState<WatchlistSettings | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [watchBusy, setWatchBusy] = useState(false);
  const [aiCfg, setAiCfg] = useState<AiConfig | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLastBackup(formatBackupTime(getLastBackup()));
    setTvEnabled(isTradingViewEnabled());
    setMode(getProviderMode());
    setJqStatus(getJQuantsStatus());
    setLastLog(getLatestUpdateLog());
    setAuto(getAutoUpdateSettings());
    setAiEnabled(getAICommentSettings().enabled);
    setAdaptiveEnabled(getAdaptiveScoreSettings().enabled);
    const ar = getAutoReportSettings();
    setAutoReport({ enabled: ar.enabled, frequency: ar.frequency });
    setNotif(getNotificationSettings());
    setNotifPerm(permissionState());
    setRetention(getRetentionPolicy());
    setThresholdsState(getThresholds());
    setPerfMode(getPerformanceMode());
    setAdvWeights(getAdvisorWeights());
    setWatch(getWatchlistSettings());
    setDetections(listDetections());
    setAiCfg(getAiConfig());
    getLLMProviderStatus().then((r) => setAiProvider(r.provider));
    const cred = getJQuantsCredentials();
    if (cred) {
      setEmail(cred.email);
      setPassword(cred.password);
    }
  }, []);

  const testConnection = async () => {
    setTesting(true);
    // 直近入力を保存してからテスト（env 設定時はサーバ側で env が優先される）
    setJQuantsCredentials({ email, password });
    const res = await testJQuantsConnection({ email, password });
    const record: JQuantsStatusRecord = {
      status: res.status,
      at: new Date().toISOString(),
      message: res.message ?? (res.ok ? "接続成功" : "接続失敗"),
    };
    setJQuantsStatus(record);
    setJqStatus(record);
    setTesting(false);
    setMsg({
      tone: res.ok ? "ok" : "err",
      text: `J-Quants 接続テスト: ${record.message}`,
    });
  };

  const statusLabel = (s: JQuantsStatusRecord | null) => {
    if (!s || s.status === "unset") return "未設定";
    return s.status === "connected" ? "接続成功" : "認証失敗";
  };

  const toggleAuto = () => {
    const next = setAutoUpdateSettings({ enabled: !auto.enabled });
    setAuto(next);
    restartAutoUpdate();
    setMsg({
      tone: "ok",
      text: next.enabled ? "自動価格更新を開始しました" : "自動価格更新を停止しました",
    });
  };

  const changeInterval = (minutes: number) => {
    const next = setAutoUpdateSettings({ intervalMinutes: minutes });
    setAuto(next);
    restartAutoUpdate();
    setMsg({ tone: "ok", text: `更新間隔を ${minutes} 分に設定しました。` });
  };

  const toggleNotif = async () => {
    const next = !notif.enabled;
    if (next && permissionState() !== "granted") {
      const p = await requestPermission();
      setNotifPerm(p);
      if (p !== "granted") {
        setMsg({ tone: "err", text: "ブラウザ通知が拒否されています。必要であればブラウザ設定から許可してください。" });
        return;
      }
    }
    const s = setNotificationSettings({ enabled: next });
    setNotif(s);
    setMsg({ tone: "ok", text: next ? "通知を有効化しました。重要イベントを見逃しにくくなります。" : "通知を無効化しました。" });
  };
  const toggleNotifCat = (k: keyof NotificationSettings) => {
    const s = setNotificationSettings({ [k]: !notif[k] });
    setNotif(s);
  };
  const changeRetention = (p: RetentionPolicy) => {
    setRetentionPolicy(p);
    setRetention(p);
    const n = cleanupNotifications();
    setMsg({ tone: "ok", text: `通知保持期間を設定しました（${n > 0 ? `${n}件を整理` : "整理対象なし"}）。` });
  };

  const commitThreshold = (patch: Partial<ThresholdSettings>) => {
    const next = setThresholds(patch);
    setThresholdsState(next);
    const bias = sensitivityBias(next);
    const tail = bias >= 2 ? "少し神経質な設定です、ボス。" : bias <= -2 ? "やや寛容な設定です。見逃しにご注意を。" : "程よくバランスの取れた設定です。";
    setMsg({ tone: "ok", text: `通知しきい値を更新しました。${tail}` });
  };
  const numThreshold = (k: keyof ThresholdSettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) commitThreshold({ [k]: v } as Partial<ThresholdSettings>);
  };
  const resetThreshold = () => {
    const next = resetThresholds();
    setThresholdsState(next);
    setMsg({ tone: "ok", text: "標準値に戻しました。程よく慎重、実に無難です。" });
  };

  const changePerfMode = (m: PerformanceMode) => {
    setPerformanceMode(m);
    setPerfMode(m);
    setMsg({ tone: "ok", text: PERF_PROFILES[m].comment });
  };

  const commitWeights = (w: AdvisorWeights, note?: string) => {
    setAdvisorWeights(w);
    setAdvWeights(w);
    setMsg({ tone: "ok", text: note ?? `Advisor重みを更新しました。${weightComment(w)}` });
  };
  const changeWeight = (k: keyof AdvisorWeights, delta: number) => {
    if (!advWeights) return;
    const next = { ...advWeights, [k]: Math.max(0, Math.min(100, advWeights[k] + delta)) };
    commitWeights(next);
  };
  const setWeightValue = (k: keyof AdvisorWeights, v: string) => {
    if (!advWeights) return;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return;
    commitWeights({ ...advWeights, [k]: Math.max(0, Math.min(100, n)) });
  };
  const applyPresetW = (key: PresetKey) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    commitWeights({ ...p.weights }, `プリセット「${p.label}」を適用しました。${weightComment(p.weights)}`);
  };
  const normalizeW = () => {
    if (!advWeights) return;
    commitWeights(normalizeTo100(advWeights), "重みを合計100へ正規化しました。");
  };
  const resetW = () => {
    const w = resetAdvisorWeights();
    setAdvWeights(w);
    setMsg({ tone: "ok", text: "標準設定へ戻しました。" });
  };

  const toggleWatch = () => {
    if (!watch) return;
    const s = setWatchlistSettings({ enabled: !watch.enabled });
    setWatch(s);
    setMsg({ tone: "ok", text: s.enabled ? "Watchlist自動監視を有効にしました。" : "Watchlist自動監視を無効にしました。" });
  };
  const changeWatchInterval = (m: number) => {
    const s = setWatchlistSettings({ intervalMinutes: m });
    setWatch(s);
  };
  const runWatchNow = async () => {
    setWatchBusy(true);
    setMsg({ tone: "ok", text: "Watchlist を監視中です、ボス…" });
    const found = await runWatchlistCheck(new Date().toISOString());
    setWatch(getWatchlistSettings());
    setDetections(listDetections());
    setWatchBusy(false);
    setMsg({ tone: "ok", text: `監視を実行しました。新規検出 ${found.length} 件。` });
  };
  const clearWatch = () => {
    clearDetections();
    setDetections([]);
    setMsg({ tone: "ok", text: "検出履歴を削除しました。" });
  };
  const patchAi = (patch: Partial<AiConfig>, note?: string) => {
    const next = setAiConfig(patch);
    setAiCfg(next);
    if (note) setMsg({ tone: "ok", text: note });
  };
  const changeAiProvider = (m: AiMode) => {
    const note = AI_MODES.find((x) => x.key === m)?.note ?? "";
    patchAi({ provider: m }, `AI Provider を ${m.toUpperCase()} に設定しました。${note}`);
  };

  const toggleAutoReport = () => {
    const next = setAutoReportSettings({ enabled: !autoReport.enabled });
    setAutoReport({ enabled: next.enabled, frequency: next.frequency });
    setMsg({ tone: "ok", text: next.enabled ? "レポート自動保存を有効にしました。運用推移を無人で蓄積します、ボス。" : "レポート自動保存を無効にしました。" });
  };
  const changeReportFreq = (f: ReportFrequency) => {
    const next = setAutoReportSettings({ frequency: f });
    setAutoReport({ enabled: next.enabled, frequency: next.frequency });
  };

  const toggleAdaptive = () => {
    const next = setAdaptiveScoreSettings({ enabled: !adaptiveEnabled });
    setAdaptiveEnabled(next.enabled);
    setMsg({ tone: "ok", text: `Adaptive Score を ${next.enabled ? "ON" : "OFF"} にしました。` });
  };

  const toggleAi = () => {
    const next = setAICommentSettings({ enabled: !aiEnabled });
    setAiEnabled(next.enabled);
    setMsg({ tone: "ok", text: `AI分析コメントを ${next.enabled ? "ON" : "OFF"} にしました。` });
  };

  const runBulkUpdate = async () => {
    setPriceUpdating(true);
    setMsg({ tone: "ok", text: "価格データ取得中です、ボス…" });
    const r = await updateAllPrices();
    setPriceUpdating(false);
    setLastLog(getLatestUpdateLog());
    setJqStatus(getJQuantsStatus());
    setMsg({
      tone: r.ok ? "ok" : "err",
      text: `${r.message}（成功：${r.successCount}件 / 失敗：${r.failedCount}件）`,
    });
  };

  const saveProvider = () => {
    setProviderMode(mode);
    setJQuantsCredentials({ email, password });
    setMsg({
      tone: "ok",
      text: `価格プロバイダ設定を保存しました（モード: ${mode === "jquants-ready" ? "J-Quants準備" : "手入力"}）。`,
    });
  };

  const toggleTv = () => {
    const next = !tvEnabled;
    setTradingViewEnabled(next);
    setTvEnabled(next);
    setMsg({ tone: "ok", text: `TradingView 表示を ${next ? "ON" : "OFF"} にしました。` });
  };

  const onExport = () => {
    try {
      const iso = exportAll();
      setLastBackup(formatBackupTime(iso));
      setMsg({ tone: "ok", text: "エクスポートしました。JSON をダウンロードしました。" });
    } catch (e) {
      setMsg({ tone: "err", text: `エクスポート失敗: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const onPickImport = () => fileRef.current?.click();

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを連続選択できるようリセット
    if (!file) return;
    if (!confirm("現在の全データ（銘柄・保有株・日誌）を上書きします。よろしいですか？")) return;
    try {
      const r = await importAll(file);
      setMsg({
        tone: "ok",
        text: `インポート完了: 銘柄 ${r.stocks} / 保有株 ${r.holdings} / 日誌 ${r.journal} 件を読み込みました。`,
      });
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setMsg({ tone: "err", text: `インポート失敗: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const onClearAll = () => {
    if (!confirm("全データを削除します。この操作は取り消せません。よろしいですか？")) return;
    if (!confirm("本当に削除しますか？（銘柄・保有株・日誌がすべて消えます）")) return;
    Object.values(STORAGE_KEYS).forEach((k) => window.localStorage.removeItem(k));
    setMsg({ tone: "ok", text: "全データを削除しました。" });
    setTimeout(() => window.location.reload(), 800);
  };

  const onSeed = async () => {
    if (!confirm("サンプルデータを投入します。既存データに追加されます。よろしいですか？")) return;
    try {
      const now = new Date().toISOString();
      const mk = (
        code: string,
        name: string,
        over: Partial<StockInput>
      ): StockInput => ({
        code,
        name,
        market: "東証プライム",
        theme: null,
        per: 15,
        pbr: 1.2,
        roe: 10,
        sales_growth: 5,
        operating_margin: 8,
        rsi: 55,
        macd: "上昇中" as MacdState,
        current_price: 1000,
        stop_loss: 900,
        take_profit: 1300,
        rank: "B" as StockRank,
        status: "買い候補" as StockStatus,
        memo: "サンプルデータ",
        price_updated_at: now,
        ...over,
      });

      const toyota = await stockRepo.create(
        mk("7203", "トヨタ自動車", {
          theme: "EV / 自動車",
          current_price: 3200,
          stop_loss: 2900,
          take_profit: 3800,
          rsi: 58,
          rank: "A",
          status: "保有中",
        })
      );
      const sony = await stockRepo.create(
        mk("6758", "ソニーグループ", {
          theme: "エンタメ / 半導体",
          current_price: 13500,
          stop_loss: 12000,
          rsi: 82, // RSI>=80 → caution（過熱）
          rank: "S",
          status: "買い候補",
        })
      );
      const sbg = await stockRepo.create(
        mk("9984", "ソフトバンクグループ", {
          theme: "投資 / AI",
          current_price: 9100,
          stop_loss: 9000, // 現在価格が損切り接近 → danger
          rsi: 47,
          rank: "B",
          status: "保有中",
        })
      );

      await holdingRepo.create({
        stock_id: toyota.id,
        buy_price: 2600,
        shares: 100,
        stop_loss: null,
        take_profit: null,
      });
      await holdingRepo.create({
        stock_id: sbg.id,
        buy_price: 10000, // 損益率マイナス → danger 例
        shares: 50,
        stop_loss: null,
        take_profit: null,
      });

      await journalRepo.create({
        date: now.slice(0, 10),
        marketMemo: "日経は高値圏で推移。半導体関連が牽引。",
        tradeMemo: "6758 を打診買い検討。",
        boughtStocks: "—",
        soldStocks: "—",
        buyReason: "決算good・チャート上昇トレンド。",
        sellReason: null,
        emotion: "やや強気。過熱に注意。",
        reflection: "RSI 過熱銘柄は分割エントリー徹底。",
        jarvisComment: "ボス、6758 は RSI 82 と過熱圏です。押し目を待つ判断も有効かと。",
      });

      // sony は候補として使用（保有なし）。参照だけ確保。
      void sony;

      setMsg({ tone: "ok", text: "サンプルデータを投入しました。" });
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setMsg({ tone: "err", text: `投入失敗: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="hud-label text-arc">{APP_LABEL}</p>
        <Link href="/help" className="hud-btn text-xs px-3 py-1">使い方ガイド →</Link>
      </div>
      <Disclaimer compact />
      <section className="hud-panel p-4">
        <h2 className="hud-label mb-2">◇ バックアップ状態</h2>
        <p className="font-mono text-arc text-lg">
          最終バックアップ:{" "}
          {lastBackup ?? <span className="text-arcdim">未実施</span>}
        </p>
        <p className="text-arcdim text-xs mt-1">
          データはこのブラウザの localStorage にのみ保存されます。定期的なエクスポートを推奨します。
        </p>
      </section>

      {msg && (
        <div
          className={`hud-panel p-3 text-sm font-mono ${
            msg.tone === "ok" ? "text-profit border-profit/40" : "text-danger border-danger/40"
          }`}
        >
          {msg.text}
        </div>
      )}

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">◇ 表示設定</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-arc">TradingView チャート表示</p>
            <p className="text-arcdim text-xs mt-1">
              各画面に日足・出来高・RSI・MACD のチャートを埋め込みます。
            </p>
          </div>
          <button
            className={`hud-btn ${tvEnabled ? "" : "opacity-60"}`}
            onClick={toggleTv}
            aria-pressed={tvEnabled}
          >
            {tvEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-line/60">
          <div>
            <p className="font-display text-arc">Adaptive Score</p>
            <p className="text-arcdim text-xs mt-1">
              Factor分析の寄与度で Score を±15点補正します（score.ts は不変・ダッシュボードに差分表示）。
            </p>
          </div>
          <button
            className={`hud-btn ${adaptiveEnabled ? "" : "opacity-60"}`}
            onClick={toggleAdaptive}
            aria-pressed={adaptiveEnabled}
          >
            {adaptiveEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-line/60">
          <div>
            <p className="font-display text-arc">レポート自動保存</p>
            <p className="text-arcdim text-xs mt-1">
              アプリ起動中に指定頻度でレポートスナップショットを自動保存します（同一期間は1回）。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select className="hud-input w-24" value={autoReport.frequency} onChange={(e) => changeReportFreq(e.target.value as ReportFrequency)}>
              <option value="daily">日次</option>
              <option value="weekly">週次</option>
              <option value="monthly">月次</option>
            </select>
            <button className={`hud-btn ${autoReport.enabled ? "" : "opacity-60"}`} onClick={toggleAutoReport} aria-pressed={autoReport.enabled}>
              {autoReport.enabled ? "ON" : "OFF"}
            </button>
          </div>
        </div>
      </section>

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">◇ 価格プロバイダ（J-Quants）</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="hud-label">Providerモード</span>
            <select
              className="hud-input mt-1"
              value={mode}
              onChange={(e) => setMode(e.target.value as PriceProviderMode)}
            >
              <option value="manual">手入力</option>
              <option value="jquants-ready">J-Quants準備モード</option>
            </select>
          </label>
          <div className="hidden md:block" />
          <label className="block">
            <span className="hud-label">メールアドレス</span>
            <input
              className="hud-input mt-1"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="block">
            <span className="hud-label">パスワード</span>
            <input
              className="hud-input mt-1"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        <p className="text-danger text-xs mt-2">
          ⚠ 注意: パスワードは localStorage に平文保存されます。本番運用では保存非推奨です。
          個人ローカルMVPとしてのみご利用ください。
        </p>
        <p className="text-arcdim text-xs mt-1">
          ※ env（JQUANTS_EMAIL / JQUANTS_PASSWORD）が設定されている場合はサーバ側で env が優先されます。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="hud-btn" onClick={saveProvider}>プロバイダ設定を保存</button>
          <button className="hud-btn" onClick={testConnection} disabled={testing}>
            {testing ? "接続テスト中…" : "接続テスト"}
          </button>
        </div>
        <div className="mt-3 text-sm font-mono">
          <p>
            <span className="hud-label">J-Quants</span>：{" "}
            <span
              className={
                jqStatus?.status === "connected"
                  ? "text-profit"
                  : jqStatus?.status === "error"
                    ? "text-danger"
                    : "text-arcdim"
              }
            >
              {statusLabel(jqStatus)}
            </span>
          </p>
          {jqStatus && (
            <>
              <p className="text-arcdim text-xs mt-1">最終接続日時: {formatBackupTime(jqStatus.at) ?? "—"}</p>
              {jqStatus.message && (
                <p className="text-arcdim text-xs mt-0.5">結果: {jqStatus.message}</p>
              )}
            </>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-line/60">
          <button className="hud-btn" onClick={runBulkUpdate} disabled={priceUpdating}>
            {priceUpdating ? "更新中…" : "全銘柄価格更新"}
          </button>
          <p className="text-arcdim text-xs mt-2">
            登録銘柄の current_price / rsi を J-Quants から一括取得して反映します。
          </p>
          {lastLog && (
            <div className="mt-2 text-sm font-mono">
              <p className="text-arc">更新完了</p>
              <p>成功：{lastLog.successCount}件</p>
              <p>失敗：{lastLog.failedCount}件</p>
              <p className="text-arcdim text-xs">最終更新：{formatBackupTime(lastLog.date) ?? "—"}</p>
            </div>
          )}
        </div>
      </section>

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">◇ 自動価格更新</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-arc">自動価格更新</p>
            <p className="text-arcdim text-xs mt-1">
              アプリを開いている間、一定間隔で J-Quants から価格・RSI を自動更新します。
            </p>
          </div>
          <button
            className={`hud-btn ${auto.enabled ? "" : "opacity-60"}`}
            onClick={toggleAuto}
            aria-pressed={auto.enabled}
          >
            {auto.enabled ? "ON" : "OFF"}
          </button>
        </div>
        <label className="block mt-4 max-w-xs">
          <span className="hud-label">更新間隔</span>
          <select
            className="hud-input mt-1"
            value={auto.intervalMinutes}
            onChange={(e) => changeInterval(Number(e.target.value))}
          >
            {INTERVAL_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}分</option>
            ))}
          </select>
        </label>
        <p className="text-arcdim text-xs mt-2">
          最終自動更新：{formatBackupTime(auto.lastAutoUpdateAt) ?? "未実施"}
        </p>
        <p className="text-arcdim text-xs mt-1">
          ※ 手入力モード / J-Quants 未設定時は自動更新を実行しません。タブを閉じると停止します。
        </p>
      </section>

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">◇ AI分析コメント</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-arc">LLM コメント生成</p>
            <p className="text-arcdim text-xs mt-1">
              Score・指標・アラートを LLM に渡し、自然な分析コメントを生成します（失敗時はローカル分析に fallback）。
            </p>
          </div>
          <button
            className={`hud-btn ${aiEnabled ? "" : "opacity-60"}`}
            onClick={toggleAi}
            aria-pressed={aiEnabled}
          >
            {aiEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-sm font-mono mt-3">
          <span className="hud-label">Provider</span>：{" "}
          <span className={aiProvider === "none" ? "text-arcdim" : "text-profit"}>
            {aiProvider === "anthropic" ? "Anthropic" : aiProvider === "openai" ? "OpenAI" : "未設定"}
          </span>
        </p>
        {aiProvider === "none" && (
          <p className="text-danger text-xs mt-1">
            ⚠ APIキーが未設定です。サーバの env に <span className="text-arc">ANTHROPIC_API_KEY</span> または{" "}
            <span className="text-arc">OPENAI_API_KEY</span> を設定してください（キーは localStorage に保存されません）。
          </p>
        )}
        <p className="text-arcdim text-xs mt-1">
          ※ APIキーはサーバ env のみで管理され、ブラウザには保存・送信されません。
        </p>
      </section>

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">◇ 通知（ブラウザ）</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-arc">ブラウザ通知</p>
            <p className="text-arcdim text-xs mt-1">
              レポート保存・規律違反・出来高過熱・重大リスクを通知します。許可状態:{" "}
              <span className={notifPerm === "granted" ? "text-profit" : notifPerm === "denied" ? "text-danger" : "text-arcdim"}>
                {notifPerm === "granted" ? "許可" : notifPerm === "denied" ? "拒否" : notifPerm === "unsupported" ? "未対応" : "未設定"}
              </span>
            </p>
          </div>
          <button className={`hud-btn ${notif.enabled ? "" : "opacity-60"}`} onClick={toggleNotif} aria-pressed={notif.enabled}>
            {notif.enabled ? "ON" : "OFF"}
          </button>
        </div>
        {notif.enabled && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            {([
              ["report", "レポート保存"],
              ["discipline", "規律違反"],
              ["volume", "出来高アラート"],
              ["risk", "リスク警告"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                className={`hud-btn text-xs px-2 py-1 ${notif[k] ? "" : "opacity-50"}`}
                onClick={() => toggleNotifCat(k)}
              >
                {label} {notif[k] ? "ON" : "OFF"}
              </button>
            ))}
          </div>
        )}
        <label className="block mt-4 max-w-xs">
          <span className="hud-label">通知履歴の保持期間</span>
          <select className="hud-input mt-1" value={retention} onChange={(e) => changeRetention(e.target.value as RetentionPolicy)}>
            <option value="7">7日</option>
            <option value="30">30日</option>
            <option value="90">90日</option>
            <option value="none">無期限</option>
          </select>
        </label>
        {notifPerm === "denied" && (
          <p className="text-danger text-xs mt-2">ブラウザ通知が拒否されています。ブラウザ設定から許可してください。</p>
        )}
        {notifPerm === "unsupported" && <p className="text-arcdim text-xs mt-2">このブラウザは通知に未対応です。</p>}
      </section>

      {thresholds && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="hud-label"><HelpTooltip termKey="notificationthreshold" label="◇ 通知しきい値" /></h2>
            <button className="hud-btn text-xs px-3 py-1" onClick={resetThreshold}>JARVIS標準値に戻す</button>
          </div>
          <p className="text-xs text-arcdim mb-4">通知・警告の発火条件を調整します。厳しくすると見逃しにくく、緩めると通知過多を防げます。</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <label className="block">
              <span className="hud-label"><HelpTooltip label="Risk Grade Danger" text="この Grade 以下で危険通知を出します（例: D なら Grade D のときのみ）。" /></span>
              <select className="hud-input mt-1" value={thresholds.riskGradeDanger} onChange={(e) => commitThreshold({ riskGradeDanger: e.target.value as RiskGradeThreshold })}>
                {(["C", "D"] as RiskGradeThreshold[]).map((g) => <option key={g} value={g}>Grade {g} 以下</option>)}
              </select>
            </label>
            <label className="block">
              <span className="hud-label"><HelpTooltip label="破産確率 Danger (%)" text="モンテカルロの破産確率がこの値以上で危険通知を出します。" /></span>
              <input className="hud-input mt-1" type="number" step="0.5" defaultValue={thresholds.ruinProbabilityDanger} onBlur={numThreshold("ruinProbabilityDanger")} />
            </label>
            <label className="block">
              <span className="hud-label"><HelpTooltip label="資産半減確率 Danger (%)" text="資産が半減する確率がこの値以上で危険通知を出します。" /></span>
              <input className="hud-input mt-1" type="number" step="0.5" defaultValue={thresholds.halfCapitalProbabilityDanger} onBlur={numThreshold("halfCapitalProbabilityDanger")} />
            </label>
            <label className="block">
              <span className="hud-label"><HelpTooltip label="最大DD Warning (%)" text="最大ドローダウン(95%ile)がこの値以上で警告扱いにします。" /></span>
              <input className="hud-input mt-1" type="number" step="1" defaultValue={thresholds.drawdownWarning} onBlur={numThreshold("drawdownWarning")} />
            </label>
            <label className="block">
              <span className="hud-label"><HelpTooltip label="規律スコア Warning" text="規律スコアがこの値未満で警告扱いにします（高いほど厳しい）。" /></span>
              <input className="hud-input mt-1" type="number" step="1" defaultValue={thresholds.disciplineScoreWarning} onBlur={numThreshold("disciplineScoreWarning")} />
            </label>
            <label className="block">
              <span className="hud-label"><HelpTooltip label="相対出来高 Warning (倍)" text="20日平均の何倍で注意通知を出すか。" /></span>
              <input className="hud-input mt-1" type="number" step="0.1" defaultValue={thresholds.relativeVolumeWarning} onBlur={numThreshold("relativeVolumeWarning")} />
            </label>
            <label className="block">
              <span className="hud-label"><HelpTooltip label="相対出来高 Danger (倍)" text="20日平均の何倍なら危険通知を出すか。" /></span>
              <input className="hud-input mt-1" type="number" step="0.1" defaultValue={thresholds.relativeVolumeDanger} onBlur={numThreshold("relativeVolumeDanger")} />
            </label>
            <label className="block">
              <span className="hud-label"><HelpTooltip label="RSI 過熱" text="この値以上なら買われすぎ（過熱）として扱います。" /></span>
              <input className="hud-input mt-1" type="number" step="1" defaultValue={thresholds.rsiOverheat} onBlur={numThreshold("rsiOverheat")} />
            </label>
            <label className="block">
              <span className="hud-label"><HelpTooltip label="1銘柄比率 Warning (%)" text="1銘柄がポートフォリオのこの比率以上で警告表示します。" /></span>
              <input className="hud-input mt-1" type="number" step="1" defaultValue={thresholds.oneStockWeightWarning} onBlur={numThreshold("oneStockWeightWarning")} />
            </label>
            <label className="block">
              <span className="hud-label"><HelpTooltip label="セクター比率 Warning (%)" text="1セクター/テーマがこの比率以上で警告表示します。" /></span>
              <input className="hud-input mt-1" type="number" step="1" defaultValue={thresholds.sectorWeightWarning} onBlur={numThreshold("sectorWeightWarning")} />
            </label>
          </div>
          <p className="text-xs text-arcdim mt-3">※ 数値は入力後フォーカスを外すと反映されます。alerts.ts / score.ts の内部ロジックには影響しません。</p>
        </section>
      )}

      <section className="hud-panel p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="hud-label">◇ パフォーマンス（Performance）</h2>
          <span className="hud-label">
            推定計算負荷:{" "}
            <span className={PERF_PROFILES[perfMode].load === "high" ? "text-danger" : PERF_PROFILES[perfMode].load === "medium" ? "text-caution" : "text-profit"}>
              {PERF_PROFILES[perfMode].loadLabel}
            </span>
          </span>
        </div>
        <p className="text-xs text-arcdim mb-3">
          モンテカルロ等の計算負荷を調整します。速度重視なら Fast、精度重視なら Research。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(Object.keys(PERF_PROFILES) as PerformanceMode[]).map((m) => {
            const p = PERF_PROFILES[m];
            const active = perfMode === m;
            return (
              <button
                key={m}
                onClick={() => changePerfMode(m)}
                className={`text-left rounded border p-3 transition-colors ${active ? "border-arc/60 bg-arc/10 shadow-arc" : "border-line hover:border-arc/40"}`}
              >
                <p className={`font-display tracking-wider ${active ? "text-arc" : "text-arcdim"}`}>{p.label}</p>
                <p className="text-xs font-mono text-arcdim mt-1">MC {p.dashboardRuns}/{p.analysisRuns}回 ・ 負荷 {p.loadLabel}</p>
              </button>
            );
          })}
        </div>
        <p className="text-sm font-mono text-arc mt-3">・{PERF_PROFILES[perfMode].comment}</p>
        <p className="text-xs text-arcdim mt-1">MC回数は「Dashboard埋め込み / 分析ページ」の順。反映は各画面の次回計算時から。</p>
      </section>

      {advWeights && (() => {
        const sum = sumWeights(advWeights);
        const pct = appliedPercents(advWeights);
        return (
          <section className="hud-panel p-4">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h2 className="hud-label">🛰 Advisor Settings（判定重み）</h2>
              <div className="flex gap-2">
                <button className="hud-btn text-xs px-3 py-1" onClick={normalizeW}>100に正規化</button>
                <button className="hud-btn text-xs px-3 py-1" onClick={resetW}>標準に戻す</button>
              </div>
            </div>
            <p className="text-xs text-arcdim mb-3">
              各指標の重みを調整すると Advisor の判定が変わります。重みは合計100に正規化して適用されます（現在の合計: <span className={sum === 100 ? "text-profit" : "text-caution"}>{sum}</span>）。
            </p>

            <p className="hud-label mb-1">プリセット</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {PRESETS.map((p) => (
                <button key={p.key} className="hud-btn text-xs px-3 py-1" onClick={() => applyPresetW(p.key)}>{p.label}</button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {WEIGHT_KEYS.map((k) => (
                <div key={k} className="rounded border border-line/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="hud-label"><HelpTooltip label={WEIGHT_META[k].label} text={WEIGHT_META[k].help} /></span>
                    <span className="text-arcdim text-xs font-mono">適用 {pct[k]}%</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button className="hud-btn px-2 py-0.5" onClick={() => changeWeight(k, -5)}>−</button>
                    <input
                      className="hud-input w-20 text-center"
                      type="number"
                      min="0"
                      max="100"
                      value={advWeights[k]}
                      onChange={(e) => setWeightValue(k, e.target.value)}
                    />
                    <button className="hud-btn px-2 py-0.5" onClick={() => changeWeight(k, 5)}>＋</button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-sm font-mono text-arc mt-3">・{weightComment(advWeights)}</p>
            <p className="text-xs text-arcdim mt-1">※ Advisor は判断補助であり投資助言ではありません。</p>
          </section>
        );
      })()}

      {aiCfg && (
        <section className="hud-panel p-4">
          <h2 className="hud-label"><HelpTooltip termKey="aicomment" label="🧠 External Intelligence（AIコメント）" /></h2>
          <p className="text-xs text-arcdim mt-1 mb-3">初期値 OFF。Template はローカル生成（外部送信なし）。外部プロバイダは APIキー/エンドポイント未設定時 Template へ自動フォールバック。ニュース/RSS/外部情報は利用しません。判断補助であり投資助言ではありません。</p>

          <p className="hud-label mb-1">AI Provider</p>
          <div className="flex flex-wrap gap-2">
            {AI_MODES.map((m) => (
              <button key={m.key} onClick={() => changeAiProvider(m.key)} className={`px-3 py-1.5 rounded border text-sm ${aiCfg.provider === m.key ? "border-arc/60 text-arc bg-arc/10" : "border-line text-arcdim hover:text-arc"}`}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-arcdim mt-1">{AI_MODES.find((m) => m.key === aiCfg.provider)?.note}</p>

          {(aiCfg.provider === "openai" || aiCfg.provider === "claude" || aiCfg.provider === "gemini" || aiCfg.provider === "local") && (
            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="hud-label">API Key（ローカル保存・ユーザー管理）</span>
                <input className="hud-input mt-1" type="password" value={aiCfg.apiKey} onChange={(e) => patchAi({ apiKey: e.target.value })} placeholder="sk-... / 未設定なら Template" />
              </label>
              {aiCfg.provider === "local" && (
                <label className="block">
                  <span className="hud-label">Local LLM エンドポイント（OpenAI互換）</span>
                  <input className="hud-input mt-1" value={aiCfg.endpoint} onChange={(e) => patchAi({ endpoint: e.target.value })} placeholder="http://localhost:1234/v1/chat/completions" />
                </label>
              )}
              <p className="text-xs sm:col-span-2 mt-1">
                状態: <span className={providerReady(aiCfg) ? "text-profit" : "text-caution"}>{providerReady(aiCfg) ? "接続可（設定済み）" : "未設定 → Template フォールバック"}</span>
              </p>
            </div>
          )}

          <div className="mt-3 grid sm:grid-cols-4 gap-3">
            <label className="block">
              <span className="hud-label">Comment Style</span>
              <select className="hud-input mt-1" value={aiCfg.style} onChange={(e) => patchAi({ style: e.target.value as CommentStyle })}>
                {COMMENT_STYLES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="hud-label">Comment 詳細度</span>
              <select className="hud-input mt-1" value={aiCfg.detail} onChange={(e) => patchAi({ detail: e.target.value as CommentDetail })}>
                {COMMENT_DETAILS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="hud-label">Temperature</span>
              <select className="hud-input mt-1" value={aiCfg.temperature} onChange={(e) => patchAi({ temperature: Number(e.target.value) })}>
                {TEMPERATURES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="hud-label">Max Tokens</span>
              <select className="hud-input mt-1" value={aiCfg.maxTokens} onChange={(e) => patchAi({ maxTokens: Number(e.target.value) })}>
                {MAX_TOKENS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-arcdim mt-2">※ APIキーは端末内(localStorage)にのみ保存。売買データを外部へ送信しません（送信するのは選択プロバイダへの要約テキストのみ）。</p>
        </section>
      )}

      {watch && (
        <section className="hud-panel p-4">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h2 className="hud-label"><HelpTooltip termKey="watchlist" label="👁 Watchlist 自動監視" /></h2>
            <div className="flex gap-2">
              <button className="hud-btn text-xs px-3 py-1" onClick={runWatchNow} disabled={watchBusy}>{watchBusy ? "監視中…" : "今すぐ監視"}</button>
              {detections.length > 0 && <button className="hud-btn-danger text-xs px-3 py-1" onClick={clearWatch}>履歴削除</button>}
            </div>
          </div>
          <p className="text-xs text-arcdim mb-3">登録銘柄を定期チェックし、Score急上昇・RSI過熱/押し目・出来高急増・Advisor判定変化（Strong Buy化/Danger化等）・Risk悪化を検出します。外部API・LINE・ニュース監視は行いません。</p>
          <div className="flex flex-wrap items-center gap-3">
            <button className={`hud-btn ${watch.enabled ? "" : "opacity-60"}`} onClick={toggleWatch}>{watch.enabled ? "監視 ON" : "監視 OFF"}</button>
            <label className="flex items-center gap-1">
              <span className="hud-label">監視間隔</span>
              <select className="hud-input w-28" value={watch.intervalMinutes} onChange={(e) => changeWatchInterval(Number(e.target.value))}>
                {[15, 30, 60, 120].map((m) => <option key={m} value={m}>{m}分</option>)}
              </select>
            </label>
            <span className="hud-label">最終監視: <span className="text-arc">{watch.lastRunAt ? formatBackupTime(watch.lastRunAt) : "未実施"}</span></span>
          </div>
          <div className="mt-3">
            <p className="hud-label mb-1">検出履歴（{detections.length}）</p>
            {detections.length === 0 ? (
              <p className="text-arcdim text-sm">検出はまだありません。</p>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {detections.slice(0, 20).map((d) => (
                  <li key={d.id} className={`text-xs font-mono px-2 py-1 rounded border ${d.level === "danger" ? "border-danger/50 text-danger" : d.level === "warning" ? "border-caution/50 text-caution" : "border-line/60 text-arc"}`}>
                    <span className="text-arcdim">{formatBackupTime(d.at)}</span> {d.name}: {d.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-arcdim mt-2">※ 検出は通知履歴にも保存されます（ブラウザ通知は許可時のみ）。判断補助であり投資助言ではありません。</p>
          <div className="mt-3">
            <AiComment
              ctx={{
                title: "Watchlist",
                facts: [
                  `検出件数 ${detections.length}件`,
                  ...detections.slice(0, 4).map((d) => `${d.name}: ${d.message}`),
                ],
              }}
            />
          </div>
        </section>
      )}

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">◇ データ入出力</h2>
        <div className="flex flex-wrap gap-3">
          <button className="hud-btn" onClick={onExport}>エクスポート（JSON保存）</button>
          <button className="hud-btn" onClick={onPickImport}>インポート（JSON読込）</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImport}
          />
        </div>
        <p className="text-arcdim text-xs mt-2">
          エクスポート: 全データを <span className="text-arc">jarvis-trade-log-日時.json</span> として保存。
          インポート: 保存した JSON を読み込み、現在のデータを上書きします。
        </p>
        <div className="mt-3">
          <Link href="/backup" className="hud-btn text-xs px-3 py-1">🛟 バックアップ/復元（世代管理・部分復元）→</Link>
          <p className="text-arcdim text-xs mt-2">より高度な世代管理・破損チェック・部分復元は専用画面で行えます。</p>
        </div>
      </section>

      <section className="hud-panel p-4">
        <h2 className="hud-label mb-4">◇ メンテナンス</h2>
        <div className="flex flex-wrap gap-3">
          <button className="hud-btn" onClick={onSeed}>サンプルデータ投入</button>
          <button className="hud-btn-danger px-4 py-1.5 text-sm" onClick={onClearAll}>全データ削除</button>
        </div>
        <p className="text-arcdim text-xs mt-2">
          全データ削除は取り消せません。実行前にエクスポートでのバックアップを推奨します。
        </p>
      </section>
    </div>
  );
}
