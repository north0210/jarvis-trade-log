"use client";

/**
 * Phase 51: グループ化ナビゲーション。
 * 画面数増加に対応し、5カテゴリのドロップダウンへ整理（初心者の導線改善）。
 * hover / クリック（タップ）で開閉。現在地を含むグループを強調。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface NavItem {
  href: string;
  label: string;
}
interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    id: "basic",
    label: "基本",
    items: [
      { href: "/", label: "ダッシュボード" },
      { href: "/stocks", label: "銘柄管理" },
      { href: "/holdings", label: "保有株" },
      { href: "/journal", label: "運用日誌" },
    ],
  },
  {
    id: "analysis",
    label: "分析",
    items: [
      { href: "/portfolio", label: "PF分析" },
      { href: "/simulator", label: "試算" },
      { href: "/comparison", label: "比較" },
      { href: "/risk", label: "リスク" },
      { href: "/factor", label: "要因（Factor）" },
      { href: "/montecarlo", label: "モンテカルロ" },
      { href: "/backtest", label: "検証（Backtest）" },
      { href: "/backtest-v2", label: "実証（価格系列）" },
      { href: "/market-radar", label: "市況（Radar）" },
      { href: "/sector-heatmap", label: "セクター" },
      { href: "/mental", label: "心理（Mental）" },
      { href: "/adaptive-score", label: "適応スコア" },
    ],
  },
  {
    id: "strategy",
    label: "戦略",
    items: [
      { href: "/advisor", label: "JARVIS Advisor" },
      { href: "/advisor-ranking", label: "ランキング" },
      { href: "/stock-backtest", label: "銘柄別BT" },
      { href: "/strategy", label: "戦略テンプレート" },
      { href: "/rule-improver", label: "ルール改善" },
      { href: "/strategy-backtest", label: "一括バックテスト" },
      { href: "/strategy-rank-history", label: "ランキング履歴" },
      { href: "/rebalance", label: "リバランス調整" },
      { href: "/discipline", label: "規律チェック" },
      { href: "/history", label: "取引履歴" },
    ],
  },
  {
    id: "report",
    label: "レポート",
    items: [
      { href: "/report", label: "レポート" },
      { href: "/report-history", label: "レポート履歴" },
      { href: "/notifications", label: "通知" },
    ],
  },
  {
    id: "system",
    label: "設定・ヘルプ",
    items: [
      { href: "/help", label: "使い方ガイド" },
      { href: "/backup", label: "バックアップ/復元" },
      { href: "/settings", label: "設定" },
    ],
  },
];

export default function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // 経路変更で閉じる
  useEffect(() => {
    setOpen(null);
  }, [path]);

  return (
    <nav ref={ref} className="flex flex-wrap gap-1 justify-end">
      {GROUPS.map((g) => {
        const activeGroup = g.items.some((it) => it.href === path);
        const isOpen = open === g.id;
        return (
          <div key={g.id} className="relative" onMouseEnter={() => setOpen(g.id)} onMouseLeave={() => setOpen(null)}>
            <button
              type="button"
              className={`px-3 py-1.5 rounded text-sm tracking-wider border transition-colors ${
                activeGroup
                  ? "border-arc/60 text-arc bg-arc/10 shadow-arc"
                  : "border-transparent text-arcdim hover:text-arc hover:border-line"
              }`}
              onClick={() => setOpen((o) => (o === g.id ? null : g.id))}
              aria-expanded={isOpen}
            >
              {g.label} <span className="text-[0.7em] text-arcdim">▾</span>
            </button>
            {isOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-44 hud-panel p-1.5 shadow-arc border-arc/50">
                {g.items.map((it) => {
                  const active = it.href === path;
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      className={`block px-3 py-1.5 rounded text-sm tracking-wide transition-colors ${
                        active ? "text-arc bg-arc/10" : "text-arcdim hover:text-arc hover:bg-line/40"
                      }`}
                    >
                      {it.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
