"use client";

import { useEffect } from "react";
import { runAutoReportSave } from "@/lib/report/auto-report";

/**
 * レポート自動保存の常駐コントローラ（描画なし）。
 * アプリを開いている間、起動時＋30分ごとに保存タイミングを判定する。
 * 同一期間の重複保存は auto-report 側で防止。タブを閉じると停止。
 */
export default function AutoReportController() {
  useEffect(() => {
    void runAutoReportSave();
    const t = setInterval(() => {
      void runAutoReportSave();
    }, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  return null;
}
