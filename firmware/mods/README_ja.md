# サンプルMOD

ｽﾀｯｸﾁｬﾝのユーザアプリケーション（MOD）のサンプル集です。
MODの書き込み方法は[プログラムのビルドと書き込み](../docs/flashing-firmware_ja.md)を参照ください。

一部のMODは動かすためにネットワーク接続や外部のサーバを準備する必要があります（執筆中）。

## WebRadio

- [web_radio](./examples/web_radio/): M5StackChan CoreS3でSomaFMのMP3ストリームを再生します。

MOD をインストールすると、ホストの製品既定動作は実行されません。
ボタンや画面操作の意味は、インストールした MOD の実装で決まります。

MOD は JavaScript または TypeScript module として書けます。
TypeScript で MOD を書く場合は、公開された Stack-chan capability 型と Moddable の module specifier だけを使います。
WASM host で使う MOD も、`lin` など TypeScript 対応済み target で build した `.xsb` または archive を読み込ませます。

顔画面とホストの AppBar を維持したまま Piu UI を追加する場合は、experimental の[ミニアプリ](../docs/mini-apps_ja.md)を利用できます。
実装例は [mini_app_sample](./examples/mini_app_sample/) にあります。

## M5StackChan CoreS3 Smoke

- [m5stackchan_smoke](./examples/m5stackchan_smoke/): M5StackChan CoreS3 のサーボ電源とヘッドLEDの smoke 確認です。手順は [M5StackChan CoreS3 smoke check](../docs/m5stackchan-cores3-smoke.md) を参照してください。

## Local Peer Hello

- [local_peer_hello](./examples/local_peer_hello/): インターネットを経由せず、近くのｽﾀｯｸﾁｬﾝを発見して型付きメッセージを送受信します。

## Look Around: きょろきょろｽﾀｯｸﾁｬﾝ

![きょろきょろｽﾀｯｸﾁｬﾝ](../docs/images/stackchan.gif)

- [look_around](./examples/look_around/)

## Monologue: ぽしょぽしょ独り言ｽﾀｯｸﾁｬﾝ

- [monologue](./examples/monologue/)

## Cheerup: ｽﾀｯｸﾁｬﾝ応援団

![顔の同期](../docs/images/face-sync.gif)
![ｽﾀｯｸﾁｬﾝ応援団](../docs/images/cheerup.gif)

- [cheerup_ble_lite](./examples/cheerup_ble_lite/): BLE版
- [cheerup_ws](./examples/cheerup_ws/): WebSocket版

## Mimic: まねっこｽﾀｯｸﾁｬﾝ

![まねっこｽﾀｯｸﾁｬﾝ](../docs/images/mimic.gif)

- [mimic_main](./examples/mimic_main/): ユーザが動かすほう
- [mimic_follow](./examples/mimic_follow/): まねして動くほう

## Face Tracker: 顔を追いかけるｽﾀｯｸﾁｬﾝ

![顔を追いかけるｽﾀｯｸﾁｬﾝ](../docs/images/face-tracker.gif)

- [face_tracker](./examples/face_tracker/)
