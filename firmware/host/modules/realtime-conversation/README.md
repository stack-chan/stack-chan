# RealtimeConversation

Stack-chanホスト向けのOpenAI互換会話モジュール。会話プロトコル、ツール実行、CoreS3のWebRTC音声処理を提供する。音声の送受信・Opus・I2Sはネイティブタスクで処理し、会話制御はMODのWorkerから呼び出す。

## 組み込み

Standard CoreS3 and M5StackChan CoreS3 hosts include this backend. Public modules are `realtimeConversation`, `realtimeConversation/core`, `/tools`, `/transport`, and `/http`.

Use `npm run build:m5stack_cores3` or `npm run build:m5stackchan_cores3`. The wrappers fetch pinned Espressif sources into the workspace and register external components in the generated IDF project; `ESP_WEBRTC_SOLUTION` can select an existing checkout. No shared SDK files change. Large Live VM/cache/timing settings remain opt-in. See [activation, audio ownership, and acceptance](../../../../docs/operations/cores3-webrtc-acceptance.md).

```js
import RealtimeConversation from 'realtimeConversation'

const conversation = new RealtimeConversation({
  signaling, // createSession / acceptSession / hangup
  onTranscript(fragment) {},
  onEvent(event) {},
  onError(error) {},
})
await conversation.connect()
conversation.setVolume(0.1)
await conversation.setMuted(true)
const result = await conversation.close()
```

公開型は`realtimeConversation.d.ts`。`apiKey`と`signaling`は排他的に指定する。認証・短期トークンの取得・エージェント設定・具体的なツール・履歴保存の方針は利用側で実装する。プロンプト、委譲先モデル、検索ツールは呼び出し側が指定し、hostでは追加しない。`tools`を直接登録する場合はResponses用の`delegation`設定も渡す。

HTTPS POST uses the standard Moddable ECMA-419 HTTPS client in a dedicated Worker, with direct messages from the caller VM. It retains the eight-request limit, deadline including queue time, 128 KiB response limit, certificate verification, and redirect prohibition. The SDK manages TLS session caching; custom-CA requests clear the cache before and after use to isolate trust settings. The Worker is created on the first valid request, with priority 3 and a 6 KiB native stack, and is destroyed with its caller VM. Merely importing the conversation module starts no HTTPS Worker.

## 維持する動作

- `connect`は開始確認まで待ち、`close`は音声を止めてから提供元の終了確認・利用時間を待つ。DataChannelは確認前に閉じない。重複closeは同じPromiseを返す。
- CoreS3はDTLSを開始する役割で接続する。JSのイベント取得は一度に16件までとし、処理終了から20ms後に再予約する。
- ツールの重複実行を防ぎ、結果・送信待ち・ネイティブイベントの上限を維持する。ミュート解除の確認が失われたときはマイクを閉じたままにする。
- CoreS3の入力ゲート、音量、Opus設定、内部RAM／PSRAM配置、録音音源を差し込むCフックを維持する。再生不足の回数・累計無音・最長無音を取得できる。
- 標準のModdable SPI・Piuを使う。`io-performance`の時刻・音量レベル・優先度制御は通常版にも存在する。描画・I2S計測とタスク診断は別の計測構成で有効にし、通常版の計測フックは何もしない。

## テストと出自

`npm run test:unit`で会話・HTTP・トランスポートの回帰テストを実行する。ネイティブ部分はCoreS3のビルドと実機プローブで検証する。UIの行単位吹き出しは独立した追加APIで、会話モジュールは依存しない。

本モジュールはmeganetaaan名義で開発したSDK forkの新規追加モジュールを移したもの。移植元コミットと原本のハッシュは`source-provenance.json`に記録する。独自実装のSDK用テンプレートヘッダーを整理し、Apache-2.0を適用する。Moddable・ESP-IDF・Espressifのコード自体を再ライセンスするものではない。依存物の条件は[ライセンス記録](LICENSES.md)を参照。
