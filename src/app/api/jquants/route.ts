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
 * データ範囲（プラン非依存）:
 *   無料プランは約12週間遅延で、範囲外の日付を要求すると 400 を返す
 *   （"Your subscription covers the following dates: A ~ B"）。
 *   その終端 B を学習し、要求窓を幅を保ったままクランプして再取得する。
 *   有料プラン（今日までカバー）ではクランプが起きず自然に最新を取得する。
 *
 * ※ APIキーの直書きは禁止。env 未設定でも build/lint は通る（実行時のみ参照）。
 *   V1（email/password）認証は jquantsV1.deprecated.ts に @deprecated 残置（非破壊）。
 *
 * body: { action: "test"|"quotes"|"series", codes?: string[], apiKey?: string,
 *         code?: string, from?: string, to?: string }
 */
import { NextResponse } from "next/server";
import { acquireServerToken } from "@/lib/pricing/serverRateLimiter";
import {
  buildDailyBarsUrl,
  buildFinsUrl,
  buildMasterUrl,
  buildBarsByDateUrl,
  buildCalendarUrl,
  mapDailyBars,
  deriveQuote,
  resolveApiKey,
  parseSubscriptionRange,
  clampToCoverage,
  type V2DailyBar,
  type V2FinRecord,
  type V2MasterRecord,
  type V2CalendarRecord,
  type InternalBar,
} from "@/lib/pricing/jquantsV2";

interface RequestBody {
  action?: string;
  codes?: unknown;
  apiKey?: string;
  code?: string; // series/quote 用
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  date?: string; // master / bars-by-date 用 YYYY-MM-DD
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/** x-api-key ヘッダを組み立てる。 */
function authHeaders(apiKey: string): HeadersInit {
  return { "x-api-key": apiKey };
}

/**
 * J-Quants へのリクエスト。**サーバ側リミッタ（APIキー単位・プロセス内）**でトークンを
 * 取得してから実行する（クライアントのリロード/HMR/複数タブに影響されない権威ある枠）。
 */
async function jqFetch(url: string, apiKey: string): Promise<Response> {
  await acquireServerToken(apiKey);
  return fetch(url, { headers: authHeaders(apiKey) });
}

/**
 * 上流（J-Quants）のエラー本文を短く抽出する（診断用）。
 * レスポンス本文のみを読むため、APIキー実値は含まれない。
 */
async function upstreamErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "";
    try {
      const j = JSON.parse(text) as { message?: unknown; error?: unknown };
      const m = j.message ?? j.error;
      if (typeof m === "string" && m) return m.slice(0, 200);
      return JSON.stringify(j).slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return "";
  }
}

// ---- 購読カバレッジ終端の学習キャッシュ（プロセス内・短TTL） ----
// 無料プランのローリング遅延に追随しつつ、bulk 中の毎回 400 を避ける。
const COVERAGE_TTL_MS = 30 * 60 * 1000;
let coverageCache: { end: string; at: number } | null = null;

function getCoverageEnd(): string | null {
  if (coverageCache && Date.now() - coverageCache.at < COVERAGE_TTL_MS) return coverageCache.end;
  return null;
}

interface BarsResult {
  status: number;
  bars: InternalBar[];
  detail?: string;
  /** カバレッジに合わせてクランプした場合の終端日。 */
  clampedTo?: string;
}

/**
 * 日足バーを取得する。pagination 対応＋サブスク範囲外(400)の学習クランプ再試行(最大1回)。
 */
async function collectBars(apiKey: string, code: string, reqFrom: string, reqTo: string): Promise<BarsResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const clamp = clampToCoverage(reqFrom, reqTo, getCoverageEnd());
    const raw: V2DailyBar[] = [];
    let key: string | undefined;
    let guard = 0;
    let failStatus = 0;
    let failDetail = "";
    let learned = false;

    do {
      const res = await jqFetch(
        buildDailyBarsUrl({ code, from: clamp.from, to: clamp.to, paginationKey: key }),
        apiKey
      );
      if (!res.ok) {
        failStatus = res.status;
        failDetail = await upstreamErrorDetail(res);
        if (res.status === 400) {
          const range = parseSubscriptionRange(failDetail);
          if (range && getCoverageEnd() !== range.to) {
            coverageCache = { end: range.to, at: Date.now() };
            learned = true;
          }
        }
        break;
      }
      const data = (await res.json()) as { data?: V2DailyBar[]; pagination_key?: string };
      if (Array.isArray(data.data)) raw.push(...data.data);
      key = data.pagination_key;
      guard++;
    } while (key && guard < 100);

    if (failStatus === 0) {
      return { status: 200, bars: mapDailyBars(raw), clampedTo: clamp.clamped ? clamp.to : undefined };
    }
    // サブスク範囲を学習できたら 1 回だけ再クランプして取り直す。
    if (failStatus === 400 && learned) continue;
    return { status: failStatus, bars: [], detail: failDetail };
  }
  return { status: 400, bars: [] };
}

/**
 * pagination_key に追従して data[] を全ページ収集する汎用ヘルパ。
 * pages（実ページ数）も返し、初回バッチの所要見積りに用いる。
 */
async function fetchAllRows<T>(
  makeUrl: (paginationKey?: string) => string,
  apiKey: string
): Promise<{ status: number; rows: T[]; detail?: string; pages: number }> {
  const rows: T[] = [];
  let key: string | undefined;
  let guard = 0;
  let pages = 0;
  do {
    const res = await jqFetch(makeUrl(key), apiKey);
    if (!res.ok) {
      const detail = await upstreamErrorDetail(res);
      return { status: res.status, rows: [], detail, pages };
    }
    const data = (await res.json()) as { data?: T[]; pagination_key?: string };
    if (Array.isArray(data.data)) rows.push(...data.data);
    key = data.pagination_key;
    pages++;
    guard++;
  } while (key && guard < 500); // 安全弁（全銘柄×多ページでも十分）
  return { status: 200, rows, pages };
}

/** YYYY-MM-DD / YYYYMMDD を YYYY-MM-DD へ正規化する。 */
function normDate(d: string): string {
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

/** 財務情報を取得する（code 指定・pagination 対応）。 */
async function fetchFins(
  apiKey: string,
  code: string
): Promise<{ status: number; records: V2FinRecord[]; detail?: string }> {
  const raw: V2FinRecord[] = [];
  let key: string | undefined;
  let guard = 0;
  do {
    const res = await jqFetch(buildFinsUrl({ code, paginationKey: key }), apiKey);
    if (!res.ok) {
      const detail = await upstreamErrorDetail(res);
      return { status: res.status, records: [], detail };
    }
    const data = (await res.json()) as { data?: V2FinRecord[]; pagination_key?: string };
    if (Array.isArray(data.data)) raw.push(...data.data);
    key = data.pagination_key;
    guard++;
  } while (key && guard < 50); // 安全弁
  return { status: 200, records: raw };
}

export async function POST(req: Request) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }
  const KNOWN_ACTIONS = ["quotes", "series", "fins", "master", "bars-by-date", "calendar"];
  const action = KNOWN_ACTIONS.includes(body.action ?? "") ? (body.action as string) : "test";
  const { key: apiKey, source: keySource } = resolveApiKey(process.env.JQUANTS_API_KEY, body.apiKey);

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      status: "unset",
      message:
        "APIキーが未設定です（サーバ env の JQUANTS_API_KEY が空、かつ設定画面の入力も空）。" +
        ".env.local に JQUANTS_API_KEY を設定して dev を再起動するか、設定画面でキーを保存してください。",
    });
  }
  const keySrcLabel = keySource === "env" ? "env" : "画面入力";

  const authFail = (status: number, detail: string) =>
    NextResponse.json({
      ok: false,
      status: "error",
      reason: "auth",
      message: `APIキーが無効です（認証エラー ${status}・キー経路: ${keySrcLabel}）${detail ? `: ${detail}` : ""}`,
    });
  const rateFail = () =>
    NextResponse.json({ ok: false, status: "error", reason: "rate", message: "レート制限に達しました。時間をおいて再試行してください。" });
  const otherFail = (status: number, detail: string, ctx: string) =>
    NextResponse.json({ ok: false, status: "error", message: `${ctx} (${status}・キー経路: ${keySrcLabel})${detail ? `: ${detail}` : ""}` });

  try {
    // 接続テスト: 直近を要求し、無料プランなら範囲外→学習クランプで取得できれば「接続成功」。
    if (action === "test") {
      const to = fmtDate(new Date());
      const from = fmtDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      const r = await collectBars(apiKey, "7203", from, to);
      if (r.status === 200) {
        const end = getCoverageEnd();
        const note = end ? `無料/遅延プラン・最新データ ${end}` : "リアルタイム相当";
        return NextResponse.json({ ok: true, status: "connected", message: `接続成功（${note}・キー経路: ${keySrcLabel}）` });
      }
      if (r.status === 401 || r.status === 403) return authFail(r.status, r.detail ?? "");
      if (r.status === 429) return rateFail();
      return otherFail(r.status, r.detail ?? "", "接続失敗");
    }

    // 財務情報（code 指定・日付レンジ非依存のため価格のようなクランプは不要）。
    if (action === "fins") {
      const code = typeof body.code === "string" ? body.code : "";
      if (!code) return NextResponse.json({ ok: false, status: "error", message: "code が必要です" });
      const r = await fetchFins(apiKey, code);
      if (r.status === 401 || r.status === 403) return authFail(r.status, r.detail ?? "");
      if (r.status === 429) return rateFail();
      if (r.status !== 200) return otherFail(r.status, r.detail ?? "", `財務取得に失敗しました (${code})`);
      return NextResponse.json({ ok: true, status: "connected", fins: r.records });
    }

    // 上場銘柄マスタ（date 指定・全ページ収集）。
    if (action === "master") {
      const date = typeof body.date === "string" && body.date ? normDate(body.date) : undefined;
      const r = await fetchAllRows<V2MasterRecord>((pk) => buildMasterUrl({ date, paginationKey: pk }), apiKey);
      if (r.status === 401 || r.status === 403) return authFail(r.status, r.detail ?? "");
      if (r.status === 429) return rateFail();
      if (r.status !== 200) return otherFail(r.status, r.detail ?? "", "上場マスタ取得に失敗しました");
      return NextResponse.json({ ok: true, status: "connected", master: r.rows, pages: r.pages });
    }

    // 取引カレンダー（from/to・全ページ収集）。
    if (action === "calendar") {
      const from = typeof body.from === "string" && body.from ? body.from : undefined;
      const to = typeof body.to === "string" && body.to ? body.to : undefined;
      const r = await fetchAllRows<V2CalendarRecord>((pk) => buildCalendarUrl({ from, to, paginationKey: pk }), apiKey);
      if (r.status === 401 || r.status === 403) return authFail(r.status, r.detail ?? "");
      if (r.status === 429) return rateFail();
      if (r.status !== 200) return otherFail(r.status, r.detail ?? "", "取引カレンダー取得に失敗しました");
      return NextResponse.json({ ok: true, status: "connected", calendar: r.rows, pages: r.pages });
    }

    // 日付一括の全銘柄株価（code 省略）。カバレッジ外の date は終端へクランプして再試行。
    if (action === "bars-by-date") {
      const reqDate = typeof body.date === "string" && body.date ? normDate(body.date) : fmtDate(new Date());
      for (let attempt = 0; attempt < 2; attempt++) {
        const cov = getCoverageEnd();
        const date = cov && reqDate > cov ? cov : reqDate;
        const r = await fetchAllRows<V2DailyBar>((pk) => buildBarsByDateUrl({ date, paginationKey: pk }), apiKey);
        if (r.status === 401 || r.status === 403) return authFail(r.status, r.detail ?? "");
        if (r.status === 429) return rateFail();
        if (r.status === 200) {
          return NextResponse.json({ ok: true, status: "connected", bars: r.rows, pages: r.pages, date });
        }
        // サブスク範囲外を学習して 1 回だけ再クランプ。
        const range = r.status === 400 ? parseSubscriptionRange(r.detail ?? "") : null;
        if (range && getCoverageEnd() !== range.to) {
          coverageCache = { end: range.to, at: Date.now() };
          continue;
        }
        return otherFail(r.status, r.detail ?? "", `日付一括取得に失敗しました (${date})`);
      }
      return otherFail(400, "", "日付一括取得に失敗しました");
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
      const r = await collectBars(apiKey, code, from, to);
      if (r.status === 401 || r.status === 403) return authFail(r.status, r.detail ?? "");
      if (r.status === 429) return rateFail();
      if (r.status !== 200) return otherFail(r.status, r.detail ?? "", `系列取得に失敗しました (${code})`);
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
      const r = await collectBars(apiKey, code, from, to);
      if (r.status === 401 || r.status === 403) return authFail(r.status, r.detail ?? "");
      if (r.status === 429) return rateFail();
      if (r.status !== 200) continue; // その他失敗はスキップ（部分成功）
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
