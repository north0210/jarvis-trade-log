/**
 * スクリーナー実行オーケストレーター（Stage 4b）。
 *
 * フロー: アンカー日決定 → universe → 個別株フィルタ → 日付一括バッチ →
 *   技術ランク上位N → 上位のみ fins → フルスコア/grade 再算出 → snapshot 永続化。
 *
 * 破棄/部分許容ポリシー:
 * - probe/universe/bars の中断（auth/rate/aborted）→ **破棄**（不完全系列は指標が不正確）。
 * - fins の **auth/aborted → 破棄**。
 * - fins の **rate/欠損 → 部分許容**（該当銘柄は技術スコアのみで残留・行に財務未取得を記録し、
 *   全体は破棄せず snapshot を保存）。
 * - 破棄時は snapshot を保存しない（既存 snapshot を不完全データで上書きしない）。
 */
import { fetchJQuantsBarsByDate } from "@/lib/pricing/jquantsClient";
import { getFundamentalsProvider } from "@/lib/pricing/fundamentalsProvider";
import { getJQuantsRateLimiter } from "@/lib/pricing/rateLimiter";
import { fetchUniverse, fetchBarsBatch, recentWeekdays } from "./batch";
import { filterCommonStocks } from "./universe";
import { buildScreenerRows, selectTopN, rescoreWithFundamentals, rankRows } from "./technical";
import { saveUniverse, saveScreenerSnapshot, type ScreenerSnapshot } from "./screenerRepository";
import type { JQuantsCredentials, BulkStop } from "@/lib/pricing/provider";

export type ScreenerPhase = "universe" | "bars" | "fins";
/** 診断用の全フェーズ（probe を含む）。 */
type DiagPhase = "probe" | "universe" | "bars" | "fins";

const PHASE_JP: Record<DiagPhase, string> = {
  probe: "最新日検出",
  universe: "上場一覧",
  bars: "価格系列",
  fins: "財務指標",
};

function reasonJp(s: BulkStop | null): string {
  return s === "auth" ? "認証エラー" : s === "rate" ? "レート制限" : s === "aborted" ? "ユーザー中断" : "エラー";
}

/** 中断メッセージ（理由＋フェーズ）。rate は再試行を促す。 */
function stopMessage(phase: DiagPhase, s: BulkStop | null): string {
  const base = `${PHASE_JP[phase]}フェーズで中断しました（理由: ${reasonJp(s)}）。`;
  if (s === "rate") return base + "時間をおいて再試行してください（5リクエスト/分）。";
  if (s === "auth") return base + "設定画面で APIキーを確認してください。";
  return base;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

export interface ScreenerRunOptions {
  onProgress?: (phase: ScreenerPhase, done: number, total: number) => void;
  signal?: AbortSignal;
  /** 取得する営業日数（既定 40）。 */
  weekdays?: number;
  /** 技術上位から fins する社数（既定 50）。 */
  topNFins?: number;
  /** カバレッジ内のアンカー日。省略時は probe で最新取得可能日を自動判定。 */
  anchorDate?: string;
}

export interface ScreenerRunResult {
  ok: boolean;
  stopped: BulkStop | null;
  snapshot: ScreenerSnapshot | null;
  message: string;
  finsCovered: number;
  finsMissing: number;
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

function discard(stopped: BulkStop | null, message: string): ScreenerRunResult {
  return { ok: false, stopped, snapshot: null, message, finsCovered: 0, finsMissing: 0 };
}

export async function runScreener(
  credentials: JQuantsCredentials | null,
  opts?: ScreenerRunOptions
): Promise<ScreenerRunResult> {
  const signal = opts?.signal;
  const weekdays = opts?.weekdays ?? 40;
  const topNFins = opts?.topNFins ?? 50;

  // 0) アンカー日（カバレッジ内の最新営業日）を決定。省略時は probe（route が終端へクランプ）。
  //    probe も共有リミッタ（5req/分）を消費する。
  let anchor = opts?.anchorDate;
  if (!anchor) {
    try {
      await getJQuantsRateLimiter().acquire(signal);
    } catch (e) {
      if (isAbort(e)) return discard("aborted", stopMessage("probe", "aborted"));
      throw e;
    }
    const probe = await fetchJQuantsBarsByDate(fmtDate(new Date()), credentials);
    if (!probe.ok) {
      const st: BulkStop | null = probe.reason === "auth" ? "auth" : probe.reason === "rate" ? "rate" : null;
      return discard(st, stopMessage("probe", st) + (probe.message ? `（${probe.message}）` : ""));
    }
    anchor = probe.date ?? fmtDate(new Date());
  }

  // 1) universe → 個別株フィルタ（共有リミッタ経由）
  opts?.onProgress?.("universe", 0, 1);
  const uni = await fetchUniverse(anchor, credentials, { signal });
  if (uni.stopped) return discard(uni.stopped, stopMessage("universe", uni.stopped));
  const common = filterCommonStocks(uni.universe);
  const universeCount = common.length;
  opts?.onProgress?.("universe", 1, 1);

  // 2) 日付一括バッチ（中断は破棄）
  const dates = recentWeekdays(anchor, weekdays);
  const batch = await fetchBarsBatch(dates, credentials, {
    signal,
    onProgress: (p) => opts?.onProgress?.("bars", p.done, p.total),
  });
  if (batch.stopped) return discard(batch.stopped, stopMessage("bars", batch.stopped));

  // 3) 技術ランク → 上位N
  const rows = buildScreenerRows(common, batch.seriesByCode);
  const top = selectTopN(rows, topNFins);
  if (top.length === 0) return discard(null, "対象銘柄がありません。");

  // 4) 上位のみ fins（auth/aborted は破棄・rate/欠損は部分許容）
  const priceByCode = new Map(top.map((r) => [r.code, r.price]));
  const provider = getFundamentalsProvider("jquants-ready", credentials);
  const fund = await provider.fetchFundamentalsBulk(
    top.map((r) => r.code),
    priceByCode,
    { signal, onProgress: (p) => opts?.onProgress?.("fins", p.done, p.total) }
  );
  if (fund.stopped === "auth" || fund.stopped === "aborted") {
    return discard(fund.stopped, stopMessage("fins", fund.stopped));
  }

  // 5) フルスコア再算出（未取得は技術のみで残留・fundamentalsAvailable=false）
  const byCode = new Map(fund.items.map((i) => [i.code, i.fundamentals]));
  const ranked = rankRows(top.map((r) => rescoreWithFundamentals(r, byCode.get(r.code) ?? null)));
  const finsCovered = ranked.filter((r) => r.fundamentalsAvailable).length;
  const finsMissing = ranked.length - finsCovered;

  // 6) snapshot 永続化（ここまで到達＝ stopped は null か "rate"＝部分許容）
  const snapshot: ScreenerSnapshot = {
    generatedAt: new Date().toISOString(),
    universeCount,
    rows: ranked,
  };
  saveUniverse(common);
  saveScreenerSnapshot(snapshot);

  const note = fund.stopped === "rate" ? "（レート制限により一部は財務未取得）" : "";
  return {
    ok: true,
    stopped: fund.stopped, // null または "rate"
    snapshot,
    message: `スクリーニング完了。${universeCount}社中 上位${ranked.length}社（財務取得 ${finsCovered} / 未取得 ${finsMissing}）${note}`,
    finsCovered,
    finsMissing,
  };
}
