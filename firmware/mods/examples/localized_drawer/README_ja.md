# Localized Drawer

MOD 自身の `strings/*.json` と `context.i18n.localize()` を使い、現在の表示言語に合わせた Drawer Button を追加する最小サンプルです。
`manifest.json` の `./strings/*` は `en`、`ja`、`zh-CN` の3辞書をまとめて `modLocals` resource にするために必要です。
辞書間でキーと placeholder 名を一致させ、`en.json` は `Locals` の初期化に使うため削除しないでください。

詳しい契約と任意の Piu `Label` での使用例は、[firmware のローカライズ](../../../docs/localization_ja.md)を参照してください。
