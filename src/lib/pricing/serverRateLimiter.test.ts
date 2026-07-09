import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RateLimiter } from "./rateLimiter";
import {
  acquireServerToken,
  __resetServerLimiters,
  __setServerLimiterFactory,
  JQUANTS_RATE_CAPACITY,
  JQUANTS_RATE_REFILL_MS,
} from "./serverRateLimiter";

// ※ APIキーはダミー値のみ。
const KEY_A = "dummy-key-A";
const KEY_B = "dummy-key-B";

beforeEach(() => {
  __resetServerLimiters();
});
afterEach(() => {
  __setServerLimiterFactory(null);
  __resetServerLimiters();
});

describe("serverRateLimiter（APIキー単位・プロセス内）", () => {
  it("一元定義: バースト無し・refill=2000ms（≈30req/分）", () => {
    expect(JQUANTS_RATE_CAPACITY).toBe(1);
    expect(JQUANTS_RATE_REFILL_MS).toBe(2_000);
  });

  it("同一キーは同一バケットを再利用（間隔が効く）", async () => {
    const made: RateLimiter[] = [];
    __setServerLimiterFactory(() => {
      const rl: RateLimiter = { acquire: vi.fn().mockResolvedValue(undefined) };
      made.push(rl);
      return rl;
    });
    await acquireServerToken(KEY_A);
    await acquireServerToken(KEY_A);
    await acquireServerToken(KEY_A);
    expect(made).toHaveLength(1); // バケット生成は1回のみ
    expect(made[0].acquire).toHaveBeenCalledTimes(3);
  });

  it("異なるキーは独立したバケット", async () => {
    const made: RateLimiter[] = [];
    __setServerLimiterFactory(() => {
      const rl: RateLimiter = { acquire: vi.fn().mockResolvedValue(undefined) };
      made.push(rl);
      return rl;
    });
    await acquireServerToken(KEY_A);
    await acquireServerToken(KEY_B);
    expect(made).toHaveLength(2); // キーごとに別バケット
  });

  it("__resetServerLimiters でバケットを破棄", async () => {
    const made: RateLimiter[] = [];
    __setServerLimiterFactory(() => {
      const rl: RateLimiter = { acquire: vi.fn().mockResolvedValue(undefined) };
      made.push(rl);
      return rl;
    });
    await acquireServerToken(KEY_A);
    __resetServerLimiters();
    await acquireServerToken(KEY_A);
    expect(made).toHaveLength(2); // リセット後は再生成
  });
});
