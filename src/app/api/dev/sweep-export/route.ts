/**
 * スイープ用の系列エクスポート（ローカル開発ツール）。
 * クライアントの price-cache（localStorage）から集めた系列を受け取り、
 * scripts/tmp/series-cache.json に書き出す。API 再取得は行わない（キャッシュ済みを保存するだけ）。
 * scripts/sweep.ts はこのファイルを読んでパラメータ感度分析を反復実行する。
 *
 * ※ サーバは 127.0.0.1 バインドのローカル運用。書き込み先はプロジェクト内の固定パスに限定する。
 */
import { NextResponse } from "next/server";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

interface Body {
  from?: string;
  to?: string;
  perCode?: { code: string; series: unknown[] }[];
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, message: "JSON を解析できませんでした。" }, { status: 400 });
  }
  const perCode = Array.isArray(body.perCode) ? body.perCode.filter((p) => p && typeof p.code === "string" && Array.isArray(p.series)) : [];
  if (perCode.length === 0) {
    return NextResponse.json({ ok: false, message: "系列がありません。先に『比較を実行』してキャッシュを作成してください。" });
  }

  const dir = path.join(process.cwd(), "scripts", "tmp");
  const file = path.join(dir, "series-cache.json");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), from: body.from ?? null, to: body.to ?? null, perCode }));
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }

  const points = perCode.reduce((n, p) => n + p.series.length, 0);
  return NextResponse.json({ ok: true, codes: perCode.length, points, file: "scripts/tmp/series-cache.json" });
}
