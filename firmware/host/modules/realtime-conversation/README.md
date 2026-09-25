# RealtimeConversation

Stack-chanホスト向けのOpenAI互換会話モジュール。会話プロトコル、短期トークンの接続アダプター、ツール実行、CoreS3のWebRTC音声処理を提供する。音声の送受信・Opus・I2Sはネイティブタスクで処理し、会話制御はMODのWorkerから呼び出す。

## 組み込み

ホストのマニフェストへ本ディレクトリーの`manifest.json`を追加する。既存の`realtimeConversation`、`realtimeConversation/core`、`/tools`、`/broker`、`/transport`、`/http`、`/httpCore`というモジュール名を維持する。`/transport-core`はトランスポートの共通実装として追加する。CoreS3のネイティブ実装とホスト設定を含む。Tab5の作例は移植元SDKに残し、このホスト版の動作確認対象には含めない。

ビルドには`STACKCHAN_REALTIME_WEBRTC=1`と`ESP_WEBRTC_SOLUTION`を指定し、リポジトリーの`npm run build`を使う。ラッパーが生成先のESP-IDFプロジェクトへ外部コンポーネントを登録する。ModdableのCMake・Makefile・ランタイムを変更しない。

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

公開型は`realtimeConversation.d.ts`。`apiKey`・`broker`・`signaling`は排他的に指定する。短期トークンは仲介サーバーが発行する資格情報であり、OpenAIのEphemeralトークンとは異なる。認証・エージェント設定・具体的なツール・履歴保存の方針は利用側で実装する。

## 維持する動作

- `connect`は開始確認まで待ち、`close`は音声を止めてから提供元の終了確認・利用時間を待つ。DataChannelは確認前に閉じない。重複closeは同じPromiseを返す。
- CoreS3はDTLSを開始する役割で接続する。JSのイベント取得は一度に16件までとし、処理終了から20ms後に再予約する。
- ツールの重複実行を防ぎ、結果・送信待ち・ネイティブイベントの上限を維持する。ミュート解除の確認が失われたときはマイクを閉じたままにする。
- CoreS3の入力ゲート、音量、Opus設定、内部RAM／PSRAM配置、録音音源を差し込むCフックを維持する。再生不足の回数・累計無音・最長無音を取得できる。
- 標準のModdable SPI・Piuを使う。描画計測のリンク時ラッパーは`__tests__/manifest.performance.json`と`STACKCHAN_REALTIME_PERFORMANCE_PROBE=1`を指定した試験ビルドだけに含める。

## テストと出自

`node --test host/modules/realtime-conversation/__tests__/*.test.mjs`で通信を行わない会話・HTTP・トランスポートの回帰テストを実行する。ネイティブ部分はCoreS3のビルドと実機プローブで検証する。

本モジュールはmeganetaaan名義で開発したSDK forkの新規追加モジュールを移したもの。移植元コミットと原本のハッシュは`source-provenance.json`に記録する。独自実装のSDK用テンプレートヘッダーを整理し、Apache-2.0を適用する。Moddable・ESP-IDF・Espressifのコード自体を再ライセンスするものではない。依存物の条件は[ライセンス記録](LICENSES.md)を参照。
