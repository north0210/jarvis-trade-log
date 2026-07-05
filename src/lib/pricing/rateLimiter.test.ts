import { describe, it, expect } from "vitest";
import { createRateLimiter, JQUANTS_LIMITER_CAPACITY, JQUANTS_LIMITER_REFILL_MS } from "./rateLimiter";

describe("J-Quants 共有リミッタの設定（バースト排除・余裕）", () => {
  it("capacity=1（初期バーストなし）・refill=15s（4req/分＜5req/分）", () => {
    expect(JQUANTS_LIMITER_CAPACITY).toBe(1);
    expect(JQUANTS_LIMITER_REFILL_MS).toBe(15_000);
    // 4req/分 ≤ 5req/分（J-Quants）で余裕がある
    expect(60_000 / JQUANTS_LIMITER_REFILL_MS).toBeLessThanOrEqual(5);
  });
});

/** fake クロック: sleep で時計を進める（実待機なし）。 */
function fakeClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    get value() {
      return clock;
    },
  };
}

describe("createRateLimiter（トークンバケット）", () => {
  it("容量ぶんは待機なしで取得できる", async () => {
    const c = fakeClock();
    const rl = createRateLimiter({ capacity: 5, refillMs: 12_000, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 5; i++) await rl.acquire();
    expect(c.value).toBe(0); // 一切待機していない
  });

  it("容量超過分は refillMs だけ待って取得する", async () => {
    const c = fakeClock();
    const rl = createRateLimiter({ capacity: 5, refillMs: 12_000, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 5; i++) await rl.acquire();
    await rl.acquire(); // 6件目
    expect(c.value).toBe(12_000);
    await rl.acquire(); // 7件目
    expect(c.value).toBe(24_000);
  });

  it("時間経過でトークンが補充される（容量上限を超えない）", async () => {
    let clock = 0;
    const rl = createRateLimiter({
      capacity: 5,
      refillMs: 12_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    // 5件消費
    for (let i = 0; i < 5; i++) await rl.acquire();
    // 外部要因で 60 秒経過（本来 5 補充されるが上限 5）
    clock += 60_000;
    // → 5 件までは即時
    for (let i = 0; i < 5; i++) await rl.acquire();
    expect(clock).toBe(60_000); // 追加待機なし
    // 6 件目は待機
    await rl.acquire();
    expect(clock).toBe(72_000);
  });

  it("事前 abort 済みの signal では AbortError", async () => {
    const rl = createRateLimiter({ capacity: 1, refillMs: 12_000 });
    const controller = new AbortController();
    controller.abort();
    await expect(rl.acquire(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("待機中の abort で AbortError（注入 sleep が reject）", async () => {
    let clock = 0;
    const controller = new AbortController();
    const rl = createRateLimiter({
      capacity: 1,
      refillMs: 12_000,
      now: () => clock,
      sleep: async (_ms, signal) => {
        // 待機に入った瞬間に中断される想定
        controller.abort();
        if (signal?.aborted) {
          const e = new Error("Aborted");
          e.name = "AbortError";
          throw e;
        }
        clock += _ms;
      },
    });
    await rl.acquire(); // 1件目で容量消費
    await expect(rl.acquire(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
