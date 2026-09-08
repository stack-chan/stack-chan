# 公開SDKのAPI資料生成

`npm run generate-apidoc` の入口をホスト全体から公開SDKへ変更した。アプリ開発者向けの説明・型・生成資料が同じソースを使い、ホストの機器実装やfixtureを公開入口として展開しない。

- 設定は `firmware/typedoc.json`、型検査の入力は `tsconfig.apidoc.json`。SDK本体・拡張・共通schemaの再exportを含む。
- 先に通常の `check:sdk` を実行し、TypeDoc自身のcompiler checkも有効にする。旧 `--skipErrorChecking` を削除した。
- TypeDoc専用workspaceは対応するTypeScript 6.0.3を使う。宣言が7.0.2、lockfileとインストール実体が6.0.3だった不一致を直した。firmwareビルド用compilerは変更しない。
- MarkdownとJSON reflection modelは `firmware/dist/docs/sdk` に生成する。生成物をGitへ追加せず、SDKの型・コメントを正本として編集する。

生成コマンドの成功と、JSONに含まれる21入口を確認した。参照元はSDK21ファイル、共通契約2ファイル、Piu/標準ライブラリーの型3ファイルで、host・mods・試験のソースは含まれない。AppContext・AppConversation・DialogueOptions・ToolConnection・SettingKey・SettingValueの生成も確認した。Markdown内部の相対リンクは生成先の実ファイルへ解決する。

この変更は資料生成・開発設定で、機器の実行経路を変更しない。リリース影響はnone。公開API全体の利用しやすさ・公開入口数の起点との比較・初学者受入を、資料生成の成功だけで完了扱いしない。

利用者向け説明は [日本語](../../firmware/docs/api_ja.md) / [English](../../firmware/docs/api.md)、ツールの条件は [TypeDoc toolchain](../../firmware/tools/typedoc/README.md) を参照する。
