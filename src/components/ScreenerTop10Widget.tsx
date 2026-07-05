"use client";

/**
 * ダッシュボード常設: JARVIS おすすめ Top10 ウィジェット。
 * 永続化済みスナップショット（/screener で生成）を読み取り表示するのみ（ここでは取得しない）。
 * 判断補助であり投資助言ではありません。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { loadScreenerSnapshot, type ScreenerSnapshot } from "@/lib/screener/screenerRepository";

export default function ScreenerTop10Widget() {
  const [snap, setSnap] = useState<ScreenerSnapshot | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSnap(loadScreenerSnapshot());
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <section className="hud-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="hud-label">★ JARVIS おすすめ Top10（全銘柄スクリーナー）</h2>
        <Link href="/screener" className="hud-btn text-xs px-3 py-1">スクリーナー全体 →</Link>
      </div>

      {!snap ? (
        <p className="text-arcdim text-sm">
          まだ実行されていません。
          <Link href="/screener" className="text-arc hover:underline ml-1">スクリーナーを実行 →</Link>
        </p>
      ) : (
        <>
          <p className="text-xs text-arcdim mb-2">
            {snap.generatedAt.slice(0, 10)} 時点・{snap.universeCount}社中（技術＋財務スコア順）
          </p>
          <table className="w-full text-sm font-mono whitespace-nowrap">
            <thead>
              <tr className="hud-label text-left">
                {["#", "コード", "銘柄名", "スコア", "評価", "財務", ""].map((h, i) => (
                  <th key={i} className="pb-2 pr-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snap.rows.slice(0, 10).map((r, i) => (
                <tr key={r.code} className="border-t border-line/60">
                  <td className="py-1 pr-3 text-arcdim">{i + 1}</td>
                  <td className="py-1 pr-3">{r.code}</td>
                  <td className="py-1 pr-3">{r.name}</td>
                  <td className="py-1 pr-3 text-arc">{r.score}</td>
                  <td className="py-1 pr-3">{r.grade}</td>
                  <td className="py-1 pr-3 text-[10px] text-arcdim">
                    {r.fundamentalsAvailable
                      ? `${r.fundamentalsBasis === "FY" ? "本決算" : r.fundamentalsBasis === "quarter" ? "四半期" : ""}${r.fundamentalsAsOf ? ` ${r.fundamentalsAsOf.slice(0, 10)}` : ""}`
                      : "財務未取得"}
                  </td>
                  <td className="py-1 pr-3">
                    <Link href="/stocks" className="hud-btn text-xs px-2 py-0.5">銘柄管理へ</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="text-xs text-arcdim mt-2">※ 判断補助であり投資助言ではありません。財務は決算開示ベース（遅延あり）。</p>
    </section>
  );
}
