/**
 * スクリーナー: バッチ取得オーケストレーター（Stage 4a）。
 *
 * - universe: /equities/master を 1 回取得。
 * - bars: 直近の営業日候補を **1 日ずつ**（日付一括＝全銘柄）取得し、調整後系列に集約。
 * - **価格更新・財務更新と同じ共有レートリミッタ（5req/分）** で直列化（第2実装なし）。
 * - 進捗コールバック＋AbortController 対応。
 *
 * 中断/失敗ポリシー: 本層は透明性のため**部分結果＋ stopped 理由**を返す。
 * 確定・永続化（Stage 4b）は **stopped≠null のとき破棄**し、既存 snapshot を
 * 不完全データで上書きしない（＝実質「中断時は破棄」）。
 */
import { fetchJQuantsMaster, fetchJQuantsBarsByDate } from "@/lib/pricing/jquantsClient";
import { getJQuantsRateLimiter, type RateLimiter } from "@/lib/pricing/rateLimiter";
import type { JQuantsCredentials, FetchQuotesOptions, BulkStop } from "@/lib/pricing/provider";
import type { V2DailyBar } from "@/lib/pricing/jquantsV2";
import { buildUniverse, assembleAdjSeries, type UniverseEntry, type AdjBar } from "./universe";

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/**
 * anchor（YYYY-MM-DD・含む）から過去へ、土日を除いた営業日候補を count 件返す（新しい順）。
 * 祝日はクライアントで判別不能 → 取得時に空データ（200）で返るため許容する。
 */
export function recentWeekdays(anchorYmd: string, count: number): string[] {
  const out: string[] = [];
  let ms = Date.parse(anchorYmd);
  if (!Number.isFinite(ms) || count <= 0) return out;
  const DAY = 24 * 60 * 60 * 1000;
  let guard = 0;
  while (out.length < count && guard < count * 3 + 14) {
    const d = new Date(ms);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    ms -= DAY;
    guard++;
  }
  return out;
}

export interface UniverseFetchResult {
  universe: UniverseEntry[];
  stopped: BulkStop | null;
  error?: string;
}

export interface UniverseFetchOptions {
  limiter?: RateLimiter;
  signal?: AbortSignal;
}

/** 上場マスタを取得しユニバースを構築する（1 リクエスト・共有リミッタ経由）。 */
export async function fetchUniverse(
  date: string | undefined,
  credentials: JQuantsCredentials | null,
  opts?: UniverseFetchOptions
): Promise<UniverseFetchResult> {
  const limiter = opts?.limiter ?? getJQuantsRateLimiter();
  try {
    await limiter.acquire(opts?.signal);
  } catch (e) {
    if (isAbort(e)) return { universe: [], stopped: "aborted" };
    throw e;
  }
  const res = await fetchJQuantsMaster(date, credentials);
  if (!res.ok) {
    const stopped: BulkStop | null = res.reason === "auth" ? "auth" : res.reason === "rate" ? "rate" : null;
    return { universe: [], stopped, error: res.message };
  }
  return { universe: buildUniverse(res.master ?? []), stopped: null };
}

/** 中断可能な待機（自動リトライ用）。 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error("Aborted");
      e.name = "AbortError";
      return reject(e);
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        const e = new Error("Aborted");
        e.name = "AbortError";
        reject(e);
      },
      { once: true }
    );
  });
}

export interface BarsBatchOptions extends FetchQuotesOptions {
  limiter?: RateLimiter;
  /** 初回1発目の rate に対する自動待機（テスト用に注入可）。 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 初回 rate リトライ前の待機（既定 60 秒）。 */
  retryWaitMs?: number;
}

export interface BarsBatchResult {
  seriesByCode: Map<string, AdjBar[]>;
  requestedDates: number;
  fetchedDates: number; // 200 で返った日数
  emptyDates: number; // データ空（休場/祝日等）の日数
  totalPages: number; // pagination 実ページ総数（所要見積り用）
  stopped: BulkStop | null;
  /** 初回1発目 rate の自動待機リトライを実施したか（診断用）。 */
  retried: boolean;
  /** 中断した bars リクエスト番号（1始まり・診断用）。 */
  stoppedAt?: number;
}

/**
 * 日付候補を 1 日ずつ（全銘柄）取得し、調整後系列に集約する。
 * 共有リミッタで直列化。auth/rate/abort で中断（部分結果を返す）。
 */
export async function fetchBarsBatch(
  dates: string[],
  credentials: JQuantsCredentials | null,
  opts?: BarsBatchOptions
): Promise<BarsBatchResult> {
  const limiter = opts?.limiter ?? getJQuantsRateLimiter();
  const sleep = opts?.sleep ?? abortableSleep;
  const retryWaitMs = opts?.retryWaitMs ?? 60_000;
  const allBars: V2DailyBar[] = [];
  let fetched = 0;
  let empty = 0;
  let totalPages = 0;
  let done = 0;
  let retried = false;

  const finalize = (stopped: BulkStop | null): BarsBatchResult => ({
    seriesByCode: assembleAdjSeries(allBars),
    requestedDates: dates.length,
    fetchedDates: fetched,
    emptyDates: empty,
    totalPages,
    stopped,
    retried,
    stoppedAt: stopped ? done + 1 : undefined,
  });

  for (const date of dates) {
    if (opts?.signal?.aborted) return finalize("aborted");
    try {
      await limiter.acquire(opts?.signal);
    } catch (e) {
      if (isAbort(e)) return finalize("aborted");
      throw e;
    }

    let res = await fetchJQuantsBarsByDate(date, credentials);

    // 初回1発目の rate のみ自動待機して1回だけリトライ（bars 途中の rate は破棄）。
    if (!res.ok && res.reason === "rate" && fetched === 0) {
      retried = true;
      try {
        await sleep(retryWaitMs, opts?.signal);
      } catch (e) {
        if (isAbort(e)) return finalize("aborted");
        throw e;
      }
      res = await fetchJQuantsBarsByDate(date, credentials);
    }

    if (!res.ok) {
      if (res.reason === "auth") return finalize("auth");
      if (res.reason === "rate") return finalize("rate");
      // その他失敗はスキップ（部分成功）
    } else {
      const bars = res.bars ?? [];
      if (bars.length) allBars.push(...bars);
      else empty++;
      fetched++;
      totalPages += res.pages ?? 1;
    }
    done++;
    opts?.onProgress?.({ done, total: dates.length, code: date });
  }

  return finalize(null);
}
