# CLAUDE.md — JARVIS Trade Log プロジェクトメモリ

セッション開始時に自動読込される恒久ルール。指示書で繰り返す文脈をここに集約する。

## 1. プロジェクト概要
- JARVIS Trade Log は日本株の売買**判断を補助**する個人用ローカルアプリ（保有・取引・戦略・スクリーナー・シグナルを一元管理）。
- あくまで判断補助であり**投資助言ではない**。数値パラメータの初期値は比較検証用で推奨値ではない（UI に `PARAM_DISCLAIMER` を明記）。
- ペーパートレードは**仮想**。実発注は一切行わない（手数料・スプレッド 0 円と仮定した模倣）。

## 2. 絶対規則（違反禁止）
- **非破壊**: 既存の動作・データ・公開ロジックを壊さない。勝手なリファクタ・スコープ拡大は禁止。
- **K レジストリ経由**: localStorage は `K`（`src/lib/storage/keys.ts`）経由でのみ参照。実キー直書き・キーのリネームは禁止（データ消失リスク）。
- **抽象層を迂回しない**: 価格取得は `getPriceProvider()`（`src/lib/pricing/provider.ts`）、永続化は各 `*Repository` 経由。内部実装を直接叩かない。
- **戦略・約定ロジックは純関数**: `src/lib/strategy/`・`src/lib/paper/`・`src/lib/backtest/` は副作用なし。時刻・取得・永続化は呼び出し側から注入する。
- **APIキーをコード・ログ・テストに書かない**（機微情報の外部流出防止）。
- **各 Task 完了ごとに diff を提示して停止し、承認を待つ**。コミットは承認後のみ。

## 3. 技術スタック・環境
- Next.js（App Router）/ TypeScript / Tailwind。データ層は React + `@supabase/supabase-js`（ローカル localStorage 中心）。
- テスト: Vitest。CLI: `scripts/sweep.ts`（`npm run sweep -- ...`、`vite-node`）。
- 常駐: launchd（`com.jarvis.tradelog`・port 3000）。**redeploy** = `npm run redeploy`（`next build` → `launchctl kickstart`）。
- 価格データ: **J-Quants V2 Light**。`x-api-key` 方式。当日終値は **16:30 配信**（`PUBLISH_TIME_JST` + 60分バッファ）以降取得可。取得窓は5年。
- レート制限: トークンバケット（`serverRateLimiter.ts`）。実効 **約30req/分**（`JQUANTS_EFFECTIVE_RPM` = `60000 / JQUANTS_RATE_REFILL_MS(2000ms)`）。※ provider.ts の「5req/分」コメントは旧記述。

## 4. 主要モジュールの地図
- `src/lib/pricing/calendar.ts` — 取引カレンダーから `expectedAsOf`（期待最新データ日）と鮮度判定。プラン差分は `EXPECTED_LAG_TRADING_DAYS`（Light=0）で一元制御。
- `src/lib/pricing/provider.ts` — `PriceProvider` 抽象（Manual / JQuantsV2）。`fetchQuotes`（読取・fallback）/ `fetchQuotesBulk`（更新・レート制限・進捗・中断）。
- `src/lib/strategy/` — 3戦略（純関数）: A トレンドフォロー / B 押し目逆張り / C 相対力モメンタム。共通 IF は `signalStrategy.ts` の `TradingStrategy`。
- `src/lib/paper/` — ペーパーブローカー（`paperBroker.ts`・仮想約定/ポジション/損益・現金ガード・ハードリミット/キルスイッチ）、日次シグナル生成（`signalEngine.ts` / `runSignalEngine.ts`）、注文キュー永続化（`signalEngineRepository.ts`・K 経由）。
- `src/lib/backtest/` — `signalSimulator.ts`（TradingStrategy を系列駆動する非破壊シミュレータ）、`strategy-batch.ts`。CLI スイープは `scripts/sweep.ts`。
- `src/lib/storage/keys.ts` — **K レジストリ**（全 localStorage キーの単一の真実）。`STORAGE_KEYS` / `KEY_REGISTRY` / `K` / バックアップ対象導出。
- 執行モデル（paper と backtest で共通）: シグナルは当日終値（調整後）確定後に生成 → 約定は**翌営業日始値**（無ければ代用約定 or 失効）。

## 5. 検証ゲート（完了条件）
- `npm test` / `npm run lint` / `npm run build` がすべて green で完了とみなす。
- `tsc --noEmit` の既存エラー **8件は既知**（テストフィクスチャ由来: priceUpdater/provider/screener 各テスト）。対応不要。**8件を超えたら**新規混入なので調査する。

## 6. 作業フロー
- コミットは**承認後**のみ。`push` はボスまたは明示指示があるときだけ。
- コミットには `Co-Authored-By` を付与する。
- Task 単位で diff を提示し停止 → 承認 → コミット、を厳守。
