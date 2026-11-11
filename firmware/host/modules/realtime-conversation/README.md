# RealtimeConversation

Stack-chanホスト向けのOpenAI互換会話モジュール。会話プロトコル、ツール実行、CoreS3のWebRTC音声処理を提供する。音声の送受信・Opus・I2Sはネイティブタスクで処理し、会話制御はMODのWorkerから呼び出す。

## 組み込み

CoreS3とM5StackChan CoreS3では、`realtimeConversation`から`createLiveConversation`を利用できる。ホストのAudioRuntimeが専用のduplex leaseを開き、WebRTC transportはそのleaseのcaptureとrenderを借りる。ファームウェアのビルド・実機での確認方法は[CoreS3 WebRTCの検証手順](../../../../docs/operations/cores3-webrtc-acceptance.md)を参照する。

```js
import { createLiveConversation } from 'realtimeConversation'
import { createConversationPipeline } from 'stackchan/voice'

const conversation = createLiveConversation({
  apiKey,
  instructions: '短く答えてください。',
  delegation: { kind: 'hosted', model: backendModel, tools },
})
const pipeline = createConversationPipeline({
  conversation, microphone: robot.audio.microphone, speaker: robot.audio.speaker,
  mediaBudget: { maxBufferedBytes: 128 * 1024, maxBufferedMs: 1000 },
})
try {
  await pipeline.start()
  await waitForStop()
} finally {
  const result = await pipeline.close({ mode: 'abort' })
  // result.remoteFinalization identifies whether the provider confirmed close.
}
```

`delegation.kind`に`client`を指定すると、注入した`delegate.run`が開始時刻までのtranscriptを受け取る。モデルの応答から発話用textを取り出し、元のdelegation IDを添えてLiveに返す。`hosted`ではResponsesが推論を行い、端末のToolSetがfunctionを実行する。

```ts
import { asDelegateAgent } from 'stackchan/ai'

const conversation = createLiveConversation({
  apiKey,
  delegation: { kind: 'client', delegate: asDelegateAgent(agent) },
})
```

WebRTCのRTPは連続した音声であり、デコードした各packetに応答IDがない。手動の`interrupt`は古いpeerの出力経路を閉じ、DMAが無音を再生した後で終了する。結果は`history: 'restart-required'`とする。次の会話には新しいPipelineを作る。`remoteFinalization`と手動割り込み時の`remote`は、サーバーから確認できた状態を示す。

HTTPS POST uses the standard Moddable ECMA-419 HTTPS client in a dedicated Worker, with direct messages from the caller VM. It retains the eight-request limit, deadline including queue time, 128 KiB response limit, certificate verification, and redirect prohibition. The SDK manages TLS session caching; custom-CA requests clear the cache before and after use to isolate trust settings. The Worker is created on the first valid request, with priority 3 and a 6 KiB native stack. It is retired after pending callers and its actual request queue drain, then recreated on demand. Caller timeout alone does not terminate ongoing TLS cleanup. An asynchronous hangup can finish after conversation closure. Merely importing or constructing a conversation starts no HTTPS Worker or native transport.

A MOD opts in by calling `pipeline.start()`; no extra host profile or eager allocation flag is required. Use its optional `onClose` hook to await the same session shutdown used by the stop action. The host runs this hook before closing its audio runtime, including cleanup after `onContextCreated` fails. The Live example delegates it to `LiveSession.stop()`. MOD replacement still restarts the host; this hook does not add hot unloading. Keep shared codec registrations and USB resources under their existing owners. Linked static data and the compiled ESP-IDF heap policy remain even when a MOD never connects; see [memory acceptance](../../../../docs/operations/cores3-webrtc-acceptance.md).

## 維持する動作

- `start`は開始確認まで待ち、`close`は音声を止めてから提供元の終了確認を待つ。DataChannelは確認前に閉じない。重複closeは同じPromiseを返す。
- CoreS3はDTLSを開始する役割で接続する。JSのイベント取得は一度に16件までとし、処理終了から20ms後に再予約する。
- ツールの重複実行を防ぎ、結果・送信待ち・ネイティブイベントの上限を維持する。ミュート解除の確認が失われたときはマイクを閉じたままにする。
- CoreS3の入力ゲート、音量、Opus設定、内部RAM／PSRAM配置、録音音源を差し込むCフックを維持する。再生不足の回数・累計無音・最長無音を取得できる。
- 標準のModdable SPI・Piuを使う。`io-performance`の時刻・音量レベル・優先度制御は通常版にも存在する。描画・I2S計測とタスク診断は別の計測構成で有効にし、通常版の計測フックは何もしない。

## テストと出自

`npm run test:unit`で会話・HTTP・トランスポートの回帰テストを実行する。ネイティブ部分はCoreS3のビルドと実機プローブで検証する。UIの行単位吹き出しは独立した追加APIで、会話モジュールは依存しない。

本モジュールはmeganetaaan名義で開発したSDK forkの新規追加モジュールを移したもの。移植元コミットと原本のハッシュは`source-provenance.json`に記録する。独自実装のSDK用テンプレートヘッダーを整理し、Apache-2.0を適用する。Moddable・ESP-IDF・Espressifのコード自体を再ライセンスするものではない。依存物の条件は[ライセンス記録](LICENSES.md)を参照。
