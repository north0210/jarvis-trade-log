"use client";

import { normalizeTseCode, tradingViewChartUrl } from "@/lib/tradingview";

/**
 * 個別銘柄チャートの外部リンク表示。
 *
 * TradingView の無料埋め込みウィジェットは日本の個別株データに非対応で、
 * 正しいシンボル（TSE:2222 等）でも「TradingView 上でのみ利用可能」となり、
 * 既定銘柄（AAPL 等）へ誤フォールバックしてタイトルと中身が食い違う。
 * そのため埋め込みは廃止し、TradingView サイトへの外部リンクを表示する。
 *  - 4桁正規化（normalizeTseCode / tradingViewChartUrl）は URL 生成に再利用する。
 *  - 呼び出し側（/ , /holdings , /stocks モーダル）は変更不要（本コンポーネント内に閉じる）。
 *
 * code 未設定時は「チャートデータ未登録」を表示する。
 * 表示 ON/OFF の判定は呼び出し側（isTradingViewEnabled）で行う。
 */
export default function TradingViewChart({
  code,
  name,
  height = 420,
}: {
  code?: string | null;
  name?: string | null;
  height?: number;
}) {
  if (!code) {
    return <p className="text-arcdim text-sm">チャートデータ未登録</p>;
  }

  const symbol = normalizeTseCode(code); // 4桁正規化済みコード（表示用）
  const url = tradingViewChartUrl(code);

  return (
    <div
      className="tradingview-widget-container flex flex-col items-center justify-center gap-3 text-center"
      style={{ height, width: "100%" }}
    >
      <div className="font-display">
        {name && <span className="text-arc">{name}</span>}
        <span className="font-mono text-arcdim ml-2">TSE:{symbol}</span>
      </div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="hud-btn">
        TradingView で開く ↗
      </a>
      <p className="text-xs text-arcdim max-w-sm">
        日本株は TradingView サイト内でのみ表示可能なため、外部で開きます。
      </p>
    </div>
  );
}
