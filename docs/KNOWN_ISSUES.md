# 残課題台帳（Known Issues）

本アプリの既知の未修理項目を記録する。修正時は該当行を削除し、必要なら CHANGELOG に反映する。

## TS-001: テストフィクスチャ由来の `tsc --noEmit` 型エラー 8件

- **検出**: Phase 1 / Task 0（2026-07-13）。`npx vitest run` は全 green（309 passed）だが、`npx tsc --noEmit` がテストファイルのフィクスチャで 8 件の型エラーを出す。
- **影響**: 実行時・ビルドへの影響なし（vitest はトランスパイル実行のため通る）。型定義とテスト用ダミーデータの乖離が原因。CI で `tsc` を必須ゲートにする場合は要修正。
- **方針**: Task 0 の修正対象外（既存事象）。将来まとめてフィクスチャを型に追従させる。
- **該当箇所**（`ファイル:行` — 概要）:
  1. `src/lib/pricing/priceUpdater.test.ts:34` — TS2352: ダミー `Stock` の `status:"watch"` が `StockStatus` に非適合。
  2. `src/lib/pricing/priceUpdater.test.ts:58` — TS2322: `macd:"GC"` が `MacdState` に非代入可能。
  3. `src/lib/pricing/provider.test.ts:19` — TS2352: ダミー `Stock` の `status:"watch"` が `StockStatus` に非適合。
  4. `src/lib/screener/screenerAuto.test.ts:134` — TS2352: `h.run.mock.calls[0][1]`（`undefined`）への型アサーション。
  5. `src/lib/screener/screenerAuto.test.ts:134` — TS2493: 長さ 0 のタプルに index 1 でアクセス。
  6. `src/lib/screener/screenerRepository.test.ts:17` — TS2739: ダミー `UniverseEntry` に `marketCode` / `prodCategory` が欠落。
  7. `src/lib/screener/screenerRun.test.ts:4` — TS2307: `./fundamentalsProvider` を解決できない（import パス）。
  8. `src/lib/screener/technical.test.ts:7` — TS2322: ダミー `UniverseEntry` の `marketCode?:string|undefined` が必須 `string` に非適合。
