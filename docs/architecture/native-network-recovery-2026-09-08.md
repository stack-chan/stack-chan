# Native network recovery verification — 2026-09-08

This change addresses startup ordering and malformed input at the SDK network boundary. It does not establish physical BLE/Wi-Fi coexistence or native BLE close completion.

- DNS-SD now copies TXT values at registration and update, retains the latest update while claiming a name, and publishes once when ready. A repeated ready callback cannot create a second advertisement. Closing releases advertisement, claim, and DNS in that order; late callbacks cannot recreate them.
- HTTP, MCP, and DNS-SD ports must be integers in 1–65535 before a native service or settings dependency is opened. Beacon roles and UUIDs are validated before constructing a radio.
- STK ignores malformed JSON and packets larger than 2048 bytes, reports `INVALID_ARGUMENT` through the app scope, and accepts subsequent valid messages. Close is idempotent and blocks late ready, connection, disconnection, and message callbacks.

Node tests exercise the production JavaScript with isolated native dependency fakes. The STK test performs 100 create/receive-error/recover/close cycles. These tests establish callback and ownership behavior, not RF transmission or the timing of Moddable's native BLE destructor.

Verification:

- Firmware Node: 567 passing; SDK strict types and 77 architecture checks passing.
- All 58 Moddable/XS manifests passing (34.4 seconds, incremental).
- M5Stack release: 3,799,632 / 3,801,088 bytes, descriptor `9.5.0+stackchan.9.m5`.
- M5StackChan CoreS3 release: 6,580,176 / 16,318,464 bytes, descriptor `9.5.0+stackchan.9.sc3`.

The 4 MB M5Stack has only 1,456 bytes of factory partition margin. Future host changes must pass the artifact-size guard; the remaining size margin needs improvement as part of consolidation. No board was flashed. Physical radio handoff and repeated on-device replacement remain open.

## ビーコンの受信と遅延イベント（2026-09-09）

実際のModdable `Bytes` とC実装を使うXS試験で、送信UUIDがparse時に反転する問題を再現した。同じUUIDの送信・受信設定が一致しなくなるため、受信したwire順を保つよう修正した。DataViewも受け取ったUint8ArrayのbyteOffset/byteLengthを使う。送信形式・UUID・major/minor・TxPowerは変更しない。

100パケットを、先頭と5バイト目から始まる受信viewで往復し、UUID・各値・payloadの完全一致と受信バッファ変更からの独立を確認した。公開ネットワークの試験では100回のadvertiser/scanner開始・終了を行い、開始待ちの広告データのコピー、選択roleの保持、close後のonReady/onConnected/onDiscovered無視、二重closeと資源登録の解除を確認した。Node全569件、XSの追加manifest、構成77件・manifest 7対象に成功。M5Stack / M5StackChan CoreS3のnative releaseは容量内でビルドできた。

この検証はpacket処理とアプリの寿命に対するもの。NimBLEの物理的なclose完了を待つ仕組み、BLE役割間の排他、Wi-Fi/ESP-NOW共存・再接続の実機受入は別の残件である。SDK 9.5のserver closeは保留中のcallback参照がなくなってからnativeの終了イベントを処理するため、JSのcloseが返っただけで別のserverへ所有権を渡す実装にはしない。
