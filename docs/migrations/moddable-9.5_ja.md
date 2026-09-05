# Moddable SDK 9.5への移行

[English](moddable-9.5.md)

## 対応する環境

ホスト、Web Editorのコンパイラー、WebシミュレーターをModdable SDK 9.5.0に揃えます。
CIとローカルビルドでは同じタグを使用し、`@moddable/typings`も9.5.0に固定します。
ESP32用のツールチェーンはESP-IDF 6.1です。
`MODDABLE`と`IDF_PATH`をそれぞれのSDKに設定し、ESP-IDFの`export.sh`を読み込んでからビルドしてください。
Web用ツールの生成にはEmscripten 5.0.1を使用します。

Web Editorからのインストールは9.5.xのホストを対象とします。
8.3.xまたは9.0.xを使用している場合は、設定をバックアップし、対応する基板用のホストを更新してからMODをインストールしてください。
以前のホストへの書き込みは、ファームウェアのバージョン検査で拒否します。

SDKが生成するXSアーカイブのバージョンは17.8.2です。
標準ホストが受け入れる範囲は17.7から17.8で、パッチ番号は互換性の判定に使いません。
Web EditorとCLIはこの範囲を共有します。
独自のXSコンパイル設定で互換範囲を変更したホストは、このプロファイルの対象外です。

## MODの変更点

| 以前のAPI | 移行先 |
| --- | --- |
| `device.network.http`、`https`をクライアントに渡す | `device.network.http.client`、`https.client` |
| `sntp` | `device.network.ntp.client` |
| `mdns` | `device.network.dnssd` |
| `Net.get('IP')` | `ecma-wifi`のインスタンスから`address`を読む |
| AXP2101の`readByte`、`writeByte` | `readUint8`、`writeUint8` |

NTPの`getTime`コールバックが返す時刻はミリ秒です。
`Time.set`へ渡す際は秒に変換し、成功、失敗、切断、サービス終了のいずれでもNTPクライアントを閉じます。
タイムアウト後や再接続前の要求から届いた応答は無視します。

DNS-SDではホスト名の取得後にサービスを広告し、TXTレコードは`updateTXT`で更新します。
追従側はサービスの発見と更新の両方を処理します。
`mimic_main`と`mimic_follow`が移行例です。

ホストの直接依存から従来の`socket`、`sntp`、`mdns`を外しました。
SDKのDNS-SD実装は内部で従来の`net`を使用するため、間接依存は残っています。
`WebSocket`ラッパーも残していますが、内部の通信はECMA-419のプロバイダーを使用します。
従来のBLEモジュールは今回の移行対象に含めていません。

## HTTPサーバーの継続接続

HTTPサーバーはECMA-419のサーバーを直接使用します。
本文、書き込み位置、応答の状態を要求ごとに作り直し、同じ接続で次の要求が来ても前の本文を再送しないようにします。
SDK 9.5が分離して渡す`path`と`query`から要求URLを復元します。
MCPも同じサービスを使用し、認証とJSON-RPCの処理を維持します。
要求本文の上限は標準で16 KiBです。
`HttpServerService({ maxRequestBodyBytes })`で変更できます。
事前に本文長が不明な要求も累積サイズで検査し、上限を超えた接続はルーティング前に切断します。

実ソケットを使う回帰テストでは、同一接続の複数POST、クエリ、空応答、404、500からの復帰、MCP認証、連続RPCを検証します。

## ビルドと生成物

`firmware/`から既存のnpmスクリプトを使用してください。
出力は各作業ツリーの`firmware/dist/`に保存されます。

```sh
npm ci
npm run build
npm run build:editor-tools
npm run build:wasm
npm run test:unit
npm run check:architecture
npm run test:moddable
```

ブラウザー用コンパイラー、シミュレーター、同梱XSAを同じSDKで生成します。
同梱ミニアプリの正本は`firmware/mods/examples/`にあり、ギャラリーのコピーに含まれる相対パスのmanifestを直接ビルドしません。

初代M5Stackでは`esp_driver_dac`を明示的なIDF依存に追加します。
バージョン表示用の設定生成ではSDKの基本設定を再適用せず、manifestで有効にしたBLEを上書きしないようにします。

## 顔の描画

既存の顔パーツは形状をキャッシュして共有しています。
この移行では`Outline.clone`への置き換えを行わず、割り当てと共有形状の扱いを維持しました。
描画の変更を行う場合は、キャッシュと実行時メモリへの影響を別途測定してください。

## 検証記録

検証には未改変のSDK 9.5.0（`b6e06ba70506a7381ffb28e09e3175bf4e99f305`）とESP-IDF 6.1（`fff9895c82d744c7237be8847347bdd1b07c6643`）を使用しました。
以前のSDKに存在するローカル修正は取り込んでいません。

Nodeの410テスト、アーキテクチャ検査、46件のModdableテスト、Webの型チェックと本番ビルドが成功しています。
M5StackChan CoreS3の実機では、ホストの起動、タッチパネルの初期化、保存済み設定によるWi-Fi接続、既存MODのWebSocket接続まで確認しました。

全6ターゲット（M5Stack、Core2、CoreS3、M5StackChan CoreS3、Stack-chan RT、Takao Core2 SG90）のリリースビルドが成功しています。
CoreS3とM5StackChan CoreS3ではデバッグ版と計測版も成功しています。
配布対象4基板のバンドルを組み立て、埋め込みバージョンとパーティション容量を検査しました。
Webの208件のNodeテストと51件のReactテスト、画面テスト、多言語表示テストも成功しています。
ブラウザー用コンパイラーは2回の生成でSHA-256が一致しました。
HTTPの回帰テストでは大きな応答の分割送信と100回の接続と切断も検証しています（Linux実行）。

未改変のSDK 9.0.0＋ESP-IDF 6.0と比較したM5StackChan CoreS3のリリースイメージは、6,425,072バイトから6,379,120バイトに減少しました（45,952バイト、約0.7%）。
比較の基準は同じリポジトリコミットで、この移行によるコード変更と両ツールチェーンの更新を含みます。
実行時のヒープや音声処理の性能は、この数値からは判断できません。

長時間の音声再生、接続と切断の反復、実際の音質、画面、サーボ、USB音声の確認は別途必要です。
ビルド成功だけでは、これらの実機動作を確認したことにはなりません。

## 参照

- [Issue #690](https://github.com/stack-chan/stack-chan/issues/690)
- [Moddable SDK 9.5.0](https://github.com/Moddable-OpenSource/moddable/releases/tag/9.5.0)
- [XSのバージョン定義](https://github.com/Moddable-OpenSource/moddable/blob/9.5.0/xs/sources/xsCommon.h)
- [XSアーカイブのマッピング](https://github.com/Moddable-OpenSource/moddable/blob/9.5.0/xs/sources/xsAPI.c)
