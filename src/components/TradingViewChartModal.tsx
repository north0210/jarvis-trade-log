"use client";

/**
 * Phase 60 (v1.6.x Final): TradingView チャートモーダル。
 * 銘柄行内に押し込まず、画面中央のモーダルで大きく表示。
 * 高さ640px・幅100%・overflow-hidden 禁止・モバイル横スクロール可。
 * 閉じる: ×ボタン / 背景クリック / ESCキー。表示のみ・投資助言ではない。
 */
import { useEffect } from "react";
import dynamic from "next/dynamic";

const TradingViewChart = dynamic(() => import("@/components/TradingViewChart"), { ssr: false });

export default function TradingViewChartModal({
  code,
  name,
  onClose,
}: {
  code: string;
  name?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // モーダル表示中は背面スクロールを止める
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center p-2 sm:p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div className="hud-panel w-full max-w-6xl p-4 border-arc/50 shadow-arc" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="hud-label text-arc">📈 チャート — {name ? `${name}（${code}）` : code}</h2>
          <button className="hud-btn text-xs px-3 py-1" onClick={onClose} aria-label="閉じる">閉じる ✕（ESC）</button>
        </div>
        <div className="w-full overflow-x-auto">
          <div className="min-w-[320px]" style={{ height: 700 }}>
            <TradingViewChart code={code} height={700} />
          </div>
        </div>
        <p className="text-xs text-arcdim mt-2">※ TradingView 埋め込み（表示のみ）。判断補助であり投資助言ではありません。</p>
      </div>
    </div>
  );
}
