"use client";

/**
 * Phase 54 (v1.2): 初回起動ガイド（Onboarding）。
 * 主要画面と使い方を初心者向けに案内。localStorage フラグで一度閉じたら再表示しない。
 * 完全ローカル・表示のみ。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { K } from "@/lib/storage/keys";

const KEY = K.onboardingDone;

const STEPS: { icon: string; title: string; desc: string; href: string }[] = [
  { icon: "🛰", title: "ダッシュボード", desc: "総資産・リスク・通知・Advisor・出来高を一覧で確認します。", href: "/" },
  { icon: "📋", title: "銘柄管理", desc: "気になる銘柄を登録し、Score・RSI・出来高で採点します。", href: "/stocks" },
  { icon: "💼", title: "保有株", desc: "取得単価・損切り/利確を記録。危険判定が自動で付きます。", href: "/holdings" },
  { icon: "🛰", title: "JARVIS Advisor", desc: "分析を統合し、買い/保有/売却/危険の候補を根拠つきで提示します（判断補助）。", href: "/advisor" },
  { icon: "🗒", title: "レポート/PDF", desc: "運用状況を1枚に集約し、PDF出力・履歴比較ができます。", href: "/report" },
  { icon: "📘", title: "使い方ガイド", desc: "用語辞典・JARVIS基準・今日やることを確認できます。", href: "/help" },
];

export default function Onboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(false);
    }
  }, []);

  const close = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <section className="hud-panel p-4 border-arc/50 shadow-arc">
      <div className="flex items-center justify-between mb-2">
        <h2 className="hud-label text-arc">🚀 はじめての方へ — JARVIS Trade Log の使い方</h2>
        <button className="hud-btn text-xs px-3 py-1" onClick={close}>閉じる（今後表示しない）</button>
      </div>
      <p className="text-xs text-arcdim mb-3 font-mono">
        本アプリは完全ローカルで動作する判断補助ツールです（投資助言ではありません）。主要画面は以下の通りです、ボス。
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {STEPS.map((s) => (
          <Link key={s.title} href={s.href} className="rounded border border-line/60 p-3 hover:border-arc/50 transition-colors">
            <p className="font-display tracking-wider text-arc">{s.icon} {s.title}</p>
            <p className="text-xs text-[#cfeaff] mt-1 font-mono leading-relaxed">{s.desc}</p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-arcdim mt-3">
        まずは <Link href="/help" className="text-arc hover:underline">使い方ガイド</Link> と{" "}
        <Link href="/backup" className="text-arc hover:underline">バックアップ</Link> の確認をおすすめします。
      </p>
    </section>
  );
}
