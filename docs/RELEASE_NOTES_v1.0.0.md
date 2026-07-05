# JARVIS Trade Log v1.0.0 — Release Notes

> 🗄 **歴史的アーカイブ**：本ファイルは v1.0.0 時点のリリースノートです（当時の記録として温存）。
> **最新のリリースノートは [`docs/RELEASE_NOTES.md`](./RELEASE_NOTES.md)（現行 v1.7.0）** を参照してください。

## 1. v1.0 の目的

個人の株式運用を、**完全ローカル**（ブラウザ localStorage のみ）で一元管理・分析できる
「JARVIS / HUD」コンソールとして正式リリースします。外部サービスへ売買データを送信せず、
自動売買も行いません。**分析結果は投資判断の補助**であり、売買を推奨するものではありません。

## 2. 主な機能

- ダッシュボード（総資産・含み損益・Risk/Discipline/Mental・通知・出来高・初期導線）
- 銘柄管理 / 保有株管理 / 運用日誌
- JARVIS Score / Adaptive Score
- Risk Engine（VaR/CVaR・破産確率・Risk Grade）
- MonteCarlo / Backtest / 価格系列バックテスト（実証）
- 戦略テンプレート / 一括バックテスト / ランキング履歴 / リバランス提案
- Portfolio分析 / Factor分析 / Market Radar / Sector Heatmap / 出来高分析
- 投資レポート（PDF出力）/ レポート履歴 / 通知 / 通知しきい値
- バックアップ・復元（世代管理・部分復元・破損検知）
- 使い方ガイド / 用語辞典 / 指標ツールチップ
- J-Quants連携（任意）/ パフォーマンスモード（Fast/Normal/Research）

## スクリーンショット

主要画面のプレビュー（実画像は `docs/screenshots/` に配置。撮影手順は `docs/screenshots/README.md`）。

| 画面 | ファイル | 説明 |
|---|---|---|
| Dashboard | `docs/screenshots/dashboard.png` | 資産状況・リスク・通知を一覧確認 |
| 銘柄管理 | `docs/screenshots/stocks.png` | 注目銘柄とスコアを管理 |
| 保有株 | `docs/screenshots/holdings.png` | 保有ポジションと損切り/利確を管理 |
| Report | `docs/screenshots/report.png` | 分析結果をPDF出力 |
| Backup | `docs/screenshots/backup.png` | 全データの保存・復元 |
| Help | `docs/screenshots/help.png` | 用語とJARVIS基準を確認 |
| Settings | `docs/screenshots/settings.png` | J-Quants・通知しきい値・パフォーマンス設定 |

## 3. 使い始める前の確認

初回起動時、ダッシュボード上部に**免責同意**と**リリース前チェックリスト**が表示されます。

1. 免責事項を確認して同意
2. バックアップを作成
3. J-Quants設定を確認（使う場合）
4. 通知設定を確認
5. 使い方（Help）を確認
6. サンプル銘柄で動作確認

## 4. データバックアップ方法

- `設定` → エクスポート（JSON保存）、または
- `バックアップ/復元` → 「全データを書き出し」（checksum付きフル形式）
- 復元/上書き前には自動で退避バックアップ（直近3世代）を作成
- **localStorage はブラウザ消去で失われます。定期的な外部ファイル保存を推奨。**

## 5. J-Quants設定

1. J-Quants アカウント作成
2. `設定` → 価格プロバイダを J-Quants に切替
3. 認証情報を入力し「接続テスト」
4. `銘柄管理` の「価格更新」で一括取得（RSI・出来高も自動算出）

サーバ環境変数（`JQUANTS_EMAIL` / `JQUANTS_PASSWORD`）があればそちらが優先されます。
429（レート制限）時は取得を停止します。

## 6. 免責事項

本アプリの分析結果は投資判断の**補助**であり、売買を推奨するものではありません。
過去実績（バックテスト等）は将来を保証しません。**投資は自己責任**で行い、
最終判断はユーザー自身で行ってください。本アプリは自動売買を行いません。

## 7. 既知の制限

- ニュース分析はありません
- 海外株は原則対象外です
- LINE通知はありません
- 外部AIによる自動分析はありません
- 自動売買は行いません
- 分析結果は投資助言ではありません
- データは端末・ブラウザ単位（別端末と共有されません）
- 復元後は画面の再読み込みが必要です

## 8. 今後の候補

JARVIS Advisor（v1.1〜v1.5）＋ **v1.6 External AI Layer（AIコメント・実装済み）** を土台に、以下を候補とします。

- **v1.7 Worker化** — MC/BT/監視の Web Worker バックグラウンド計算・共有キャッシュ
- **v1.8 時系列ファンダBT** — エントリー時点の実ファンダでバックテスト
- **v2.0 JARVIS Quant Terminal** — 統合ターミナル化
- 全銘柄BTの自動スケジュール／鮮度管理

> **方針：RSS・ニュース分析・外部ニュース取得・LINE通知（LINE Messaging API）・SNS・注文送信・自動売買・証券口座連携は今後も実装しません**（ロードマップ対象外）。

## リリースタグ

```bash
git tag v1.0.0
git push origin v1.0.0
```
