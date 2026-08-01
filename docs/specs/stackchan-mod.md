# Stack-chan MOD定義

## 対象

**Stack-chan MOD定義**は、MOD Galleryと各エディタが共有する配布用メタデータです。

Moddableの`manifest.json`はビルド方法を定義します。

`.stackchan-blocks.json`はブロックエディタで再編集するプロジェクトを保存します。

`stackchan-mod.json`は両者を置き換えず、正本となる編集ソースを`source.path`から参照します。

## 形式

ルートオブジェクトは次のフィールドを持ちます。

- **format**：`tech.stackchan.mod`です。
- **schemaVersion**：MOD定義形式の互換性を示す整数です。
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

API 1では、標準CoreS3 hostへ`audio.usb`、`conversation.remote`、`ui.approval`を追加します。

これらを要求するMODはAPI 0のhostへ書き込めず、利用者へhost firmwareの更新を案内します。

## 実行入口

任意の`entrypoints`は、XS archiveが公開する実行入口を列挙します。
省略時は従来どおり`["mod"]`として扱います。

- `mod`：ホストrealmで実行するapp behaviorです。
- `miniapp`：制限されたCompartmentで定義を読み込み、ホスト所有のviewportへPiu UIを表示します。

二つを同じarchiveへ含める場合は`["mod", "miniapp"]`を指定します。
ホストは両者を独立して読み込みますが、`mod.onLaunch()`が`false`を返した場合はpackage全体の起動を中止し、mini-appも登録しません。

`mod`を含むpackageはホストrealmで任意の処理を実行できるため、mini-app側のcontainmentにかかわらずpackage全体を信頼できる場合だけインストールしてください。

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
