# Stack-chan MOD定義

## 対象

**Stack-chan MOD定義**は、MOD Galleryと各エディタが共有する配布用メタデータです。

Moddableの`manifest.json`はビルド方法を定義します。

`.stackchan-blocks.json`はブロックエディタで再編集するプロジェクトを保存します。

`stackchan-mod.json`は両者を置き換えず、正本となる編集ソースを`source.path`から参照します。

## 形式

ルートオブジェクトは次のフィールドを持ちます。

- **format**：`tech.stackchan.mod`です。
- **schemaVersion**：現在は `2` です。schema 1は拒否します。
- **appApiVersion**：`2` を指定します。
- **hostApiVersion**：必要な最小ホストAPIを指定します。
- **settings**：任意。`{"tts.volume": 0.3}` のような共通設定の既定値です。host API 9以降で、ホストが公開settings schemaのキー・型・範囲を検証します。秘密情報は保存済み設定へ入力してください。
- **id**：Gallery内でMODを識別する逆ドメイン形式の文字列です。
- **version**：MOD自身のリリースバージョンです。
- **type**：正本となる編集ソースの形式です。`text`または`block`を指定します。
- **name**：Galleryへ表示する名前です。
- **description**：Galleryへ表示する説明です。
- **source.path**：MOD定義からの相対パスです。
- **source.entrypoint**：任意。テキストMODで、Galleryの「ソースを見る」から開く実装ファイルです。
- **setup.url**：任意。Galleryの「セットアップ手順」から開く絶対HTTPS URLです。
- **targets**：対応する実行対象のIDです。
- **capabilities**：任意。MODが実行時に必要とする公開capabilityです。

`type`は実行形式を表しません。

テキストMODとブロックMODは、どちらもビルド後にXSアーカイブとして実行します。

`type: "text"`では、`source.path`がModdableのmanifestを指します。

`type: "block"`では、`source.path`が`.stackchan-blocks.json`を指します。

`type: "text"`で`source.entrypoint`を指定すると、ビルドの正本であるmanifestを維持したまま、利用者が最初に読むJavaScriptまたはTypeScript実装へ案内できます。

`source.entrypoint`を省略した場合、「ソースを見る」は`source.path`を開きます。

`setup.url`は、外部サービスやアプリケーションなど、MOD以外の準備が必要な場合に指定します。

Galleryはセットアップ手順を別タブで開きます。

## Host互換性

Galleryは実機へ書き込む前に、`capabilities`を対象機種の能力および接続中hostのAPI世代と照合します。

hostのAPI世代は、ESP app descriptorのファームウェア版へ`+stackchan.N`として埋め込みます。

このsuffixを持たない従来hostはAPI 0として扱います。

API 3 では SDK の Piu 画面拡張 `ui.piu` に対応します。

API 9ではV1実行と `mod/config` を撤去し、設定の既定値を `settings` データへ統一しました。USB会話には `conversation.remote` を宣言し、SDKの会話拡張を使います。Blocklyの歌・図形の顔・解放入力はAPI 8以降を要求します。

## 実行入口

任意の`entrypoints`は、XS archiveが公開する実行入口を列挙します。
省略時は`["mod"]`として扱います。

実行入口は `mod` です。SDK アプリは `defineApp`、Piu 画面を含むアプリは `stackchan/extensions/piu` の `definePiuApp` を default export します。Piu 拡張は app API 2 / host API 3 と `ui.piu` を要求し、画面登録も通常の AppSession に所属します。

旧 `miniapp`、V1 hook、実行可能な `mod/config` は拒否します。SDKへ書き直し、宣言を付けてarchiveを再生成してください。

MOD はホスト realm で実行されます。Piu 拡張の公開面の制限は、未信頼コードを隔離する sandbox ではありません。

## 実行成果物

ビルド済みXSアーカイブを配布するMODは、任意の`artifacts`へ成果物を列挙します。

各成果物は`format: "xsa"`、相対パス、対象機種を持ちます。

Galleryは編集ソースと実行成果物を別々に扱い、`type`から実行互換性を推測しません。

## パス

すべてのパスは`stackchan-mod.json`があるディレクトリからの相対パスです。

絶対パス、親ディレクトリ参照、バックスラッシュ、制御文字を含むパスは無効です。

この制約により、一つのMODパッケージから別のパッケージにあるファイルを暗黙に参照することを防ぎます。

## スキーマ

機械検証には[`stackchan-mod.schema.json`](./stackchan-mod.schema.json)を使用します。
