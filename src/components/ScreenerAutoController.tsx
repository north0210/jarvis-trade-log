"use client";

import { useEffect } from "react";
import { runScreenerAuto } from "@/lib/screener/screenerAuto";

/**
 * スクリーナー自動更新の常駐コントローラ（描画なし）。
 * layout に1つだけ配置。アプリ起動時に鮮度判定して1回だけ実行する。
 * 他の自動（価格・レポート）より **低優先/後段**で起動するため、数秒遅延させる。
 * 高コスト（~11〜23分）のため setInterval はせず、起動時1回のチェックのみ。
 */
export default function ScreenerAutoController() {
  useEffect(() => {
    const controller = new AbortController();
    // 価格/レポート自動を先に走らせるため 8 秒遅延（低優先/後段起動）。
    const t = setTimeout(() => {
      runScreenerAuto({ signal: controller.signal }).catch(() => {});
    }, 8000);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, []);
  return null;
}
