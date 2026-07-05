/**
 * J-Quants API V2 Route Handler（サーバ側）。
 *
 * フロントから直接 J-Quants を叩かず、この Route を経由する（CORS回避・APIキーの秘匿）。
 *
 * 認証（V2・APIキー方式）:
 *   ヘッダ `x-api-key: <APIキー>` を付与。トークン交換（V1）は不要・廃止。
 *   APIキーの優先順位: 環境変数 JQUANTS_API_KEY（本番推奨・サーバ側のみ）→ リクエストボディ apiKey。
 *   → env が設定されていれば localStorage 由来（body.apiKey）より優先する。
 *
 * ※ APIキーの直書きは禁止。env 未設定でも build/lint は通る（実行時のみ参照）。
 *   V1（email/password）認証は jquantsV1.deprecated.ts に @deprecated 残置（非破壊）。
 *
 * body: { action: "test"|"quotes"|"series", codes?: string[], apiKey?: string,
 *         code?: string, from?: string, to?: string }
 */
import { NextResponse } from "next/server";
import {
  buildDailyBarsUrl,
  mapDailyBars,
  deriveQuote,
  pickApiKey,
  type V2DailyBar,
  type InternalBar,
} from "@/lib/pricing/jquantsV2";

interface RequestBody {
  action?: string;
  codes?: unknown;
  apiKey?: string;
  code?: string; // series/quote 用
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/** x-api-key ヘッダを組み立てる。 */
function authHeaders(apiKey: string): HeadersInit {
  return { "x-api-key": apiKey };
}

/**
 * 期間指定の日足バーを pagination 対応で全件取得する。
 * status（HTTP）と内部日足を返し、401/403/429 を上位で判定する。
 */
async function fetchBars(
  apiKey: string,
  code: string,
  from: string,
  to: string
): Promise<{ status: number; bars: InternalBar[] | null }> {
  const raw: V2DailyBar[] = [];
  let key: string | undefined;
  let guard = 0;
  do {
    const url = buildDailyBarsUrl({ code, from, to, paginationKey: key });
    const res = await fetch(url, { headers: authHeaders(apiKey) });
    if (!res.ok) return { status: res.status, bars: null };
    const data = (await res.json()) as { data?: V2DailyBar[]; pagination_key?: string };
    if (Array.isArray(data.data)) raw.push(...data.data);
    key = data.pagination_key;
    guard++;
  } while (key && guard < 100); // 安全弁
  return { status: 200, bars: mapDailyBars(raw) };
}

export async function POST(req: Request) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }
  const action =
    body.action === "quotes" ? "quotes" : body.action === "series" ? "series" : "test";
  const apiKey = pickApiKey(process.env.JQUANTS_API_KEY, body.apiKey);

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      status: "unset",
      message: "APIキーが未設定です（.env.local の JQUANTS_API_KEY または設定画面で入力してください）",
    });
  }

  try {
    // 接続テスト: 軽量に 1 銘柄の直近を叩き、認証可否を確認する。
    if (action === "test") {
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
      // 代表的な流動銘柄（トヨタ 7203）で疎通確認。データ有無ではなく認証成否を見る。
      const res = await fetch(
        buildDailyBarsUrl({ code: "7203", from: fmtDate(from), to: fmtDate(to) }),
        { headers: authHeaders(apiKey) }
      );
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ ok: false, status: "error", reason: "auth", message: "APIキーが無効です（認証エラー）。" });
      }
      if (res.status === 429) {
        return NextResponse.json({ ok: false, status: "error", reason: "rate", message: "レート制限に達しました。時間をおいて再試行してください。" });
      }
      if (!res.ok) {
        return NextResponse.json({ ok: false, status: "error", message: `接続失敗 (${res.status})` });
      }
      return NextResponse.json({ ok: true, status: "connected", message: "接続成功" });
    }

    const to = typeof body.to === "string" ? body.to : fmtDate(new Date());

    // 日足系列（pagination・バックテスト用）
    if (action === "series") {
      const code = typeof body.code === "string" ? body.code : "";
      const from =
        typeof body.from === "string"
          ? body.from
          : fmtDate(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
      if (!code) return NextResponse.json({ ok: false, status: "error", message: "code が必要です" });
      const r = await fetchBars(apiKey, code, from, to);
      if (r.status === 401 || r.status === 403)
        return NextResponse.json({ ok: false, status: "error", reason: "auth", message: "APIキーが無効です（認証エラー）。" });
      if (r.status === 429)
        return NextResponse.json({ ok: false, status: "error", reason: "rate", message: "レート制限に達しました。時間をおいて再試行してください。" });
      if (!r.bars)
        return NextResponse.json({ ok: false, status: "error", message: `系列取得に失敗しました (${code}: ${r.status})` });
      return NextResponse.json({ ok: true, status: "connected", series: r.bars });
    }

    // 価格取得（quotes）。直近 120 日を取得し最新クオート＋系列を導出。
    const codes = Array.isArray(body.codes)
      ? body.codes.filter((x): x is string => typeof x === "string")
      : [];
    const from =
      typeof body.from === "string"
        ? body.from
        : fmtDate(new Date(Date.now() - 120 * 24 * 60 * 60 * 1000));

    const quotes = [];
    for (const code of codes) {
      const r = await fetchBars(apiKey, code, from, to);
      if (r.status === 401 || r.status === 403) {
        return NextResponse.json({ ok: false, status: "error", reason: "auth", message: "APIキーが無効です（認証エラー）。" });
      }
      if (r.status === 429) {
        return NextResponse.json({ ok: false, status: "error", reason: "rate", message: "レート制限に達しました。時間をおいて再試行してください。" });
      }
      if (!r.bars) continue; // その他の失敗銘柄はスキップ（部分成功を許容）
      const q = deriveQuote(code, r.bars);
      if (q) quotes.push(q);
    }

    return NextResponse.json({ ok: true, status: "connected", quotes });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
