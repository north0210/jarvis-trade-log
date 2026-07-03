# JARVIS Trade Log v1.6.0

個人用の株式運用管理コンソール。**Next.js 14 (App Router) + TypeScript + Tailwind CSS**。
データはすべてブラウザの **localStorage** に保存され、完全ローカルで動作します（サーバへ売買データを送信しません）。黒背景＋シアングローの「JARVIS / HUD」デザイン。

> ⚠️ **免責事項**：本アプリの分析結果は投資判断の**補助**であり、売買を推奨するものではありません。最終判断はユーザー自身で行ってください。本アプリは自動売買を行いません。

## 方針

**完全ローカル運用を基本とし、外部サービスへ売買データを送信しません。**
データは端末内（localStorage）のみに保存します。
変更履歴は [CHANGELOG.md](./CHANGELOG.md)、詳細は [docs/RELEASE_NOTES_v1.0.0.md](./docs/RELEASE_NOTES_v1.0.0.md) を参照。

**実装しない（ロードマップから除外）**
- RSSニュース / ニュース分析 / 外部ニュース取得
- LINE通知 / LINE Messaging API

**AIコメント（v1.6 External AI Layer・実装済み）**
- Advisor / Risk / Portfolio / Dashboard / Watchlist / Report / Backtest / MonteCarlo に判断補助コメントを生成。
- Provider: OFF（既定）/ Template（ローカル生成）/ OpenAI / Claude / Gemini / Local LLM。
- APIキーはユーザー管理・localStorageのみ。**初期値OFF**。未設定・エラー・CORS・タイムアウト（20秒）時は **Template へ自動フォールバック**（動作停止なし）。
- 自動売買ではなく**判断補助**。断定・未来予測はせず、**投資助言ではありません**。

```bash
# タグ付け（リリース確定時）
git tag v1.6.0
git push origin v1.6.0
```

## Roadmap

RSS・ニュース・LINE・SNS・注文送信・自動売買・証券口座連携は方針として**実装しません**。

- **v1.5 正式版** — 全銘柄BT → Advisor 個別評価本接続、AIコメント基盤（済）
- **v1.6 External AI Layer** — Advisor/Risk/Portfolio/Watchlist/Report 等へAIコメント生成。任意・**初期値OFF**・APIキーはユーザー管理・未設定時は **Template へ自動フォールバック**
- **v1.7 Worker化** — MC/BT/監視のバックグラウンド計算・共有キャッシュ
- **v1.8 時系列ファンダBT** — エントリー時点の実ファンダでバックテスト
- **v2.0 JARVIS Quant Terminal** — 統合ターミナル化

> JARVIS Advisor は Score/Risk/出来高/Strategy/Backtest/MonteCarlo/規律／**個別銘柄BT**を統合し、
> 「Strong Buy／Buy／Watch／Hold／一部利確／Reduce／売却候補／Danger／見送り」を**根拠つきで提示**する
> 判断補助機能です。自動売買・証券口座連携は行わず、売買を断定せず、**投資助言ではありません**。

---

## 1. アプリ概要

- 銘柄・保有株・取引・運用日誌を手元で一元管理
- JARVIS Score／Adaptive Score による銘柄採点
- リスク（VaR/CVaR/破産確率）・モンテカルロ・バックテスト・ファクター分析
- 戦略テンプレート／戦略バックテスト／ランキング履歴
- マーケットレーダー・セクターヒートマップ・出来高分析
- 投資レポート（PDF出力）・レポート履歴・通知・通知しきい値
- バックアップ／復元（世代管理・部分復元・破損検知）
- 用語ツールチップ・操作ガイド（/help）

## 2. 主な機能

| 領域 | 画面 |
|---|---|
| 基本 | ダッシュボード / 銘柄管理 / 保有株 / 運用日誌 |
| 分析 | PF分析 / 試算 / 比較 / リスク / 要因(Factor) / モンテカルロ / 検証(Backtest) / 実証(価格系列) / 市況(Radar) / セクター / 心理(Mental) / 適応スコア |
| 戦略 | 戦略テンプレート / ルール改善 / 一括バックテスト / ランキング履歴 / リバランス調整 / 規律チェック / 取引履歴 |
| レポート | レポート(PDF) / レポート履歴 / 通知 |
| 設定・保守 | 使い方ガイド / バックアップ/復元 / 設定 |

## 3. セットアップ手順

前提：Node.js 18+ / npm。

```bash
# 1. 依存関係のインストール
npm install

# 2.（任意）本番ビルド確認
npm run build   # 環境変数なしでも成功します（完全ローカル）
npm run lint
```

環境変数は基本的に不要です。J-Quants / LLM を使う場合のみ、後述の設定を行います（**APIキーはサーバ環境変数のみ**で扱い、ハードコードや localStorage には保存しません）。

## 4. 起動方法

```bash
npm run dev
# → http://localhost:3000
```

初回起動時、ダッシュボード上部に **免責同意** と **リリース前チェックリスト** が表示されます。同意後、案内に沿って初期確認を進めてください。

## 5. J-Quants設定方法

株価・出来高の自動取得を使う場合（任意）。

1. [J-Quants](https://jpx-jquants.com/) でアカウントを作成
2. `設定` 画面 → 価格プロバイダを **J-Quants** に切替
3. メールアドレス／パスワードを入力し「接続テスト」
4. 成功後、`銘柄管理` の「価格更新」で一括取得（RSI・出来高も自動算出）

- サーバ環境変数（`JQUANTS_EMAIL` / `JQUANTS_PASSWORD`）が設定されている場合はそちらが優先されます。
- 429（レート制限）時は取得を停止します。時間をおいて再試行してください。

## 6. バックアップ方法

- `設定` → 「エクスポート（JSON保存）」で全データを1ファイルに保存、または
- `バックアップ/復元` 画面 → 「全データを書き出し」で **v2フル形式**（checksum付き）を保存
- 復元・上書きの前には自動で**退避バックアップ**（直近3世代）を作成します

推奨：定期的に外部ファイルへ書き出し（localStorage はブラウザ消去で失われます）。

## 7. 復元方法

`バックアップ/復元` 画面：

1. 「バックアップを読み込む」でJSONを選択 → **破損チェック**（形式/バージョン/checksum）
2. **復元前プレビュー**（現在 ⇔ バックアップの件数差）を確認
3. **部分復元**（銘柄/保有株/運用日誌/取引/戦略/レポート/通知/設定の単位）または全復元
4. 復元後は画面を再読み込みしてください

## 8. 注意事項

- データはブラウザ内（localStorage）にのみ保存されます。**別ブラウザ・別端末とは共有されません**。
- ブラウザのデータ消去・シークレットモードでデータが失われます。定期バックアップ推奨。
- J-Quants認証情報はブラウザに保存されるため、**共用端末での利用は避けてください**。
- 分析値は登録データ量に依存します。少額・少数データ時の確率/グレードは参考値です。

## 9. 免責事項

本アプリの分析結果は投資判断の**補助**であり、売買を推奨するものではありません。
将来の成果を保証するものではなく、バックテスト等の過去実績は将来を保証しません。
**投資は自己責任**で行い、最終判断はユーザー自身で行ってください。本アプリは自動売買を行いません。

## 10. トラブルシューティング

| 症状 | 対処 |
|---|---|
| 画面が真っ白になる | localStorage破損の可能性。`バックアップ/復元` 画面から復元、または `設定`→全データ削除後に再投入。 |
| J-Quantsが動かない | 認証情報・プラン・API制限（429）を確認。`設定`で接続テスト。 |
| 通知が来ない | ブラウザの通知許可、`設定`の通知ON、`通知しきい値`を確認。 |
| 分析値が出ない | 銘柄・現在価格・保有株・取引データの登録有無を確認（空データ時は案内を表示）。 |
| 動作が重い | `設定`→パフォーマンスを **Fast** に変更（モンテカルロ回数を抑制）。 |

---

## スクリーンショット

> 実画像は各自の環境で取得してください（未撮影の間は画像リンクが切れて見えますが、動作には影響しません）。
> 撮影手順・ファイル名は [docs/screenshots/README.md](./docs/screenshots/README.md) を参照。

| 画面 | プレビュー | 説明 |
|---|---|---|
| Dashboard | ![Dashboard](./docs/screenshots/dashboard.png) | 資産状況・リスク・通知を一覧確認 |
| 銘柄管理 | ![Stocks](./docs/screenshots/stocks.png) | 注目銘柄とスコアを管理 |
| 保有株 | ![Holdings](./docs/screenshots/holdings.png) | 保有ポジションと損切り/利確を管理 |
| Report | ![Report](./docs/screenshots/report.png) | 分析結果をPDF出力 |
| Backup | ![Backup](./docs/screenshots/backup.png) | 全データの保存・復元 |
| Help | ![Help](./docs/screenshots/help.png) | 用語とJARVIS基準を確認 |
| Settings | ![Settings](./docs/screenshots/settings.png) | J-Quants・通知しきい値・パフォーマンス設定 |

## 構成（主要）

| パス | 役割 |
|---|---|
| `src/app/` | 各画面（App Router） |
| `src/components/` | 共通UI（Nav / HelpTooltip / Disclaimer / ReleaseChecklist 等） |
| `src/lib/` | 分析エンジン・Repository・設定（完全ローカル） |
| `src/lib/alerts.ts` | アラート判定ロジック（純関数・UIから独立） |
| `src/lib/pricing/provider.ts` | 価格取得層（J-Quants接続はここ経由） |
| `src/app/api/jquants` | J-Quants Route Handler（env優先・任意） |
| `src/app/api/ai-comment` | LLMコメント Route Handler（env優先・任意・ローカルfallback） |

## スクリプト

```bash
npm run dev     # 開発サーバ
npm run build   # 本番ビルド（環境変数なしで成功）
npm run lint    # ESLint（エラーゼロ）
npm run start   # 本番起動
```

## アラート仕様（参考）

- 現在価格が損切りライン以下 → 損切り到達（赤）
- 現在価格が損切りラインの +3% 以内 → 損切り接近（赤）
- RSI ≥ 80 → 過熱警告（橙）
- 損益率 ≤ -5% → 危険（赤） / 損益率 ≥ +20% → 利確検討（緑）

しきい値の一部（出来高/RSI/リスク通知など）は `設定`→通知しきい値でユーザー調整できます。
