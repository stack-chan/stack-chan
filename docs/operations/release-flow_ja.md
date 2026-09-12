# ブランチとリリースフロー

このリポジトリでは、リリースを凍結する際に以下のブランチモデルを使用します。

```text
main <- release/* <- develop <- feat/* | fix/*
```

## ブランチの役割

- `main` は安定版ブランチです。
  リリース済み、またはリリース可能なソースを表し、利用者がセットアップ手順の基準として参照できる状態にします。
- `develop` はデフォルトブランチであり、次回リリース向けの統合ブランチです。
  機能追加や修正の pull request は、原則としてこのブランチを向け先にします。
- `release/*` は、確定した `develop` のコミットから作成する一時ブランチです。
  凍結後はリリース用メタデータと `main` の履歴統合に必要な変更だけを追加します。
- `feat/*` と `fix/*` は、個別の変更に対応する作業ブランチです。

## Pull request

- 作業ブランチは、後述するSDK再設計を除き `develop` から作成します。
- 機能追加や修正の pull request は `develop` に向けます。SDK再設計の各段階は `milestone/sdk-redesign` に向けます。
- 各 pull request は 1 つの変更に集中させます。
- pull request の説明には、リリース影響を `none`、`patch`、`minor`、`major` のいずれかで記載します。
- 利用者に見えるファームウェアまたは Web の変更には、Changeset またはリリースノート本文を追加します。
  不要な場合は、その理由を説明します。

## SDK再設計はmilestoneへ順番に取り込む

`milestone/sdk-redesign`は、[SDK再設計の移行計画](./firmware-sdk-milestone.md)に使う一時的な統合ブランチです。
Moddable 9.5移行の#692と、milestone向けCI・設計文書の準備PRを取り込んだ最新developから作成します。
分岐元のコミットを、milestoneへ向ける最初のPRに記録します。

最新milestoneから作業ブランチを一つ作り、そのPRをレビューしてmilestoneへ取り込んでから、次の作業ブランチを作成します。
後続の依存ブランチやdraft PRは先に作りません。
各段階の開始前にdevelopの更新を確認し、更新があれば同期PRを先にmilestoneへ取り込みます。
共有後のmilestoneは履歴を書き換えず、同期と最後のdevelopへの統合にはmerge commitを使います。

milestoneと、それを取り込み先にするPRでは、対象パスの変更に対してBuildとBundleのCIを実行します。
検証にはCI成果物とPRごとのCloudflareプレビューを使い、milestoneからGitHub Pagesや正式リリースへは配布しません。
全段階の統合・実機検証後、分割PR一覧、移行手順、最終検証結果をまとめたPRをdevelopへ向けます。
Changesetsの基準はdevelopのまま各PRで記録を蓄積し、package versionは通常のリリース工程で更新します。

## リリース

リリースでは、凍結してレビューした `develop` のスナップショットを、リリースブランチ経由で `main` に移します。

想定するリリース手順は以下です。

1. 対象の機能追加と修正を `develop` にマージし、リリース対象のコミットを確定する。
2. そのコミットから `release/vX.Y.Z` を作り、現在の `main` の履歴をリリースブランチ上で統合する。
3. package version を更新し、蓄積されたリリースノートと Changesets をレビューして、リリースブランチから `main` への pull request を作成する。
4. 自動検証と実機検証の後にリリース pull request をマージし、生成された `main` のコミットへタグを付ける。
5. 公開後に `main` を `develop` へマージする。

Changesets のリリース基準ブランチは `develop` です。
version とリリースノートはリリースブランチ上で更新します。
実機検証では[リリース前実機テスト](./release-device-test_ja.md)を使用し、候補コミットと結果をリリース pull request に記録します。
安定版の `vX.Y.Z` タグをpushすると、バージョンを検証してfirmware bundleを再構築し、GitHub Releaseの成果物を公開します。
リリース pull request の自動作成と、ファームウェアへの製品version埋め込みは今後の作業です。

## GitHub Pages

GitHub Pagesは`gh-pages`ブランチ内で安定版と開発版を別のディレクトリへ配置します。

| 元ブランチ | URL | 役割 |
| --- | --- | --- |
| `main` | `https://stack-chan.github.io/stack-chan/web/` | 利用者向けの正本 |
| `develop` | `https://stack-chan.github.io/stack-chan/develop/web/` | 次回リリースの開発版 |

`main`へのpushは正本だけを更新し、`develop`へのpushは開発版だけを更新します。
各ディレクトリには、その元ブランチからビルドしたWebアプリ、firmware bundle、schema、schematicsを配置します。
`release/*`はGitHub Pagesへ直接デプロイせず、pull requestごとのCloudflareプレビューで確認します。
プレビューにはpull requestの候補から生成したWebアプリ、firmware bundle、schematicsと、その候補に含まれるschemaを使用し、`gh-pages`上の生成済み成果物は流用しません。
