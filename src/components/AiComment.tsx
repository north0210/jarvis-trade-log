"use client";

/**
 * Phase 58 (v1.6): 再利用可能な AIコメント表示（完全ローカル基盤）。
 * OFF時は非表示。Template時は即時ローカル生成。外部プロバイダ時は「AI生成」ボタンで実行し、
 * 失敗時は Template へフォールバック（動作停止なし）。判断補助・投資助言ではない。
 */
import { useEffect, useMemo, useState } from "react";
import { generateAiComment, templateComment, type AiContext } from "@/lib/advisor/ai-layer";
import { effectiveAiMode, getAiConfig } from "@/lib/advisor/advisor-ai-settings";
import { saveAiComment } from "@/lib/advisor/ai-comment";

export default function AiComment({ ctx }: { ctx: AiContext }) {
  const [mode, setMode] = useState<"off" | "template" | "provider">("off");
  const [text, setText] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const cfg = useMemo(() => (typeof window !== "undefined" ? getAiConfig() : null), []);
  const style = cfg?.style ?? "balanced";
  const detail = cfg?.detail ?? "standard";

  useEffect(() => {
    const eff = effectiveAiMode();
    setMode(eff);
    if (eff === "template") {
      setText(templateComment(ctx, style, detail));
      setSource("template");
    } else {
      setText(null);
      setSource(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(ctx)]);

  if (mode === "off") return null;

  const run = async () => {
    setBusy(true);
    const r = await generateAiComment(ctx);
    setBusy(false);
    if (r) {
      setText(r.text);
      setSource(r.source);
      setSaved(false);
    }
  };
  const save = () => {
    if (!text) return;
    saveAiComment(`【${ctx.title}】\n${ctx.facts.map((f) => `- ${f}`).join("\n")}`, text, new Date().toISOString());
    setSaved(true);
  };

  return (
    <section className="hud-panel p-4 border-arc/30">
      <div className="flex items-center justify-between mb-2">
        <h3 className="hud-label">🧠 AIコメント — {ctx.title}</h3>
        <div className="flex gap-2">
          {mode === "provider" && (
            <button className="hud-btn text-xs px-3 py-1" onClick={run} disabled={busy}>{busy ? "生成中…" : "AIで生成"}</button>
          )}
          {text && <button className="hud-btn text-xs px-3 py-1" onClick={save} disabled={saved}>{saved ? "保存済み" : "履歴に保存"}</button>}
        </div>
      </div>
      {text ? (
        <p className="text-sm font-mono text-[#cfeaff] whitespace-pre-wrap leading-relaxed">{text}</p>
      ) : (
        <p className="text-xs text-arcdim font-mono">「AIで生成」を押すと外部プロバイダで生成します（未設定/失敗時は Template へフォールバック）。</p>
      )}
      {source && <p className="text-xs text-arcdim mt-2">source: {source === "fallback" ? "Template（フォールバック）" : source}</p>}
    </section>
  );
}
