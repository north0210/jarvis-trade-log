/**
 * トークンバケット型レートリミッタ（J-Quants 5req/分 対応）。
 *
 * 容量 capacity・refillMs ごとに 1 トークン補充。連続 capacity 件は即時、
 * 以降は refillMs 間隔で通過する。now/sleep を注入可能にし、テストは
 * fake クロックで実待機なしに検証する。
 *
 * acquire(signal) は AbortSignal で中断可能（待機中に abort されると AbortError）。
 */
// レート枠は serverRateLimiter.ts の一元定義（サーバ側＝権威）を参照する。
// serverRateLimiter → rateLimiter（createRateLimiter）の循環になるが、
// 本値の参照は getJQuantsRateLimiter 内（呼び出し時）のみ → module 初期化時に読まず TDZ 安全。
import { JQUANTS_RATE_CAPACITY, JQUANTS_RATE_REFILL_MS } from "./serverRateLimiter";

export interface RateLimiter {
  /** トークンを 1 消費する。無ければ補充まで待機。signal で中断可能。 */
  acquire(signal?: AbortSignal): Promise<void>;
}

export interface RateLimiterOptions {
  /** バケット容量（同時に許容するバースト数）。 */
  capacity: number;
  /** 1 トークン補充する間隔（ミリ秒）。 */
  refillMs: number;
  /** 現在時刻（ミリ秒）。既定は Date.now。テストで注入する。 */
  now?: () => number;
  /** 待機関数。既定は setTimeout（abort 対応）。テストで注入する。 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** AbortError を生成する（環境差異を吸収）。 */
function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

/** 既定の待機（setTimeout・abort 対応）。 */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true }
    );
  });
}

/** トークンバケットを生成する。 */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { capacity, refillMs } = opts;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  let tokens = capacity;
  let lastRefill = now();

  const refill = () => {
    const t = now();
    const elapsed = t - lastRefill;
    if (elapsed <= 0) return;
    const add = Math.floor(elapsed / refillMs);
    if (add > 0) {
      tokens = Math.min(capacity, tokens + add);
      lastRefill += add * refillMs;
    }
  };

  return {
    async acquire(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) throw abortError();
      // トークンが得られるまで補充を待つ。
      // 安全弁: 無限ループ回避（現実的には数回で抜ける）。
      for (let guard = 0; guard < 100_000; guard++) {
        refill();
        if (tokens >= 1) {
          tokens -= 1;
          return;
        }
        const waitMs = Math.max(0, lastRefill + refillMs - now());
        await sleep(waitMs > 0 ? waitMs : refillMs, signal);
      }
      throw new Error("rate limiter: 取得に失敗しました");
    },
  };
}

// ---- J-Quants 共有リミッタ（APIキー単位） ----
//
// バースト排除: capacity=1（初期バーストなし）で、以降は refill 間隔で通過する。
// レート枠は serverRateLimiter.ts の一元定義を参照（先行スロットルとして同一値で間隔取得）。

let shared: RateLimiter | null = null;

/** J-Quants 用の共有リミッタ（bulk/single/auto-update が同一予算を消費）。 */
export function getJQuantsRateLimiter(): RateLimiter {
  if (!shared) shared = createRateLimiter({ capacity: JQUANTS_RATE_CAPACITY, refillMs: JQUANTS_RATE_REFILL_MS });
  return shared;
}

/** テスト用: 共有リミッタを差し替え／初期化する。 */
export function __setJQuantsRateLimiter(limiter: RateLimiter | null): void {
  shared = limiter;
}
