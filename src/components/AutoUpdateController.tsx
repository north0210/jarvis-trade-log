"use client";

import { useEffect } from "react";
import { startAutoUpdate, stopAutoUpdate } from "@/lib/pricing/auto-update";

/**
 * 自動価格更新スケジューラの常駐コントローラ（描画なし）。
 * layout に1つだけ配置し、アプリを開いている間だけタイマーを稼働させる。
 * 設定変更時は Settings 画面が restartAutoUpdate() を呼ぶ。
 */
export default function AutoUpdateController() {
  useEffect(() => {
    startAutoUpdate();
    return () => stopAutoUpdate();
  }, []);
  return null;
}
