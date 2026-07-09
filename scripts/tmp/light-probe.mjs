/**
 * Light 昇格 Stage 0+1 検証（一時スクリプト・レビュー後も保持）。
 *
 * 鍵は process.env.JQUANTS_API_KEY（既存のサーバ側 env 参照経路）から読む。
 * ★ 鍵は絶対に出力しない（x-api-key ヘッダに載せるのみ）。URL にも鍵は含まれない。
 *
 * 実行（ボスのターミナル。鍵はこのスクリプト・ログに書かない）:
 *   export JQUANTS_API_KEY='＜Light の APIキー＞'
 *   node scripts/tmp/light-probe.mjs
 *
 * 記録される情報: 各コールの HTTP status / 返却件数 / 返却データの最新日付 /
 *   pagination 有無 / エラー時は本文メッセージ（先頭200字・鍵は含まれない）。
 */

const KEY = process.env.JQUANTS_API_KEY;
if (!KEY || !KEY.trim()) {
  console.error("JQUANTS_API_KEY 未設定。`export JQUANTS_API_KEY='...'` を実行してから再実行してください。");
  process.exit(2);
}

const BASE = "https://api.jquants.com/v2";
const CODE = "7203"; // トヨタ（代表的な流動銘柄）
const HDR = { "x-api-key": KEY };

/** daily_quotes を code+date で1回コール（鍵は出力しない）。 */
async function call(label, date) {
  const q = new URLSearchParams({ code: CODE, date });
  const url = `${BASE}/equities/bars/daily?${q.toString()}`; // 鍵は含まれない
  let status = 0;
  let body = null;
  try {
    const res = await fetch(url, { headers: HDR });
    status = res.status;
    try { body = await res.json(); } catch { body = null; }
  } catch (e) {
    console.log(JSON.stringify({ label, date, error: `fetch失敗: ${String(e).slice(0, 120)}` }));
    return { status: 0, count: 0, latest: null };
  }
  const data = Array.isArray(body?.data) ? body.data : [];
  const dates = data.map((d) => d.Date).filter(Boolean).sort();
  const latest = dates.length ? dates[dates.length - 1] : null;
  const out = { label, reqDate: date, http: status, count: data.length, latest, pagination: !!body?.pagination_key };
  if (status < 200 || status >= 300) {
    out.error = String(body?.message ?? (body ? JSON.stringify(body) : "")).slice(0, 200);
  }
  console.log(JSON.stringify(out));
  return { status, count: data.length, latest, error: out.error };
}

const results = [];

console.log("== Task 1-1: 疎通 / 鮮度(12週内) / 5年境界 ==");
// 1-1a: 直近営業日（本日 2026-07-09 木 と 前営業日 07-08 水）
results.push(await call("1-1a today 2026-07-09", "2026-07-09"));
results.push(await call("1-1a prev  2026-07-08", "2026-07-08"));
// 1-1b: 12週間より新しい日付（Free では 400 だった範囲）
results.push(await call("1-1b fresh 2026-06-01", "2026-06-01"));
// 1-1c: 約5年前（Light の 5年履歴確認）
results.push(await call("1-1c 5yago 2021-08-02", "2021-08-02"));

// 認証エラーで即停止
for (const r of results) {
  if (r.status === 401 || r.status === 403) {
    console.error(`\n★停止: 認証エラー ${r.status}。メッセージ: ${r.error ?? "(なし)"}`);
    process.exit(3);
  }
}

console.log("\n== Task 1-2: レート（10連続コール・429 検出。60回まで攻めない）==");
const statuses = [];
let got429 = 0;
const t0 = Date.now();
for (let i = 0; i < 10; i++) {
  const day = `2026-06-${String((i % 9) + 1).padStart(2, "0")}`; // 06-01〜06-09
  const q = new URLSearchParams({ code: CODE, date: day });
  let st = 0;
  try {
    const res = await fetch(`${BASE}/equities/bars/daily?${q.toString()}`, { headers: HDR });
    st = res.status;
    await res.text().catch(() => {}); // 本文破棄
  } catch (e) {
    st = -1;
  }
  statuses.push(st);
  if (st === 429) got429++;
}
const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);
console.log(JSON.stringify({ statuses, got429, elapsedSec: Number(elapsedS) }));
console.log(got429 > 0 ? `⚠ 429 が ${got429} 回（レート制限に当たった）` : "✓ 10 連続で 429 なし");

console.log("\n== まとめ ==");
console.log(JSON.stringify({
  authOk: results.every((r) => r.status !== 401 && r.status !== 403),
  freshOk: (results[2]?.status === 200 && results[2]?.count > 0), // 1-1b 12週内が取れたか
  fiveYearOk: (results[3]?.status === 200 && results[3]?.count > 0),
  latestAvailable: results.find((r) => r.count > 0)?.latest ?? null,
  rate429: got429,
}));
