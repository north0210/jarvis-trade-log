/**
 * JARVIS COMMENT パネル — 黒背景＋シアン発光の分析コメント表示。
 * 長文は折り返し表示。commentary.ts の生成テキストを受け取るだけの表示層。
 */
export default function JarvisComment({
  text,
  title = "JARVIS COMMENT",
}: {
  text: string;
  title?: string;
}) {
  return (
    <div className="rounded border border-arc/40 bg-arc/5 shadow-arc p-3">
      <p className="hud-label mb-1 flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-arc animate-pulse" />
        {title}
      </p>
      <p className="text-sm text-arc font-mono leading-relaxed whitespace-pre-wrap break-words">
        {text}
        <span className="inline-block w-2 text-arc animate-pulse">▍</span>
      </p>
    </div>
  );
}
