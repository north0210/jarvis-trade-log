"use client";

import { useEffect } from "react";
import { loadSignalEngineSettings } from "@/lib/paper/signalEngineRepository";
import { runSignalEngine } from "@/lib/paper/runSignalEngine";

/**
 * 日次シグナルエンジンの常駐コントローラ（描画なし）— Phase 1 / Task 4。
 * autoEnabled のときのみ、アプリ起動時に1回だけシグナル生成＋約定を実行する。
 * 価格/レポート/スクリーナー自動より後段（低優先）で起動するため十分遅延させる。
 * 既定 autoEnabled=false のため、オプトインしない限り何もしない。
 */
export default function SignalEngineController() {
  useEffect(() => {
    if (!loadSignalEngineSettings().autoEnabled) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      runSignalEngine({ signal: controller.signal }).catch(() => {});
    }, 12000);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, []);
  return null;
}
