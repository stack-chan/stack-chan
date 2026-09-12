# Cloudflare Pages PRプレビューの設定

PRプレビューは、既存のGitHub Pages本番サイトとは独立したCloudflare Pagesプロジェクトへ配布されます。
取り込み先が`develop`または`main`で、`firmware/**`、`web/**`などBundleワークフローの対象パスを変更するPRに対応します。
外部forkのPRも対象です。
プレビュー対象の判定処理は既定ブランチのdevelopから読み込みます。
この処理は`milestone/sdk-redesign`を許可しないため、milestone向けPRの自動配布はスキップされます。milestone期間中はBundleの成果物をローカルで確認します。

## milestoneのプレビューをローカルで確認する

1. PRの最新headコミットに対する、成功した`Bundle Stack-chan Firmware`の実行を開く。
2. `cloudflare-pages-preview`成果物をダウンロードして展開する。保存期間は2日間のため、期限切れならワークフローを再実行する。
3. 展開先をlocalhostで配信する。例: `python3 -m http.server 8000 --bind 127.0.0.1 --directory /path/to/extracted-preview`。
4. `http://localhost:8000/`でWebツールとシミュレーターを確認し、headコミット、実行URL、結果をPRへ記録する。

配布ワークフローは、対象外のブランチをスキップした場合も成功扱いになります。実行結果の成功表示だけでプレビューの公開を判断しないでください。
取り込み先をmilestoneへ変更する前に発行されたURLは古いコミットの表示なので、最新headの検証には使いません。
配布処理は信頼する既定ブランチに保ち、プレビュー成果物は静的ファイルとして配信します。Cloudflareの認証情報を渡したジョブでは成果物を実行しません。

## Cloudflare Pagesプロジェクト

CloudflareダッシュボードのWorkers & Pagesから、Direct Upload方式のPagesプロジェクトを作成します。

- プロジェクト名: `stack-chan-pr-preview`
- 本番ブランチ: `production`
- Accessポリシー: 無効（公開プレビュー）

このプロジェクトをGitHubリポジトリへ接続しないでください。
GitHub Actionsがビルド済みの静的ファイルをDirect Uploadします。

## Cloudflare APIトークン

CloudflareのAPI Tokens画面でカスタムトークンを作成します。
対象アカウントだけに、`Account / Cloudflare Pages / Edit`権限を付与してください。

GitHubリポジトリのSettings、Secrets and variables、Actionsで次を登録します。

| 種別     | 名前                       | 値                       |
| -------- | -------------------------- | ------------------------ |
| Secret   | `CLOUDFLARE_API_TOKEN`     | 作成したAPIトークン      |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`    | CloudflareのアカウントID |
| Variable | `CLOUDFLARE_PAGES_PROJECT` | `stack-chan-pr-preview`  |

## 動作確認

`web/**`などを変更するPRを作成し、次を確認します。

1. `Bundle Stack-chan Firmware`が成功する。
2. `Deploy Cloudflare PR Preview`が続けて成功する。
3. PRに`Cloudflare PR preview`コメントが作られる。
4. `https://pr-<PR番号>.<Pagesプロジェクトのサブドメイン>.pages.dev`でWebツールとシミュレーターを開ける。
5. PRを閉じると、同じURLがプレビュー終了ページへ置き換わる。

外部PRのプレビューには未信頼のJavaScriptとファームウェアが含まれます。
差分を確認するまでWebSerialやBluetoothの権限を付与したり、実機へ書き込んだりしないでください。
