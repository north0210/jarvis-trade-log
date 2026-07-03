"use client";

/**
 * Phase 55 (v1.3): Watchlist 自動監視コントローラ。
 * layout にマウントし、設定が有効な間だけ間隔チェックを実行する。
 * 多重起動防止・完全ローカル。外部API追加なし。
 */
import { useEffect, useRef } from "react";
import { getWatchlistSettings, runWatchlistCheck } from "@/lib/watchlist/watchlist-monitor";

export default function WatchlistController() {
  const running = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      const s = getWatchlistSettings();
      if (!s.enabled || running.current) return;
      // 前回実行から interval 未満ならスキップ
      if (s.lastRunAt) {
        const elapsed = Date.now() - new Date(s.lastRunAt).getTime();
        if (Number.isFinite(elapsed) && elapsed < s.intervalMinutes * 60 * 1000) return;
      }
      running.current = true;
      try {
        await runWatchlistCheck(new Date().toISOString());
      } catch {
        /* 監視失敗は無視（次回再試行） */
      } finally {
        running.current = false;
      }
    };

    // マウント後まもなく1回、その後は1分ごとに条件判定（実行間隔は設定で制御）
    const initial = setTimeout(tick, 8000);
    timer = setInterval(tick, 60 * 1000);
    return () => {
      clearTimeout(initial);
      if (timer) clearInterval(timer);
    };
  }, []);

  return null;
}
