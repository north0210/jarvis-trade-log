"use client";

import { useEffect, useRef } from "react";
import { tradingViewSymbol } from "@/lib/tradingview";

/**
 * TradingView Advanced Chart 埋込。
 * 日足・出来高・RSI・MACD を表示する。
 * code 未設定時は「チャートデータ未登録」を表示する。
 * 表示 ON/OFF の判定は呼び出し側（isTradingViewEnabled）で行う。
 */
export default function TradingViewChart({
  code,
  height = 420,
}: {
  code?: string | null;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !code) return;
    container.innerHTML = "";

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tradingViewSymbol(code),
      interval: "D", // 日足
      timezone: "Asia/Tokyo",
      theme: "dark",
      style: "1", // ローソク足
      locale: "ja",
      allow_symbol_change: false,
      hide_side_toolbar: false,
      studies: ["STD;RSI", "STD;MACD"], // RSI + MACD（出来高は既定表示）
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [code]);

  if (!code) {
    return <p className="text-arcdim text-sm">チャートデータ未登録</p>;
  }

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container"
      style={{ height, width: "100%" }}
    />
  );
}
