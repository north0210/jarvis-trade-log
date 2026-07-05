# JARVIS Trade Log v1.7.0 — Release Notes（現行）

> 本ファイルが**現行のリリースノート**です。過去版は `docs/RELEASE_NOTES_v1.0.0.md`（歴史的アーカイブ）。
> 変更履歴の詳細は [`CHANGELOG.md`](../CHANGELOG.md) を参照。

## 1. 位置づけ
個人の株式運用を **完全ローカル**（ブラウザ localStorage のみ）で一元管理・分析する
「JARVIS / HUD」コンソール。外部サービスへ売買データを送信せず、自動売買も行いません。
**分析・Advisor の結果は判断補助であり、投資助言ではありません。**

## 2. 主な機能（v1.7.0）
- **Dashboard**：🌅 今日の確認（朝30秒）ヒーロー＋ Today's Picks / My Favorites / 危険候補 / データ不足 / 通知 / 出来高 / バックアップ状態
- **銘柄管理**：クイックセットアップ（コード入力→価格/RSI/MACD/出来高 自動取得→Advisor→AIコメント→保存）、個別/一括更新、データ不足バッジ、チャートモーダル(700px)
- **JARVIS Advisor**：9カテゴリ判定＋加重合成スコア＋個別銘柄BT反映（`/advisor`）
- **Advisorランキング**（`/advisor-ranking`）：多軸ソート/フィルタ、Score内訳、危険/データ不足枠、お気に入り
- **分析**：Risk / MonteCarlo / Backtest / Factor / 出来高 / Market Radar / Sector Heatmap / Mental / Adaptive Score
- **戦略**：テンプレート / 一括BT / ランキング履歴 / リバランス / 銘柄別BT
- **レポート/PDF・レポート履歴・通知・通知しきい値・Watchlist自動監視**
- **AIコメント**：OFF既定 / Template（ローカル）/ OpenAI・Claude・Gemini・Local（APIキーはユーザー管理・未設定時Templateフォールバック）・短文/標準/詳細
- **バックアップ/復元**：世代管理・部分復元・破損検知（checksum）・**全対象キーは keys.ts の中央レジストリから導出**・エクスポート時に概算サイズ表示
- **Help / 用語Tooltip / Onboarding / 免責表示**

## 3. データと方針
- 全データは端末内 localStorage（別端末と共有されません）。定期バックアップ推奨。
- J-Quants 認証情報・価格キャッシュ等の機微/一時データは**バックアップ対象外**（`keys.ts` の `excludeReason` に理由を明記）。
- **実装しない方針**：RSSニュース / ニュース分析 / LINE通知 / SNS連携 / 証券口座連携 / 注文送信 / 自動売買。

## 4. 品質
- `npm run build` 成功（37静的ページ + 2 API）。`npm run lint` エラーゼロ。
- ユニットテスト（Vitest）：アラート判定の境界値、バックアップ対象の固定化、バックアップ完全性（36キー往復＋異常系）。`npm test` で実行。

## 5. 既知の制限
- ファンダ（PER/PBR/ROE/営業利益率/売上成長率）は自動取得できず**手入力**（外部ファンダAPIは方針上追加しない）。米国株は価格系列取得が制限される場合あり。
- 復元後は画面の再読み込みが必要。
- 外部AIプロバイダの実接続はユーザー鍵前提（未設定時はローカルTemplateへフォールバック）。

## 6. 今後の候補
- v1.8：Worker化 / sharedCache / 差分再計算（速度最適化）、Advisorスコア推移ビュー、MissingData専用ページ。

## タグ付け
```bash
git tag v1.7.0
git push origin v1.7.0
```
