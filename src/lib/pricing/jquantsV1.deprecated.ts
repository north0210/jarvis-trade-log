/**
 * @deprecated V1 認証フロー（email/password → refreshToken → idToken）。
 *
 * 2025-12-22 以降の新規登録者は V2（APIキー方式）のみ利用可能で、V1 は廃止された。
 * 本モジュールは **非破壊のため残置**するだけで、現在どこからも import されない
 * （実運用の認証は route.ts が jquantsV2 の APIキー方式で行う）。
 *
 * 既存ユーザーの V1 資産（auth_user / auth_refresh の実装）を参照可能にしておく目的。
 */

export const JQUANTS_V1_BASE = "https://api.jquants.com/v1";

export interface V1Creds {
  email: string;
  password: string;
}

export interface V1Tokens {
  idToken: string;
  refreshToken: string;
}

/**
 * @deprecated refresh token → id token を取得する（V1）。V2 では不要。
 */
export async function getTokensV1(c: V1Creds): Promise<V1Tokens> {
  const authRes = await fetch(`${JQUANTS_V1_BASE}/token/auth_user`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mailaddress: c.email, password: c.password }),
  });
  if (!authRes.ok) throw new Error(`認証失敗 (auth_user: ${authRes.status})`);
  const authJson = (await authRes.json()) as { refreshToken?: string };
  if (!authJson.refreshToken) throw new Error("refreshToken を取得できませんでした");

  const refRes = await fetch(
    `${JQUANTS_V1_BASE}/token/auth_refresh?refreshtoken=${encodeURIComponent(authJson.refreshToken)}`,
    { method: "POST" }
  );
  if (!refRes.ok) throw new Error(`認証失敗 (auth_refresh: ${refRes.status})`);
  const refJson = (await refRes.json()) as { idToken?: string };
  if (!refJson.idToken) throw new Error("idToken を取得できませんでした");
  return { idToken: refJson.idToken, refreshToken: authJson.refreshToken };
}
