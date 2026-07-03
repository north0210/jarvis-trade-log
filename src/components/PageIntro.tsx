/**
 * Phase 51: 画面上部の一行ガイド（JARVIS 説明）。
 * 各主要画面の目的を初心者にも分かる形で示す軽量な帯。完全ローカル・表示のみ。
 */
import Link from "next/link";

interface Props {
  /** 画面タイトル（アイコン込み可）。 */
  title: string;
  /** この画面で何をするかの一行説明。 */
  description: string;
  /** 任意: 関連ヘルプの用語アンカー（/help#g-<key>）。 */
  helpKey?: string;
}

export default function PageIntro({ title, description, helpKey }: Props) {
  return (
    <section className="hud-panel p-3 border-arc/30 flex items-start justify-between gap-3">
      <div>
        <h2 className="font-display tracking-widest text-arc text-sm">{title}</h2>
        <p className="text-xs text-arcdim mt-1 font-mono leading-relaxed">・{description}</p>
      </div>
      <Link
        href={helpKey ? `/help#g-${helpKey}` : "/help"}
        className="hud-btn text-xs px-3 py-1 shrink-0 whitespace-nowrap"
      >
        使い方 →
      </Link>
    </section>
  );
}
