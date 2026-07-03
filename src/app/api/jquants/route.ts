/**
 * J-Quants API Route Handler（サーバ側）。
 *
 * フロントから直接 J-Quants を叩かず、この Route を経由する（CORS回避・認証情報の秘匿）。
 *
 * 認証情報の優先順位（重要）:
 *   1. 環境変数 JQUANTS_EMAIL / JQUANTS_PASSWORD（本番推奨・サーバ側のみ）
 *   2. リクエストボディの credentials（localStorage 由来・個人ローカルMVP）
 *   env が設定されていれば localStorage 由来より優先する。
 *
 * トークンキャッシュ:
 *   body.idToken が渡された場合はそれを使用（再認証を省略）。
 *   期限切れ（401）を検知した場合のみ creds で再認証し、新トークンを token として返す。
 *   → クライアントは受け取った token を localStorage にキャッシュする。
 *
 * ※ 認証情報の直書きは禁止。env 未設定でも build/lint は通る（実行時のみ参照）。
 *
 * body: { action: "test"|"quotes", codes?: string[], credentials?: {email,password}, idToken?: string }
 */
import { NextResponse } from "next/server";

const BASE = "https://api.jquants.com/v1";

interface Creds {
  email: string;
  password: string;
}

interface Tokens {
  idToken: string;
  refreshToken: string;
}

interface RequestBody {
  action?: string;
  codes?: unknown;
  credentials?: { email?: string; password?: string };
  idToken?: string;
  code?: string; // series 用
  from?: string; // series 用 YYYY-MM-DD
  to?: string; // series 用 YYYY-MM-DD
}

interface DailyQuote {
  Date?: string;
  Close?: number | null;
  AdjustmentClose?: number | null;
  Volume?: number | null;
}

/** env 優先で認証情報を解決する。 */
function resolveCreds(bodyCred?: RequestBody["credentials"]): Creds | null {
  const email = process.env.JQUANTS_EMAIL || bodyCred?.email;
  const password = process.env.JQUANTS_PASSWORD || bodyCred?.password;
  if (email && password) return { email, password };
  return null;
}

/** 銘柄コードを J-Quants 形式（5桁）へ変換する（4桁 → 末尾0付与）。 */
function toJQuantsCode(code: string): string {
  const c = code.trim();
  return c.length === 4 ? `${c}0` : c;
}

/** refresh token → id token を取得する。 */
async function getTokens(c: Creds): Promise<Tokens> {
  const authRes = await fetch(`${BASE}/token/auth_user`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mailaddress: c.email, password: c.password }),
  });
  if (!authRes.ok) throw new Error(`認証失敗 (auth_user: ${authRes.status})`);
  const authJson = (await authRes.json()) as { refreshToken?: string };
  if (!authJson.refreshToken) throw new Error("refreshToken を取得できませんでした");

  const refRes = await fetch(
    `${BASE}/token/auth_refresh?refreshtoken=${encodeURIComponent(authJson.refreshToken)}`,
    { method: "POST" }
  );
  if (!refRes.ok) throw new Error(`認証失敗 (auth_refresh: ${refRes.status})`);
  const refJson = (await refRes.json()) as { idToken?: string };
  if (!refJson.idToken) throw new Error("idToken を取得できませんでした");
  return { idToken: refJson.idToken, refreshToken: authJson.refreshToken };
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/** 単一銘柄の最新クオートを取得する。HTTP status も返し 401/429 を上位で判定する。 */
async function fetchQuote(idToken: string, code: string) {
  const to = new Date();
  const from = new Date(to.getTime() - 120 * 24 * 60 * 60 * 1000);
  const url =
    `${BASE}/prices/daily_quotes?code=${encodeURIComponent(toJQuantsCode(code))}` +
    `&from=${fmtDate(from)}&to=${fmtDate(to)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!res.ok) return { status: res.status, quote: null };

  const data = (await res.json()) as { daily_quotes?: DailyQuote[] };
  const arr = Array.isArray(data.daily_quotes) ? data.daily_quotes : [];
  // TODO: pagination_key 対応（長期履歴銘柄）
  if (arr.length === 0) return { status: 200, quote: null };

  const latest = arr[arr.length - 1];
  const prev = arr.length >= 2 ? arr[arr.length - 2] : null;
  const close = latest.Close ?? latest.AdjustmentClose ?? null;
  const prevClose = prev ? (prev.Close ?? prev.AdjustmentClose ?? null) : null;
  const change = close != null && prevClose != null ? close - prevClose : null;
  const changeRate = change != null && prevClose ? (change / prevClose) * 100 : null;

  const closes = arr
    .map((d) => d.Close ?? d.AdjustmentClose ?? null)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const volumes = arr
    .map((d) => d.Volume ?? null)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  return {
    status: 200,
    quote: {
      code,
      current_price: close,
      previous_close: prevClose,
      change,
      change_rate: changeRate,
      volume: latest.Volume ?? null,
      date: latest.Date ?? null,
      closes, // RSI 算出に使用（Provider 側で計算）
      volumes, // 出来高指標算出に使用（Phase 42）
    },
  };
}

/** 期間指定の日足系列を pagination 対応で取得する。 */
async function fetchSeries(idToken: string, code: string, from: string, to: string) {
  const base =
    `${BASE}/prices/daily_quotes?code=${encodeURIComponent(toJQuantsCode(code))}&from=${from}&to=${to}`;
  const rows: DailyQuote[] = [];
  let key: string | undefined;
  let guard = 0;
  do {
    const url = key ? `${base}&pagination_key=${encodeURIComponent(key)}` : base;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return { status: res.status, series: null as null | SeriesPoint[] };
    const data = (await res.json()) as { daily_quotes?: DailyQuote[]; pagination_key?: string };
    if (Array.isArray(data.daily_quotes)) rows.push(...data.daily_quotes);
    key = data.pagination_key;
    guard++;
  } while (key && guard < 100); // 安全弁

  const series: SeriesPoint[] = rows
    .map((d) => ({
      date: d.Date ?? "",
      close: d.Close ?? d.AdjustmentClose ?? null,
      adjClose: d.AdjustmentClose ?? null,
      volume: d.Volume ?? null,
    }))
    .filter((x) => x.date && x.close != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { status: 200, series };
}

interface SeriesPoint {
  date: string;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
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
  const creds = resolveCreds(body.credentials);

  try {
    // 接続テスト: 認証のみ実施し新トークンを返す。
    if (action === "test") {
      if (!creds) {
        return NextResponse.json({
          ok: false,
          status: "unset",
          message: "認証情報が未設定です（env または設定画面で入力してください）",
        });
      }
      const t = await getTokens(creds);
      return NextResponse.json({ ok: true, status: "connected", message: "接続成功", token: t });
    }

    // 価格取得
    let idToken = typeof body.idToken === "string" && body.idToken ? body.idToken : null;
    let freshToken: Tokens | null = null;

    if (!idToken) {
      if (!creds) {
        return NextResponse.json({
          ok: false,
          status: "unset",
          message: "認証情報が未設定です（env または設定画面で入力してください）",
        });
      }
      const t = await getTokens(creds);
      idToken = t.idToken;
      freshToken = t;
    }

    // 日足系列（pagination）
    if (action === "series") {
      const code = typeof body.code === "string" ? body.code : "";
      const from = typeof body.from === "string" ? body.from : fmtDate(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
      const to = typeof body.to === "string" ? body.to : fmtDate(new Date());
      if (!code)
        return NextResponse.json({ ok: false, status: "error", message: "code が必要です", token: freshToken ?? undefined });
      let r = await fetchSeries(idToken, code, from, to);
      if (r.status === 401 && creds) {
        const t = await getTokens(creds);
        idToken = t.idToken;
        freshToken = t;
        r = await fetchSeries(idToken, code, from, to);
      }
      if (r.status === 429)
        return NextResponse.json({ ok: false, status: "error", message: "レート制限に達しました。時間をおいて再試行してください。", token: freshToken ?? undefined });
      if (!r.series)
        return NextResponse.json({ ok: false, status: "error", message: `系列取得に失敗しました (${code}: ${r.status})`, token: freshToken ?? undefined });
      return NextResponse.json({ ok: true, status: "connected", series: r.series, token: freshToken ?? undefined });
    }

    const codes = Array.isArray(body.codes)
      ? body.codes.filter((x): x is string => typeof x === "string")
      : [];

    const quotes = [];
    let reAuthed = false;
    let rateLimited = false;

    for (const code of codes) {
      let r = await fetchQuote(idToken, code);

      // idToken 期限切れ（401）は creds で一度だけ再認証してリトライ
      if (r.status === 401) {
        if (!creds) {
          return NextResponse.json({
            ok: false,
            status: "error",
            message: "認証トークンが期限切れです。設定画面で認証情報を入力してください。",
          });
        }
        if (!reAuthed) {
          const t = await getTokens(creds);
          idToken = t.idToken;
          freshToken = t;
          reAuthed = true;
          r = await fetchQuote(idToken, code);
        }
      }

      // レート制限は処理を停止してメッセージを返す
      if (r.status === 429) {
        rateLimited = true;
        break;
      }

      if (r.quote) quotes.push(r.quote);
      // それ以外の失敗銘柄はスキップ（部分成功を許容）
    }

    if (rateLimited) {
      return NextResponse.json({
        ok: false,
        status: "error",
        message: "レート制限に達しました。時間をおいて再試行してください。",
        token: freshToken ?? undefined,
      });
    }

    return NextResponse.json({
      ok: true,
      status: "connected",
      quotes,
      token: freshToken ?? undefined,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
