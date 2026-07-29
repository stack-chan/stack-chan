# Cloudflare Pages PRプレビューの設定

PRプレビューは、既存のGitHub Pages本番サイトとは独立したCloudflare Pagesプロジェクトへ配布されます。
`firmware/**`または`web/**`を変更するPRが対象で、外部forkのPRにも対応します。

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
