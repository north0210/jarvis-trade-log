"use client";

/**
 * Phase 55: 初回起動チェックリスト＋免責同意（完全ローカル）。
 * Dashboard に配置。免責未同意なら同意ボタンを促し、
 * リリース前確認（バックアップ/J-Quants/通知/Help/サンプル）を管理する。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getReleaseState,
  acceptDisclaimer,
  setChecklistItem,
  CHECKLIST_ITEMS,
  DISCLAIMER_TEXT,
  type ReleaseState,
} from "@/lib/settings/release";

export default function ReleaseChecklist() {
  const [state, setState] = useState<ReleaseState | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setState(getReleaseState());
  }, []);

  if (!state) return null;

  const done = CHECKLIST_ITEMS.filter((it) => state.items[it.key]).length;
  const total = CHECKLIST_ITEMS.length;
  const allDone = done === total;

  const accept = () => setState(acceptDisclaimer());
  const toggle = (key: (typeof CHECKLIST_ITEMS)[number]["key"]) =>
    setState(setChecklistItem(key, !state.items[key]));

  // 同意済み かつ 全完了 かつ 折りたたみ済み → 非表示（邪魔しない）
  if (state.accepted && allDone && collapsed) return null;

  return (
    <section className="hud-panel p-4 border-arc/40 shadow-arc">
      <div className="flex items-center justify-between mb-2">
        <h2 className="hud-label">🚀 リリース前チェックリスト（{done}/{total}）</h2>
        {state.accepted && (
          <button className="hud-btn text-xs px-3 py-1" onClick={() => setCollapsed(true)}>
            閉じる
          </button>
        )}
      </div>

      {!state.accepted ? (
        <div className="rounded border border-caution/50 bg-caution/5 p-3">
          <p className="text-sm font-mono text-caution leading-relaxed">⚠ {DISCLAIMER_TEXT}</p>
          <button className="hud-btn mt-3" onClick={accept}>
            内容を理解しました（同意する）
          </button>
          <p className="text-xs text-arcdim mt-2">※ 同意すると初回案内を表示します。判断補助ツールとしてご利用ください、ボス。</p>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {CHECKLIST_ITEMS.map((it) => (
              <li key={it.key} className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="accent-arc" checked={!!state.items[it.key]} onChange={() => toggle(it.key)} />
                  <span className={`text-sm font-mono ${state.items[it.key] ? "text-arcdim line-through" : "text-[#cfeaff]"}`}>{it.label}</span>
                </label>
                <Link href={it.href} className="hud-btn text-xs px-2 py-0.5 shrink-0">開く →</Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-arcdim mt-2">
            {allDone ? "すべて確認済みです。実運用の準備が整いました、ボス。" : "各項目を確認し、チェックを入れてください。"}
          </p>
        </>
      )}
    </section>
  );
}
