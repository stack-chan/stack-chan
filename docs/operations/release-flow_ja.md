# ブランチとリリースフロー

このリポジトリでは、以下のブランチモデルを使用します。

```text
main <- develop <- feat/* | fix/*
```

## ブランチの役割

- `main` は安定版ブランチです。
  リリース済み、またはリリース可能なソースを表し、利用者がセットアップ手順の基準として参照できる状態にします。
- `develop` はデフォルトブランチであり、次回リリース向けの統合ブランチです。
  機能追加や修正の pull request は、原則としてこのブランチを向け先にします。
- `feat/*` と `fix/*` は、個別の変更に対応する作業ブランチです。

## Pull request

- 作業ブランチは `develop` から作成します。
- 機能追加や修正の pull request は `develop` に向けます。
- 各 pull request は 1 つの変更に集中させます。
- pull request の説明には、リリース影響を `none`、`patch`、`minor`、`major` のいずれかで記載します。
- 利用者に見えるファームウェアまたは Web の変更には、Changeset またはリリースノート本文を追加します。
  不要な場合は、その理由を説明します。

## リリース

リリースでは、レビュー済みの変更を `develop` から `main` に移します。

想定するリリース手順は以下です。

1. 機能追加と修正の pull request を `develop` にマージする。
2. `develop` から `main` へのリリース pull request を作成する。
3. 蓄積されたリリースノートと Changesets をレビューする。
4. 検証後にリリース pull request をマージする。

Changesets のリリース基準ブランチは `develop` です。
自動リリース pull request、バージョン更新、changelog 生成、ファームウェアへのバージョン埋め込みは今後の作業です。
