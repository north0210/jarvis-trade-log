/**
 * 価格取得層（分離設計）
 *
 * 現在は ManualPriceProvider（DBの手入力値をそのまま採用）と
 * JQuantsPriceProvider（V2・APIキー方式）。UI・アラート・集計ロジックは
 * getPriceProvider() 経由のまま無改修で差し替え可能。
 *
 * - fetchQuotes(): 読み取り用。失敗時は手入力値へ安全に fallback（Quote[] を返す）。
 * - fetchQuotesBulk(): 更新用。レート制限（5req/分・トークンバケット）・進捗・中断・
 *   銘柄単位の成否を扱い、部分成功を明示する（priceUpdater が消費）。
 */
import type { Stock } from "@/lib/types";
import type { MacdState } from "@/lib/types";
import { fetchJQuantsQuotes, type JQuantsQuote } from "./jquantsClient";
import { calculateRSI } from "@/lib/indicators/rsi";
import { computeMacdState } from "@/lib/indicators/macd";
import { computeVolumeMetrics, type VolumeTrend } from "@/lib/indicators/volume";
import { getJQuantsRateLimiter, type RateLimiter } from "./rateLimiter";

/** 1 銘柄の最新クオート（更新に必要な指標を内包）。 */
export interface Quote {
  code: string;
  price: number;
  rsi?: number;
  macd?: MacdState;
  volume?: number;
  relativeVolume?: number;
  volumeTrend?: VolumeTrend;
  asOf: string; // ISO datetime（または取得日）
}

/** 進捗イベント。 */
export interface FetchProgress {
  done: number;
  total: number;
  code: string;
}

/** bulk 取得オプション（進捗・中断）。 */
export interface FetchQuotesOptions {
  onProgress?: (p: FetchProgress) => void;
  signal?: AbortSignal;
}

/** bulk 取得の中断理由（部分成功を明示）。 */
export type BulkStop = "auth" | "rate" | "aborted";

/** bulk 取得の結果。成功分・スキップ分・中断理由を返す。 */
export interface BulkQuotesResult {
  quotes: Quote[];
  failedCodes: string[];
  stopped: BulkStop | null;
}

export interface PriceProvider {
  readonly name: string;
  /** 銘柄コード群の最新クオートを返す（読み取り用・取得不能は省略）。 */
  fetchQuotes(codes: string[]): Promise<Quote[]>;
  /** 更新用: レート制限・進捗・中断・銘柄単位の成否を扱う。 */
  fetchQuotesBulk(codes: string[], opts?: FetchQuotesOptions): Promise<BulkQuotesResult>;
}

/** AbortError 判定。 */
function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/** J-Quants クオート（終値/出来高系列付き）から指標を計算して Quote を組み立てる。 */
function buildQuoteFromJQuants(jq: JQuantsQuote): Quote | null {
  if (jq.current_price == null) return null;
  const rsi = calculateRSI(jq.closes ?? []);
  const macd = computeMacdState(jq.closes ?? []);
  const vm = computeVolumeMetrics(jq.volumes ?? []);
  return {
    code: jq.code,
    price: jq.current_price,
    rsi: rsi ?? undefined,
    macd,
    volume: vm.volume ?? undefined,
    relativeVolume: vm.relativeVolume ?? undefined,
    volumeTrend: vm.volume != null ? vm.volumeTrend : undefined,
    asOf: jq.date ?? new Date().toISOString(),
  };
}

/** Stock の既存値から Quote を組み立てる（手入力フォールバック）。 */
function quoteFromStock(s: Stock): Quote | null {
  if (s.current_price == null) return null;
  return {
    code: s.code,
    price: s.current_price,
    rsi: s.rsi ?? undefined,
    macd: s.macd,
    volume: s.volume,
    relativeVolume: s.relativeVolume,
    volumeTrend: s.volumeTrend,
    asOf: s.price_updated_at ?? new Date().toISOString(),
  };
}

/** 手入力運用: stocks.current_price を信頼し、外部取得は行わない。 */
export class ManualPriceProvider implements PriceProvider {
  readonly name = "manual";
  constructor(private stocks: Stock[]) {}

  async fetchQuotes(codes: string[]): Promise<Quote[]> {
    return this.stocks
      .filter((s) => codes.includes(s.code))
      .map(quoteFromStock)
      .filter((q): q is Quote => q !== null);
  }

  async fetchQuotesBulk(codes: string[], opts?: FetchQuotesOptions): Promise<BulkQuotesResult> {
    const byCode = new Map(this.stocks.map((s) => [s.code, s]));
    const quotes: Quote[] = [];
    const failedCodes: string[] = [];
    let done = 0;
    for (const code of codes) {
      if (opts?.signal?.aborted) return { quotes, failedCodes, stopped: "aborted" };
      const s = byCode.get(code);
      const q = s ? quoteFromStock(s) : null;
      if (q) quotes.push(q);
      else failedCodes.push(code);
      done++;
      opts?.onProgress?.({ done, total: codes.length, code });
    }
    return { quotes, failedCodes, stopped: null };
  }
}

/** 価格取得のモード。UI・設定で切り替える。 */
export type PriceProviderMode = "manual" | "jquants-ready";

/**
 * J-Quants 認証情報。
 * - V2（現行）: `apiKey`（ダッシュボード発行のAPIキー）。x-api-key ヘッダで送出。
 * - V1（@deprecated）: `email` / `password`。2025-12-22 以降の登録者は利用不可。
 * すべて任意。保存は security 扱い（バックアップ除外）。
 */
export interface JQuantsCredentials {
  /** V2 APIキー（現行方式）。 */
  apiKey?: string;
  /** @deprecated V1 のみ。 */
  email?: string;
  /** @deprecated V1 のみ。 */
  password?: string;
}

/**
 * J-Quants 接続用 Provider（V2・APIキー方式）。
 *
 * 通信は必ず Route Handler（/api/jquants）経由で行う（jquantsClient）。
 * 認証は env 優先（JQUANTS_API_KEY・サーバ側）→ localStorage（credentials.apiKey）。直書き禁止。
 *
 * fetchQuotesBulk は 1 銘柄ずつ取得し、共有レートリミッタ（5req/分）で待機、
 * 進捗を発火、AbortSignal で中断可能。取得失敗・認証失敗時は手入力値を維持できるよう
 * 呼び出し側（priceUpdater）が部分成功として扱う。RSI/MACD/出来高は取得系列から自動算出。
 */
export class JQuantsPriceProvider implements PriceProvider {
  readonly name = "jquants";
  constructor(
    private fallback: PriceProvider,
    private credentials: JQuantsCredentials | null,
    private limiter: RateLimiter = getJQuantsRateLimiter()
  ) {}

  async fetchQuotes(codes: string[]): Promise<Quote[]> {
    try {
      const res = await fetchJQuantsQuotes(codes, this.credentials);
      if (!res.ok || !res.quotes) return this.fallback.fetchQuotes(codes);
      return res.quotes
        .map(buildQuoteFromJQuants)
        .filter((q): q is Quote => q !== null);
    } catch {
      return this.fallback.fetchQuotes(codes);
    }
  }

  async fetchQuotesBulk(codes: string[], opts?: FetchQuotesOptions): Promise<BulkQuotesResult> {
    const quotes: Quote[] = [];
    const failedCodes: string[] = [];
    let done = 0;

    for (const code of codes) {
      if (opts?.signal?.aborted) return { quotes, failedCodes, stopped: "aborted" };

      // レート制限（トークンバケット）。待機中の abort は中断として扱う。
      try {
        await this.limiter.acquire(opts?.signal);
      } catch (e) {
        if (isAbort(e)) return { quotes, failedCodes, stopped: "aborted" };
        throw e;
      }

      const res = await fetchJQuantsQuotes([code], this.credentials);

      if (!res.ok) {
        if (res.reason === "auth") return { quotes, failedCodes, stopped: "auth" };
        if (res.reason === "rate") return { quotes, failedCodes, stopped: "rate" };
        failedCodes.push(code); // その他失敗はスキップして継続
        done++;
        opts?.onProgress?.({ done, total: codes.length, code });
        continue;
      }

      const jq = res.quotes?.find((q) => q.code === code);
      const quote = jq ? buildQuoteFromJQuants(jq) : null;
      if (quote) quotes.push(quote);
      else failedCodes.push(code);

      done++;
      opts?.onProgress?.({ done, total: codes.length, code });
    }

    return { quotes, failedCodes, stopped: null };
  }
}

/**
 * 現在のモード・認証情報に応じた PriceProvider を返す。
 * 既定は手入力（ManualPriceProvider）。UI・Score・Alert は本関数経由のまま無改修。
 */
export function getPriceProvider(
  stocks: Stock[],
  mode: PriceProviderMode = "manual",
  credentials: JQuantsCredentials | null = null
): PriceProvider {
  const manual = new ManualPriceProvider(stocks);
  if (mode === "jquants-ready") {
    return new JQuantsPriceProvider(manual, credentials);
  }
  return manual;
}
