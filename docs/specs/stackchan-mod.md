# Stack-chan MOD定義

## 対象

**Stack-chan MOD定義**は、MOD Galleryと各エディタが共有する配布用メタデータです。

Moddableの`manifest.json`はビルド方法を定義します。

`.stackchan-blocks.json`はブロックエディタで再編集するプロジェクトを保存します。

`stackchan-mod.json`は両者を置き換えず、正本となる編集ソースを`source.path`から参照します。

## 形式

ルートオブジェクトは次の必須フィールドを持ちます。

- **format**：`tech.stackchan.mod`です。
- **schemaVersion**：MOD定義形式の互換性を示す整数です。
- **id**：Gallery内でMODを識別する逆ドメイン形式の文字列です。
- **version**：MOD自身のリリースバージョンです。
- **type**：正本となる編集ソースの形式です。`text`または`block`を指定します。
- **name**：Galleryへ表示する名前です。
- **description**：Galleryへ表示する説明です。
- **source.path**：MOD定義からの相対パスです。
- **targets**：対応する実行対象のIDです。

`type`は実行形式を表しません。

テキストMODとブロックMODは、どちらもビルド後にXSアーカイブとして実行します。

`type: "text"`では、`source.path`がModdableのmanifestを指します。

`type: "block"`では、`source.path`が`.stackchan-blocks.json`を指します。

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
