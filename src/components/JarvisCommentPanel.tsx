"use client";

import { useEffect, useState } from "react";
import type { Stock } from "@/lib/types";
import type { ScoreResult } from "@/lib/score";
import type { Alert } from "@/lib/alerts";
import { generateJarvisComment } from "@/lib/analysis/commentary";
import { generateJarvisLLMComment } from "@/lib/analysis/llm-commentary";
import { getAICommentSettings } from "@/lib/analysis/ai-settings";
import JarvisComment from "./JarvisComment";

/**
 * JARVIS 分析コメント（テンプレ表示＋任意で LLM 生成）。
 * 初期はローカルテンプレを表示。AI設定 ON 時のみ「AI分析を生成」ボタンを出す。
 * LLM 失敗時はテンプレへ fallback し、その旨を表示する。
 * ※ stock が変わる場合は呼び出し側で key={stock.id} を渡してリセットさせる。
 */
export default function JarvisCommentPanel({
  stock,
  scoreResult,
  alerts,
  comparisonSummary,
  title,
}: {
  stock: Stock;
  scoreResult: ScoreResult;
  alerts: Alert[];
  comparisonSummary?: string;
  title?: string;
}) {
  const [text, setText] = useState(() => generateJarvisComment(stock, scoreResult, alerts));
  const [source, setSource] = useState<"template" | "llm">("template");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false); // SSR 一致のため mount 後に反映

  useEffect(() => {
    setAiEnabled(getAICommentSettings().enabled);
  }, []);

  const generate = async () => {
    setLoading(true);
    setNotice(null);
    const r = await generateJarvisLLMComment({ stock, scoreResult, alerts, comparisonSummary });
    setText(r.text);
    setSource(r.source);
    if (r.source === "template") {
      setNotice("外部AI分析に失敗したため、ローカル分析を表示しています");
    }
    setLoading(false);
  };

  const panelTitle = title ?? (source === "llm" ? "JARVIS COMMENT (AI)" : "JARVIS COMMENT");

  return (
    <div className="space-y-2">
      <JarvisComment title={panelTitle} text={loading ? "分析中です、ボス…" : text} />
      {notice && <p className="text-caution text-xs">{notice}</p>}
      {aiEnabled && (
        <button className="hud-btn text-xs px-3 py-1" onClick={generate} disabled={loading}>
          {loading ? "分析中…" : "AI分析を生成"}
        </button>
      )}
    </div>
  );
}
