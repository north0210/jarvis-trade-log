# ハンドオフ：任意6-1「キー参照化＋整合テスト」

> **✅ 完了（2026-07-05）** — 本方針に沿って実装済み。完了サマリーは末尾「## 完了記録」を参照。
> 以下の「承認済み方針」「着手前の品質状態」は着手時点の記録として保持する。

## 完了記録（2026-07-05）

**結果**: 全 localStorage キーの参照を中央レジストリ由来の名前付き定数 `K` に一元化。**実コードのキー文字列リテラル 0 件**（keys.ts 定義部とテスト期待値を除く）を達成。

### 成果サマリー
- **レジストリ**: `KEY_REGISTRY` に `refName`（安定識別子）を追加（A-1）。`backupKey` があればそれ、無ければ storageKey サフィックスの camelCase を**機械導出**。`K` は全エントリを refName から純粋導出（キー文字列リテラルは keys.ts のレジストリ1箇所のみ）。
- **後追い登録**: 棚卸し漏れの実キー `onboarding-done` を発見し、`includeInBackup:false / excludeReason:"transient"` で登録 → `K.onboardingDone` に変換。レジストリ総数 **45 → 46**（具体キー45 + 動的プレフィックス `price-cache:` 1）。
- **不変条件の遵守**: キー文字列は全て不変（リネーム・データ移行なし）。`includeInBackup`/`excludeReason` は無変更。バックアップ対象36キーは不変（backup-items/roundtrip テストで担保）。後方互換ロジック（`advisor-ai-mode`）・動的プレフィックス（`price-cache:` 末尾コロン込み）・機構本体（`BACKUP_ITEMS` 導出）は無変更。
- **セキュリティ**: jquants 系3キー（settings/status/token-cache）がバックアップに含まれないことを**負のアサーション**で固定。
- **循環参照**: `keys.ts` は leaf（import ゼロ）。`K` 参照追加は既存の依存方向（consumer → keys）を維持し循環なし。

### テスト
- `keys.test.ts` を新規追加（整合テスト）。スナップショット固定・プレフィックス検証・重複なし・refName 固定化・quirk 明示（`K.notifications`→notification-history / `K.watchlistEvents`→watchlist-detections）・動的合成健全性・セキュリティ除外。
- 件数推移: **43 → 82**（Vitest 4ファイル・全通過）。build / lint も green。

### refName の quirk（将来の読み手向け）
- `K.notifications` = `notification-history`（backupKey 由来）
- `K.watchlistEvents` = `watchlist-detections`（backupKey 由来）
- `K.priceCache` = `price-cache:`（**末尾コロン込み**の動的プレフィックス。`K.priceCache + code` で実キー生成）

### 残課題（6-1 範囲外・任意）
6-2 `advisor-ai-mode` 旧キー廃止 / 6-3 `@supabase` 依存除去 / その他は下記「未対応の任意項目」参照。

---

> 以下は**着手時点**の記録（承認済み方針・着手前品質状態）。

## 承認済み方針（変更不可の前提）

1. **テスト先行**：参照の付け替え前に「リテラル＝レジストリ一致」を保証する整合テストを追加する。
   - 追加先（案）：`src/lib/storage/keys.test.ts`
   - 検証内容：
     - `KEY_REGISTRY` の全 `storageKey` が `jarvis-trade-log:` プレフィックスを持つ
     - `storageKey` に重複がない
     - 実在キー集合（44実キー + `lastBackup` + `price-cache:` プレフィックス）を過不足なく網羅（期待リストとスナップショット一致）
   - 目的：以後キーが増減した際の即時検知（安全網を先に張る）。

2. **参照APIは (A) 名前付き定数を採用**（(B) `getStorageKey()` ヘルパーは不採用）。
   - `keys.ts` に用途別の名前付き定数（例：`export const K = { favorites: "jarvis-trade-log:favorites", ... }`）を用意し、各モジュールはそこを参照。
   - 型安全・IDE補完を優先。既存 `STORAGE_KEYS`（レガシー7キー）とは併存させる。
   - 参照元は `KEY_REGISTRY` と重複しないよう、可能なら `K` は `KEY_REGISTRY` から導出、または相互整合テストで一致を保証する。

3. **キー文字列は不変（リネーム禁止）**。
   - 付け替えは「同一文字列を別ソースから参照する」だけ。データ移行は発生させない。

4. **段階分割（一括変更禁止）**。
   - 1回のやり取りで 1〜数ファイルのみ置換。低リスクな単一キーのモジュールから着手（例：`tradingview.ts` の `tv-enabled`、`settings/performance.ts` の `performance-mode`）。
   - 各段階で `npm run build` + `npm test` を通し、変更ファイルと理由を報告してから次へ。
   - 途中中断しても常に build/lint/test が green を維持できる粒度で進める。

## 対象範囲・工数
- 対象：各 `src/lib/**` / 一部 `src/app/**` に散在するキーのリテラル（棚卸し済み・44ユニークキー）。
- 工数：L（40+ファイル）。段階的に消化する。

## 手順（次セッションの開始点）
1. `src/lib/storage/keys.test.ts` を追加（上記整合テスト）→ `npm test` green を確認。
2. `keys.ts` に名前付き定数 `K`（用途別）を追加（`KEY_REGISTRY` と整合）。
3. 低リスク1ファイルから参照付け替え → build/test → 報告 → 承認 → 次ファイル。

## 着手前の品質状態（v1.7.0 時点）
- バージョン：`1.7.0`（`package.json` / `src/lib/version.ts` 一致）。タグ `v1.7.0` 付与済み（ローカル）。
- ビルド：`npm run build` 成功（37静的ページ + 2 API `jquants` / `ai-comment`）。
- Lint：`npm run lint` エラーゼロ。
- テスト：`npm test`（Vitest）43件全通過。
  - `src/lib/alerts.test.ts`（28）：アラート判定の境界値（損切りライン丁度 / +3%丁度 / RSI=80 / -5% / +20% / null・0除算）。
  - `src/lib/backup/backup-items.test.ts`（8）：BACKUP_ITEMS 導出の固定化（旧32+追加4＝36）＋レジストリ整合。
  - `src/lib/backup/backup-roundtrip.test.ts`（7・happy-dom）：36キー往復一致＋異常系（破損/別app/版超過/checksum改竄）。
- 保存方式：完全ローカル（localStorage）。Supabase はレガシー・未使用（`src/lib/supabase.ts` / `supabase/` / `@supabase/supabase-js` は温存）。
- キー管理：`src/lib/storage/keys.ts` の `KEY_REGISTRY` が全キーの中央レジストリ。バックアップ対象（`BACKUP_KEY_DEFS`）はここから導出。除外キーには `excludeReason`（security / regenerable / transient / redundant / meta）を明記。
- CI：`.github/workflows/ci.yml`（main への push / main 向け PR で build+lint+test、npmキャッシュ有効、タグpush除外）。

## 既知の乖離・注意（記録）
- **STOP_NEAR は「現在価格基準」** `(price - stop) / price <= 0.03`（損切りライン基準ではない）。v1.7.0では実装を正としてテスト固定・文書整合済み。将来「損切りライン基準」へ変える場合は発火数が変わる（`src/lib/alerts.ts` 冒頭コメント参照）。
- `advisor-ai-mode` は `ai-config` に統合済みの旧キー（後方互換で残存・バックアップ対象外）。
- リモート push は環境制約によりユーザーのターミナルで実施（`git push origin main` / `git push origin v1.7.0`）。

## 未対応の任意項目（参考）
- 6-2 `advisor-ai-mode` 整理 / 6-3 `@supabase` 依存除去（要影響確認）/ 6-4 実スクリーンショット / v1.8（Worker化・sharedCache・スコア推移・MissingData専用ページ）。
