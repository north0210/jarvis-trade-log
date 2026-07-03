/**
 * Phase 55: 免責表示（完全ローカル・表示のみ）。
 * /help・/settings・/report など各所に埋め込む軽量バナー。
 */
import { DISCLAIMER_TEXT } from "@/lib/settings/release";

export default function Disclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`hud-panel border-caution/40 ${compact ? "p-3" : "p-4"}`}>
      <p className="hud-label">⚠ 免責事項</p>
      <p className={`font-mono text-arcdim leading-relaxed mt-1 ${compact ? "text-xs" : "text-sm"}`}>{DISCLAIMER_TEXT}</p>
    </section>
  );
}
