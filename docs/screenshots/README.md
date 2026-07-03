# スクリーンショット撮影ガイド

README / Release Notes に掲載する主要画面のスクリーンショット置き場です。
実画像が未撮影の場合はプレースホルダ表記のままで問題ありません（配布ブロッカーではありません）。

## 保存場所とファイル名

このディレクトリ（`docs/screenshots/`）に、以下のファイル名で保存してください。

| ファイル名 | 画面 | 説明（キャプション） |
|---|---|---|
| `dashboard.png` | Dashboard | 資産状況・リスク・通知を一覧確認 |
| `stocks.png` | 銘柄管理 | 注目銘柄とスコアを管理 |
| `holdings.png` | 保有株 | 保有ポジションと損切り/利確を管理 |
| `report.png` | Report | 分析結果をPDF出力 |
| `backup.png` | Backup | 全データの保存・復元 |
| `help.png` | Help | 用語とJARVIS基準を確認 |
| `settings.png` | Settings | J-Quants・通知しきい値・パフォーマンス設定 |

## 撮影手順

1. サンプルデータを投入して画面を見栄えよくする
   - `設定` → 「サンプルデータ投入」を実行（未実装環境では銘柄・保有株を数件手動登録）
2. 開発サーバを起動
   ```bash
   npm run dev
   # → http://localhost:3000
   ```
3. 各画面を開き、ブラウザ幅を **1280px 程度**（デスクトップ表示）に調整
4. スクリーンショットを撮影
   - macOS: `⌘ + Shift + 4`（範囲選択）
   - Windows: `Win + Shift + S`
   - ブラウザ拡張やDevTools（`⌘/Ctrl + Shift + P` → "Capture screenshot"）でも可
5. 上表のファイル名で `docs/screenshots/` に保存

## 推奨事項

- 個人の資産額・実在銘柄・認証情報が映り込まないよう、サンプルデータで撮影してください。
- 横幅を揃える（例: 1280×任意高さ）と README での見栄えが整います。
- ダークテーマ（JARVIS/HUD）はそのままで問題ありません。
- モバイル表示も補足したい場合は `*-mobile.png` を追加してください（任意）。

## 反映

ファイルを置くと、README のスクリーンショット欄と Release Notes のリンクが自動的に画像を参照します
（Markdown 相対パス `docs/screenshots/<name>.png`）。画像が無い間はリンク切れ表示になりますが、
配布・動作には影響しません。
