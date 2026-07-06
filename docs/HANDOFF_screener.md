# ハンドオフ：東証全銘柄スクリーナー + JARVIS おすすめ Top10

> 本ドキュメントは全銘柄スクリーナー機能の**完了記録・設計判断・残課題台帳**。
> 次セッションはここを起点に残課題へ着手してよい。

## ステータス（クローズ・2026-07-06）
- 実装完了・実キーで完走確認済み（例: 「3752社中 上位50社／財務取得48・未取得2」）。
- 品質: `npm test` 235件 / `npm run build` / `npm run lint` すべて green。
- 該当コミット: `b603a57`〜`16eee89`（Stage 2–5 ＋ レート制限の網羅/堅牢化）。push 済み（`16eee89` まで）。

## 機能概要（データフロー）
`/screener` の「スクリーニング更新」で `runScreener()` が実行:
1. **probe**: `bars-by-date(today)` → route が終端クランプ → 最新取得可能日を検出（anchor）。
2. **universe**: `/equities/master` を anchor 日で取得 → `filterCommonStocks`（個別株のみ）。
3. **bars**: anchor から直近 40 営業日を **1 日ずつ全銘柄**取得（`fetchBarsBatch`）→ 調整後系列に集約。
4. **技術ランク**: 既存 `indicators`＋`scoreStock`（ファンダ null 安全）で技術スコア → `selectTopN(50)`。
5. **二段 fins**: 技術上位 **50 社のみ** `/fins/summary` → `computeFundamentals` → フルスコア/grade 再算出。
6. **確定**: `rankRows` → snapshot（`generatedAt`＋`universeCount`＋rows）を localStorage 永続化。
- 表示: `/screener`（全ランキング＋市場/セクター/評価/財務フィルタ）＋ ダッシュボード Top10 ウィジェット。両方に免責注記。

### 主なファイル
- `src/lib/screener/`: `universe.ts`（マスタ→UniverseEntry・個別株フィルタ・調整後系列）／`technical.ts`（合成Stock・技術スコア・ランク・再スコア）／`batch.ts`（universe/bars バッチ）／`fundamentalsProvider.ts`（再掲・pricing）／`screenerRun.ts`（オーケストレータ）／`screenerRepository.ts`（永続化）。
- `src/lib/pricing/`: `rateLimiter.ts`（クライアント共有）／`serverRateLimiter.ts`（サーバ側・APIキー単位）／`jquantsV2.ts`（master/bars-by-date URL・型）／`jquantsClient.ts`（`fetchJQuantsMaster`/`fetchJQuantsBarsByDate`）。
- `src/app/api/jquants/route.ts`: `action:"master"`/`"bars-by-date"`＋`jqFetch`（サーバ側リミッタ）。
- UI: `src/app/screener/page.tsx`／`src/components/ScreenerTop10Widget.tsx`／`Nav.tsx`。

## 設計判断（要約）
- **二段構え fins（上位50のみ）**: 全3900に fins は 5req/分で ~13時間で非現実的 → 技術粗選別後の 50 社のみ（~10分）。**限界**: ファンダ優良・技術中立な銘柄を取りこぼし得る（`technical.ts` 注記）。
- **調整後株価（AdjC/AdjVo）で指標算出**（分割・併合の影響除去）。
- **個別株フィルタ**: `ProdCat="011"（内国株券）` かつ `Mkt∈{0111,0112,0113}`。実測 master ~4450 件（ETF/REIT/外国含む）→ 個別株のみへ。opts で対象差し替え可。
- **カバレッジ・クランプ**: 無料プランは 12週前〜2年12週前。400 の subscription メッセージから終端を学習し**幅保持で終端へクランプ**（`jquantsV2.clampToCoverage`）。有料は today まで自然追随。
- **中断/破棄ポリシー**: probe/universe/bars の中断（auth/rate/aborted）→ **破棄**（不完全系列は指標不正確）。fins の auth/aborted → 破棄。**fins の rate/欠損 → 部分許容**（技術のみで残留・`fundamentalsAvailable=false`・snapshot は保存）。
- **レート制限の二段**: クライアント共有リミッタ（capacity=1・15s＝4req/分・バースト排除）＋ **サーバ側 APIキー単位リミッタ**（`/api/jquants` の `jqFetch`）で権威ある直列化。リロード/HMR/複数タブに耐性。
- **ROE=EPS/BPS 近似**（公表値と微差）。
- **キー**: `market-universe`/`screener-snapshot` を `KEY_REGISTRY` に登録（`excludeReason:"regenerable"`・K 経由）。

## 残課題台帳（未対応・優先度は低〜中）
| # | 区分 | 内容 | 記録元 | 推奨対応 |
|---|---|---|---|---|
| 1 | リミッタ | サーバレス**多重インスタンス**時はプロセス内枠が各インスタンス独立で 5req/分を超え得る | `serverRateLimiter.ts` 注記 | 単一インスタンス運用なら不要。水平スケール時は共有ストア（KV等）ベースのリミッタへ |
| 2 | 系列カバレッジ | 無料プランで BT 期間「3年/5年」は**開始日が範囲外→グレースフル失敗**（終端のみクランプ） | 会話 | 400 メッセージは開始/終端の両方を返す → **開始側もクランプ**する小改修 |
| 3 | バックテスト | `fetchJQuantsSeries` 共有リミッタ経由化で **BT 系列取得も 4req/分**（多数銘柄BTは低速・キャッシュヒットはスキップ） | 会話 | 429防止優先で許容。必要なら series 専用の緩い枠を検討 |
| 4 | 財務 | 四半期採用時の **TTM（直近4四半期）年換算**は未実装（現状 FY 優先で回避） | `fundamentals.ts` 注記 | 四半期主軸にする場合に TTM を実装 |
| 5 | 性能 | 初回全更新 **約23分**（92req÷4/分） | 会話 | 有料プラン移行で自然に短縮。無料は許容 |
| 6 | 品質 | 技術粗選別の取りこぼし（設計上の限界） | `technical.ts` 注記 | 上位カット数(50)を増やす等で調整可 |
| 7 | 未検証 | ダッシュボード **Top10 ウィジェット**は実機未確認（軽微・snapshot 読取りのみ） | 会話 | 次回ブラウザで一目確認 |

### スクリーナー範囲外（旧タスク・`HANDOFF_6-1.md` 記載）
- 6-2 `advisor-ai-mode` 旧キー廃止 / 6-3 `@supabase` 依存除去。

## 参照仕様（J-Quants V2・無料プランで確認済み）
- 認証: `x-api-key` ヘッダ（env `JQUANTS_API_KEY` 優先 → 設定画面 localStorage）。
- レート: Free = **5req/分**。無料データ範囲: 12週前〜2年12週前。
- 上場一覧: `/v2/equities/master`（pages=1・~4450件）。日付一括: `/v2/equities/bars/daily?date=`（code 省略で全銘柄・pages=1）。財務: `/v2/fins/summary`（code 指定）。
- 出典: jpx-jquants.com/ja/spec（eq-master・eq-bars-daily・fin-summary・rate-limits・data-spec・product-category・marketcode）。

## 品質状態（着手前の基準）
- テスト 235件・build・lint すべて green。作業ツリー clean・`16eee89` まで push 済み。
