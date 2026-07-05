/**
 * 財務指標取得層（PriceProvider と同思想）。
 *
 * - JQuantsFundamentalsProvider: /fins/summary を 1 銘柄ずつ取得し、指標を計算して返す。
 *   **価格更新と同じ共有レートリミッタ（5req/分）** を使うため、価格更新と財務更新を
 *   同時に走らせても両者は同一予算で直列化される（第2のリミッタは作らない）。
 * - ManualFundamentalsProvider: 手入力モードの no-op（外部取得しない）。
 *
 * PER/PBR は現在値が必要なため、価格を再取得せず priceByCode（永続化済み current_price）を受け取る。
 */
import { fetchJQuantsFins } from "./jquantsClient";
import { mapFinRecord, computeFundamentals, type Fundamentals } from "./fundamentals";
import { getJQuantsRateLimiter, type RateLimiter } from "./rateLimiter";
import type { JQuantsCredentials, FetchQuotesOptions, BulkStop } from "./provider";

export interface FundamentalsItem {
  code: string;
  fundamentals: Fundamentals;
}

export interface BulkFundamentalsResult {
  items: FundamentalsItem[];
  failedCodes: string[];
  stopped: BulkStop | null;
}

export interface FundamentalsProvider {
  readonly name: string;
  fetchFundamentalsBulk(
    codes: string[],
    priceByCode: Map<string, number | null>,
    opts?: FetchQuotesOptions
  ): Promise<BulkFundamentalsResult>;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/** 手入力モード: 外部財務取得は行わない（no-op）。 */
export class ManualFundamentalsProvider implements FundamentalsProvider {
  readonly name = "manual";
  async fetchFundamentalsBulk(
    codes: string[],
    _priceByCode: Map<string, number | null>,
    opts?: FetchQuotesOptions
  ): Promise<BulkFundamentalsResult> {
    let done = 0;
    for (const code of codes) {
      if (opts?.signal?.aborted) return { items: [], failedCodes: [], stopped: "aborted" };
      done++;
      opts?.onProgress?.({ done, total: codes.length, code });
    }
    return { items: [], failedCodes: [], stopped: null };
  }
}

/** J-Quants（V2）: /fins/summary から財務指標を導出する。 */
export class JQuantsFundamentalsProvider implements FundamentalsProvider {
  readonly name = "jquants";
  constructor(
    private credentials: JQuantsCredentials | null,
    private limiter: RateLimiter = getJQuantsRateLimiter()
  ) {}

  async fetchFundamentalsBulk(
    codes: string[],
    priceByCode: Map<string, number | null>,
    opts?: FetchQuotesOptions
  ): Promise<BulkFundamentalsResult> {
    const items: FundamentalsItem[] = [];
    const failedCodes: string[] = [];
    let done = 0;

    for (const code of codes) {
      if (opts?.signal?.aborted) return { items, failedCodes, stopped: "aborted" };

      // 価格更新と共有のトークンバケット（5req/分）。待機中の abort は中断扱い。
      try {
        await this.limiter.acquire(opts?.signal);
      } catch (e) {
        if (isAbort(e)) return { items, failedCodes, stopped: "aborted" };
        throw e;
      }

      const res = await fetchJQuantsFins(code, this.credentials);

      if (!res.ok) {
        if (res.reason === "auth") return { items, failedCodes, stopped: "auth" };
        if (res.reason === "rate") return { items, failedCodes, stopped: "rate" };
        failedCodes.push(code);
        done++;
        opts?.onProgress?.({ done, total: codes.length, code });
        continue;
      }

      const records = (res.fins ?? []).map(mapFinRecord);
      const fundamentals = computeFundamentals(records, priceByCode.get(code) ?? null);
      items.push({ code, fundamentals });

      done++;
      opts?.onProgress?.({ done, total: codes.length, code });
    }

    return { items, failedCodes, stopped: null };
  }
}

/** モードに応じた FundamentalsProvider を返す。 */
export function getFundamentalsProvider(
  mode: "manual" | "jquants-ready",
  credentials: JQuantsCredentials | null = null
): FundamentalsProvider {
  return mode === "jquants-ready"
    ? new JQuantsFundamentalsProvider(credentials)
    : new ManualFundamentalsProvider();
}
