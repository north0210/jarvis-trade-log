# CHANGELOG

このプロジェクトのすべての注目すべき変更を記録します。
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に準拠します。

## 方針（更新）

- **実装しない（ロードマップから除外）**: RSSニュース / ニュース分析 / 外部ニュース取得 / LINE通知 / LINE Messaging API
- **任意拡張として残す**: AI自動コメント生成（Advisor/Report/Risk/Portfolio 所見）。自動売買ではなく判断補助・投資助言ではない・APIキーはユーザー管理・初期値OFF・未設定時はテンプレートfallback・完全ローカルが基本。

## [1.6.0] - JARVIS External Intelligence Layer（正式版）

- **AIコメント統一レイヤー**: Advisor/Risk/Portfolio/Dashboard/Watchlist/Report/Backtest/MonteCarlo に判断補助コメントを生成。
- **Provider**: OFF（既定）/ Template（ローカル生成・外部送信なし）/ OpenAI / Claude / Gemini / Local LLM。
- **設定**: API Key（ユーザー管理・localStorageのみ）/ Local Endpoint / Comment Style（Conservative/Balanced/Aggressive）/ Temperature（0.1/0.3/0.5）/ Max Tokens（100/300/500）。
- **フォールバック**: 未設定・HTTPエラー・CORS・タイムアウト(20s)・例外時は **Template へ自動フォールバック**（動作停止なし）。
- **固定コメント**: 「推奨は判断補助です／利益は保証できません／優位性は未来を保証しません／感情ではなく規律で／利益は市場が与えます・損失は我々が許可します」。断定・未来予測なし・投資助言ではない。
- **履歴保存**: 生成コメントをローカル保存可能。ニュース/RSS/LINE/SNS/外部情報は不使用。

## [1.7.0] - Stable（実運用凍結版）

v1.7.x を実運用版として凍結。1週間の実運用フィードバックを経て v1.8 を開始する。

- **クイックセットアップ**: 銘柄コード入力→登録/価格/RSI/MACD/出来高/Advisor/AIコメント/保存を一括
- **Advisor ランキング（/advisor-ranking）**: Score/Grade/PF/CAGR/DD/勝率/期待値/RSI/PER/ROE/更新日時ソート、各種フィルタ、Score内訳、危険/データ不足枠、状態永続
- **Dashboard Today's Picks**（Top3/5/10・PF/期待値/DD/勝率/更新）＋ **My Favorites** ＋ 危険候補 ＋ データ不足
- **お気に入り**（最大20・localStorage）
- **AIコメント3種**（短文/標準/詳細）・完全ローカル・OFF既定・Template fallback
- **TradingViewChartModal**（700px・ESC/×/背景・モバイル）
- **バックアップ拡充**（favorites/advisorSnapshots/aiComments/stockBtResults/watchlistEvents 等）
- **Watchlist**: Score急落検出追加

## [1.5.0] - 全銘柄BT ＋ AIコメント生成（正式版）

- **全銘柄自動BT**: Advisor対象銘柄を一括バックテスト（PF/勝率/最大DD/CAGR/MC破綻率/期待値/平均保有日数/取引回数）。データ不足銘柄は市場平均へフォールバック。
- **Advisorスコア本接続**: 個別BTを合成スコアの Backtest 成分へ反映（BT Grade 表示）。`score.ts`/`alerts.ts`/`provider.ts` 非破壊。
- **AIコメント生成（任意）**: モード OFF（既定）/ Template（ローカル生成）/ OpenAI / Claude / Gemini / Local LLM。外部プロバイダは APIキー未設定時 **Template へ自動フォールバック**。銘柄内部データのみ・外部情報不使用・判断補助・投資助言ではない。
- **Advisor Snapshot**: 保存・履歴・前回差分（上昇/悪化銘柄）・推移。
- **Dashboard/Report/PDF 統合**: Advisor件数・BT済/未計算・平均PF/DD/CAGR・AIコメント・Top10・危険候補・使用プリセット。
- **Tooltip拡充**: BT Grade / 期待値 / Buy・Sell Candidate / Advisor Snapshot / AI Comment 等。

## [1.3.0 / 1.4.0] - Advisor 拡張・個別BT本接続

- **外部AIコメント（手動）**: プロンプト生成＋回答貼り付け保存（自動API接続なし・APIキー不要）
- **銘柄別バックテスト**: 銘柄×戦略の PF/勝率/最大DD/CAGR/期待値/MC を検証（軽量版）
- **Watchlist 自動監視**: Score急上昇/RSI過熱/押し目/出来高急増/Advisor変化/Risk悪化を検出（LINE・ニュース監視なし）
- **per-stock BT → Advisor 本接続（v1.4）**: 個別BT指標を合成スコアへ反映＋BT Grade 表示・Dashboard BT品質カード

## [1.2.0] - 実運用完成版

JARVIS Advisor をコアに据えた実運用完成版。完全ローカル維持。

- **JARVIS Advisor**：9カテゴリ判定（Strong Buy〜Avoid）＋加重合成スコア（Score/Risk/Backtest/MC/Volume/Strategy/Discipline）
- **Advisor 重み調整**：7プリセット（Conservative/Balanced/Aggressive/Dividend/Growth/Swing/ShortTerm）＋±編集・正規化・リセット
- **Advisor スナップショット履歴**：保存・推移表示・前回との差分（上昇/悪化銘柄）・保持件数
- **Report/PDF 統合**：買い候補Top10・警戒候補・Danger一覧・理由・使用プリセット/重み
- **Dashboard 統合**：Strong Buy/Buy/Watch/利益確定/損切り/Danger 件数＋最新判定日時＋導線
- **Onboarding**：初回起動ガイド（主要画面説明・一度で非表示）
- **Tooltip 最終整備**：Advisor Score/Grade/Strong Buy/Watch/Hold/Danger を用語辞典へ追加
- **per-stock バックテスト接続口**：設計のみ（v1.3 実装予定・完全ローカル）

## [Unreleased] / Roadmap（今後の候補）

- **v1.7 Worker化** — MC/BT/監視の Web Worker バックグラウンド計算・共有キャッシュ・不要再計算削減
- **v1.8 時系列ファンダBT** — エントリー時点の実ファンダでバックテスト（現状は現在値近似）
- **v2.0 JARVIS Quant Terminal** — 統合ターミナル化
- 全銘柄BTの自動スケジュール／鮮度管理

※ RSS・ニュース・LINE・SNS・注文送信・自動売買・証券口座連携は方針として**今後も実装しません**（ロードマップ対象外）。

## [1.0.0] - v1.0 正式リリース

JARVIS Trade Log の初回正式版。**完全ローカル運用**（データは localStorage のみ）を方針とし、
外部サービスへ売買データを送信せず、自動売買も行いません。分析結果は投資判断の補助です。

### 搭載機能
- **Dashboard** — 総資産・含み損益・リスク・通知・出来高・初期導線を集約
- **銘柄管理** — 指標（PER/PBR/ROE/RSI/MACD/出来高）・ランク・状態・メモ
- **保有株管理** — 取得単価・損切り/利確・売却記録・危険判定
- **運用日誌** — 日々の記録と JARVIS コメント
- **Score Engine** — JARVIS Score / Grade による銘柄採点
- **Risk Engine** — VaR/CVaR・破産確率・集中/テーマ/規律/流動性リスク・Risk Grade
- **MonteCarlo** — ブートストラップによる将来分布・破産確率推定（回数はパフォーマンスモード連動）
- **Backtest** — 取引リプレイ／価格系列（実証）バックテスト
- **Strategy** — 戦略テンプレート・ルール改善・一括バックテスト・ランキング履歴
- **Portfolio分析** — 保有比率・現金比率・配分バランス
- **Factor分析** — Value/Growth/Quality/Momentum/Risk/Discipline の寄与分解
- **Adaptive Score** — 相場環境に応じた重み付け補正
- **Report / PDF** — 運用状況を1枚に集約し印刷/PDF出力（出来高分析セクション含む）
- **Notification** — 規律/リスク/出来高通知・通知しきい値・通知履歴
- **Backup / Restore** — 世代管理（直近3件）・部分復元・破損検知（checksum）
- **Help / Glossary / Tooltip** — 操作ガイド・用語辞典・指標ツールチップ
- **J-Quants連携** — 価格/出来高の一括取得（任意・env優先・レート制限対応）
- **パフォーマンスモード** — Fast / Normal / Research による計算負荷調整
- **免責表示 / リリースチェックリスト** — 初回起動時の同意と初期確認導線

### 方針
- **完全ローカル運用**を優先（外部送信なし）
- APIキーはサーバ環境変数のみで扱い、ハードコード/localStorage 保存はしない
- 分析結果は投資助言ではなく判断補助

### v1.0 対象外（将来拡張候補）
- ニュース分析機能
- LINE通知
- 外部AIによる自動分析
- 海外株（原則対象外）
- 自動売買（実装しない方針）

[1.0.0]: リリースタグ v1.0.0
