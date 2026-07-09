# JARVIS Trade Log — macOS 常駐サービス化（launchd / LaunchAgent）

ターミナルを開かずに、Mac ログイン時から `http://localhost:3000` を常に開ける状態にする手順。
完全ローカル（ADR_001）・データはブラウザ localStorage。サーバは静的配信＋`/api/jquants` プロキシのみ。

- 常駐方式: **LaunchAgent**（ユーザーのログイン時に自動起動・root 不要）
- 本番: `next build` → `next start -p 3000 -H 127.0.0.1`（**localhost 限定バインド**）
- 自動再起動: `KeepAlive = { SuccessfulExit: false }`（**クラッシュ時のみ**再起動。手動 `service:stop` と競合しない）
- ログ: `~/Library/Logs/jarvis-tradelog.out.log` / `.err.log`

> 前提パス（現行環境。異なる場合は plist と本書の該当箇所を置換）:
> - Node: `/Users/hiroseosamuyuki/.local/node/bin`
> - プロジェクト: `/Users/hiroseosamuyuki/projects/jarvis-trade-log`

---

## 1. インストール（コピペで完結）

```bash
# 1) 本番ビルド（初回・コード変更時に必須）
cd /Users/hiroseosamuyuki/projects/jarvis-trade-log && npm run build

# 2) LaunchAgent plist を配置（テンプレートをコピー）
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
cp scripts/jarvis.plist.template ~/Library/LaunchAgents/com.jarvis.tradelog.plist

# 3) 常駐開始（ログイン時自動 + 即起動）
launchctl load -w ~/Library/LaunchAgents/com.jarvis.tradelog.plist

# 4) 起動確認（数秒待ってからブラウザを開く）
sleep 3 && open http://localhost:3000
```

`scripts/jarvis.plist.template` のパスが自分の環境と違う場合は、コピー後に
`~/Library/LaunchAgents/com.jarvis.tradelog.plist` を編集してから手順3へ。

---

## 2. 動作確認

```bash
# サービスが登録・稼働しているか（PID が数字なら稼働中、"-" なら未起動）
launchctl list | grep com.jarvis.tradelog

# 3000 番で LISTEN しているか（127.0.0.1 に限定されていること）
lsof -nP -iTCP:3000 -sTCP:LISTEN

# HTTP 応答確認（200 が返る）
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000

# ログ（起動失敗時はここに原因が出る）
tail -n 40 ~/Library/Logs/jarvis-tradelog.out.log
tail -n 40 ~/Library/Logs/jarvis-tradelog.err.log
```

期待:
- `launchctl list | grep` に `com.jarvis.tradelog` が出て、左端が PID（数字）。
- `lsof` に `127.0.0.1:3000 (LISTEN)`。
- `curl` が `HTTP 200`。
- ブラウザで `http://localhost:3000` が開き、スクリーナー等が動作。

---

## 3. コード修正後の再デプロイ（1コマンド）

```bash
cd /Users/hiroseosamuyuki/projects/jarvis-trade-log && npm run redeploy
```

`redeploy` = `next build`（本番ビルド）→ `launchctl kickstart -k gui/$(id -u)/com.jarvis.tradelog`（サービス再起動）。
※ 旧 macOS で `kickstart` が使えない場合は次で代替:
```bash
npm run build
launchctl unload ~/Library/LaunchAgents/com.jarvis.tradelog.plist
launchctl load -w ~/Library/LaunchAgents/com.jarvis.tradelog.plist
```

---

## 4. 開発（dev）との共存・ポート衝突回避

常駐サービスが 3000 を専有するため、`npm run dev` は次のいずれかで:

```bash
# A) 常駐を止めてから dev（3000 を解放）
npm run service:stop        # launchctl unload
npm run dev                 # http://localhost:3000
# 開発終了後に常駐再開:
npm run service:start       # launchctl load -w

# B) 常駐は動かしたまま dev を別ポートで
npm run dev -- -p 3005      # http://localhost:3005
```

`service:stop`（`launchctl unload`）はサービスを完全に停止・登録解除するため、
`KeepAlive` による自動再起動と**競合しない**（手動停止が優先される）。

---

## 5. アンインストール（常駐解除）

```bash
launchctl unload -w ~/Library/LaunchAgents/com.jarvis.tradelog.plist
rm ~/Library/LaunchAgents/com.jarvis.tradelog.plist
```

---

## 6. 補足・注意

- **env の反映**: `.env.local` の `NEXT_PUBLIC_*` は**ビルド時埋め込み**（変更時 `npm run redeploy`）。サーバ側 env（例 `JQUANTS_API_KEY`）は**再起動で反映**。J-Quants APIキーは設定画面（ブラウザ localStorage）経由でも動作するため env 必須ではない。
- **サーバ側リミッタ**: `next start` は単一プロセス常駐のため、`/api/jquants` の APIキー単位トークンバケットが**プロセス全期間で権威ある**（複数タブ・リロードに耐性）。再起動時のみ内部状態リセット（無害）。
- **自動更新（起動時チェック）**: スクリーナー自動更新はブラウザでページを開いた時に走る（サーバ常駐とは独立）。常駐は「いつでも開ける状態」を保つのみ。
- **セキュリティ**: `-H 127.0.0.1` で localhost 限定。LAN には公開されない。
- **ログイン必須**: LaunchAgent はユーザーの GUI ログイン中のみ稼働（ログアウト/再起動後は次回ログイン時に自動起動）。
- **ビルド前提**: `next start` は事前の `next build`（`.next` 本番成果物）が必要。未ビルドだと起動失敗（err ログに表示）。
