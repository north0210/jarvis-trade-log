"use client";

/**
 * Phase 48: 用語ツールチップ。指標ラベルに ⓘ を付与し、
 * hover / クリック（タップ）で初心者向け説明・JARVIS基準・注意点を表示。
 * データは src/lib/help/glossary.ts。詳しくは /help#g-<key> へ遷移。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getTerm, toneClass } from "@/lib/help/glossary";

interface Props {
  /** 用語辞典キー（glossary）。省略時は inline モード。 */
  termKey?: string;
  /** ラベル表示を上書き（省略時は用語の label / inline は必須）。 */
  label?: string;
  /** inline モードの説明文（termKey 未指定時に使用）。 */
  text?: string;
  className?: string;
}

export default function HelpTooltip({ termKey, label, text, className = "" }: Props) {
  const term = termKey ? getTerm(termKey) : undefined;
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pinned]);

  const open = hover || pinned;

  // inline モード（glossary に無い、しきい値などの補足説明）
  if (!term) {
    if (!text) return <span className={className}>{label}</span>;
    return (
      <span ref={ref} className={`relative inline-flex items-center gap-1 ${className}`}>
        <span>{label}</span>
        <button
          type="button"
          aria-label={`${label ?? ""} の説明`}
          className="text-arcdim hover:text-arc text-[0.85em] leading-none focus:outline-none"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setPinned((p) => !p);
          }}
        >
          ⓘ
        </button>
        {open && (
          <div
            className="absolute z-50 top-full left-0 mt-1 w-64 max-w-[80vw] hud-panel p-3 shadow-arc border-arc/50 text-left cursor-default"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-[#cfeaff] font-mono leading-relaxed whitespace-pre-wrap">{text}</p>
          </div>
        )}
      </span>
    );
  }

  return (
    <span ref={ref} className={`relative inline-flex items-center gap-1 ${className}`}>
      <span>{label ?? term.label}</span>
      <button
        type="button"
        aria-label={`${term.label} の説明`}
        className="text-arcdim hover:text-arc text-[0.85em] leading-none focus:outline-none"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setPinned((p) => !p);
        }}
      >
        ⓘ
      </button>
      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 w-72 max-w-[80vw] hud-panel p-3 shadow-arc border-arc/50 text-left cursor-default"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="font-display tracking-wider text-arc">{term.label}とは</p>
          <p className="text-xs text-[#cfeaff] mt-1 font-mono leading-relaxed">{term.beginnerDescription}</p>

          {term.jarvisRange.length > 0 && (
            <>
              <p className="hud-label mt-2">JARVIS基準</p>
              <ul className="mt-1 space-y-0.5">
                {term.jarvisRange.map((b, i) => (
                  <li key={i} className="text-xs font-mono flex justify-between gap-2">
                    <span className="text-arcdim">{b.range}</span>
                    <span className={toneClass[b.tone]}>{b.meaning}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {term.warning && (
            <p className="text-xs font-mono text-caution mt-2 leading-relaxed">注意: {term.warning}</p>
          )}

          {term.relatedTerms.length > 0 && (
            <p className="hud-label mt-2">
              関連:{" "}
              <span className="text-arcdim">
                {term.relatedTerms.map((k) => getTerm(k)?.label ?? k).join(" / ")}
              </span>
            </p>
          )}

          <div className="mt-2 text-right">
            <Link href={`/help#g-${term.key}`} className="hud-btn text-xs px-2 py-0.5">詳しく見る →</Link>
          </div>
        </div>
      )}
    </span>
  );
}
