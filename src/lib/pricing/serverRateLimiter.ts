/**
 * サーバ側（/api/jquants ルート）の J-Quants レートリミッタ。
 *
 * クライアント側リミッタはブラウザのリロード / HMR / 複数タブでリセット・分散し得るため、
 * **サーバ側（プロセス内）で APIキー単位のトークンバケット**を持ち、実際の J-Quants への
 * 各リクエストをここで直列化する（権威ある枠）。クライアント acquire は先行スロットルとして残す。
 *
 * ⚠ 注意（サーバレス多重インスタンス）: 本バケットは**プロセス内**状態のため、
 *   複数インスタンスにスケールした場合は各インスタンスごとに独立した枠になる。
 *   ローカル/単一インスタンス運用では権威あるが、水平スケール時は超過し得る点に留意。
 */
import { createRateLimiter, type RateLimiter } from "./rateLimiter";

/** サーバ側もバースト無し・4req/分（余裕）で J-Quants 5req/分を厳守する。 */
export const SERVER_LIMITER_CAPACITY = 1;
export const SERVER_LIMITER_REFILL_MS = 15_000;

/** APIキーの非暗号ハッシュ（生キーをマップキーに使わない）。 */
function keyId(apiKey: string): string {
  let h = 0;
  for (let i = 0; i < apiKey.length; i++) h = (h * 31 + apiKey.charCodeAt(i)) | 0;
  return `k${h}`;
}

let makeLimiter: () => RateLimiter = () =>
  createRateLimiter({ capacity: SERVER_LIMITER_CAPACITY, refillMs: SERVER_LIMITER_REFILL_MS });

const buckets = new Map<string, RateLimiter>();

/** APIキー単位のトークンを取得する（無ければ生成）。 */
export function acquireServerToken(apiKey: string, signal?: AbortSignal): Promise<void> {
  const id = keyId(apiKey);
  let rl = buckets.get(id);
  if (!rl) {
    rl = makeLimiter();
    buckets.set(id, rl);
  }
  return rl.acquire(signal);
}

/** テスト用: バケットを全消去する。 */
export function __resetServerLimiters(): void {
  buckets.clear();
}

/** テスト用: リミッタ生成を差し替える（決定論テスト用）。null で既定へ。 */
export function __setServerLimiterFactory(fn: (() => RateLimiter) | null): void {
  makeLimiter =
    fn ?? (() => createRateLimiter({ capacity: SERVER_LIMITER_CAPACITY, refillMs: SERVER_LIMITER_REFILL_MS }));
}
