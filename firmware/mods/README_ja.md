# MODとサンプル

[English](./README.md)

**MOD**は、ｽﾀｯｸﾁｬﾝのホストファームウェア上で動くユーザーアプリケーションです。
公開されているMODを使う場合と、ソースコードからMODを開発する場合では入口が異なります。

## MODを試す

公開MODの一覧は[MOD Gallery](https://stack-chan.github.io/stack-chan/web/mod-gallery/)で管理しています。
Galleryでは、名前や機能でMODを検索し、ブロックエディタで変更し、シミュレーターまたは実機で試せます。

GalleryはMODの対象機種、XSバージョン、ファームウェア互換性を実機へ書き込む前に検査します。
外部サービスやネットワークを使うMODもあるため、カードに表示される利用機能と対象機種を確認し、リンク先のソースコードも読んでから書き込んでください。

このディレクトリの[`examples`](./examples/)は、APIの使い方、テスト、ローカル開発の参考にするソースコードです。
配布用のGalleryと開発用の`examples`は役割が異なるため、収録内容は一対一には対応しません。

## MODを作る

### ブラウザーで作る

[ブロックエディタ](https://stack-chan.github.io/stack-chan/web/editor/)では、Blocklyで処理を組み立て、ブラウザー内でMODをビルドできます。
作成したMODは[シミュレーター](https://stack-chan.github.io/stack-chan/web/simulator/)で確認し、対応する実機へ書き込めます。
最初のプロジェクトは[ブロックエディタのチュートリアル](https://stack-chan.github.io/stack-chan/web/editor/tutorial.html)に沿って作成できます。

### ソースコードから作る

MODはJavaScriptまたはTypeScriptのモジュールとして実装できます。
TypeScriptでは、公開されているStack-chan capability型とModdableのモジュール指定子を使用します。

ローカル環境からMODを書き込む場合は、`firmware`ディレクトリで`manifest.json`を指定します。

```console
npm run mod -- mods/examples/look_around/manifest.json
```

環境構築、ターゲット別のコマンド、書き込み方法は[プログラムのビルドと書き込み](../docs/flashing-firmware_ja.md)を参照してください。

## MODの実行モデル

MODをインストールすると、ホストの製品既定動作に代わってそのMODが実行されます。
ボタンや画面操作の意味は、インストールしたMODの実装で決まります。

MODは、対象機種とホストが使用するXSバージョンに合わせてビルドする必要があります。
WASMホストで使う場合も、`lin`などTypeScript対応済みのターゲットでビルドした`.xsb`またはアーカイブを読み込みます。

表示文字列は[`context.i18n`を使ったファームウェアのローカライズ](../docs/localization_ja.md)に従って追加します。
顔画面とホストのAppBarを維持したままPiu UIを追加する場合は、実験的な[ミニアプリ](../docs/mini-apps_ja.md)を利用できます。

## 代表的なソース例

| サンプル | 確認できる機能 |
| --- | --- |
| [`look_around`](./examples/look_around/) | モーションAPIを使った最小限の首振り |
| [`localized_drawer`](./examples/localized_drawer/) | `context.i18n`を使ったローカライズ済みUI |
| [`mini_app_sample`](./examples/mini_app_sample/) | 顔画面とAppBarを維持するミニアプリ |
| [`local_peer_hello`](./examples/local_peer_hello/) | インターネットを経由しない端末間の型付きメッセージ |
| [`web_radio`](./examples/web_radio/) | M5StackChan CoreS3でのネットワーク音声再生 |
| [`m5stackchan_smoke`](./examples/m5stackchan_smoke/) | [M5StackChan CoreS3のサーボ電源とヘッドLEDの確認](../docs/m5stackchan-cores3-smoke.md) |

## 参考資料

- [プログラムのビルドと書き込み](../docs/flashing-firmware_ja.md)
- [ファームウェアAPI](../docs/api_ja.md)
- [MODパッケージ仕様](../../docs/specs/stackchan-mod.md)
- [ローカライズ](../docs/localization_ja.md)
- [ミニアプリ（実験的）](../docs/mini-apps_ja.md)
