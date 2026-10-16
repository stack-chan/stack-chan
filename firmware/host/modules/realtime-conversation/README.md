# RealtimeConversation

Stack-chanホスト向けのOpenAI互換会話モジュール。会話プロトコル、ツール実行、CoreS3のWebRTC音声処理を提供する。音声の送受信・Opus・I2Sはネイティブタスクで処理し、会話制御はMODのWorkerから呼び出す。

## 組み込み

ホストのマニフェストへ本ディレクトリーの`manifest.json`を追加する。公開モジュールは`realtimeConversation`、`realtimeConversation/core`、`/tools`、`/transport`、`/http`。CoreS3のネイティブ実装とホスト設定を含む。対応対象はM5StackChan CoreS3のみ。

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

公開型は`realtimeConversation.d.ts`。`apiKey`と`signaling`は排他的に指定する。認証・短期トークンの取得・エージェント設定・具体的なツール・履歴保存の方針は利用側で実装する。プロンプト、委譲先モデル、検索ツールは呼び出し側が指定し、hostでは追加しない。`tools`を直接登録する場合はResponses用の`delegation`設定も渡す。

HTTPS POSTはModdable標準のECMA-419 HTTPSクライアントを専用Worker内で使う。会話Workerから直接要求・応答を渡し、メインスレッドを経由しない。待機中を含む8要求の上限、待機時間を含む期限、128KiBの応答上限、証明書検証、リダイレクト禁止を維持する。TLSセッションキャッシュはSDKへ任せ、独自のネイティブHTTP・接続再利用処理は持たない。HTTP Workerの優先度は3で、呼び出し元VMとともに破棄される。

## 維持する動作

- `connect`は開始確認まで待ち、`close`は音声を止めてから提供元の終了確認・利用時間を待つ。DataChannelは確認前に閉じない。重複closeは同じPromiseを返す。
- CoreS3はDTLSを開始する役割で接続する。JSのイベント取得は一度に16件までとし、処理終了から20ms後に再予約する。
- ツールの重複実行を防ぎ、結果・送信待ち・ネイティブイベントの上限を維持する。ミュート解除の確認が失われたときはマイクを閉じたままにする。
- CoreS3の入力ゲート、音量、Opus設定、内部RAM／PSRAM配置、録音音源を差し込むCフックを維持する。再生不足の回数・累計無音・最長無音を取得できる。
- 標準のModdable SPI・Piuを使う。`io-performance`の時刻・音量レベル・優先度制御は通常版にも存在する。描画・I2S計測とタスク診断は別の計測構成で有効にし、通常版の計測フックは何もしない。

## テストと出自

`npm run test:unit`で会話・HTTP・トランスポートの回帰テストを実行する。ネイティブ部分はCoreS3のビルドと実機プローブで検証する。UIの行単位吹き出しは独立した追加APIで、会話モジュールは依存しない。

本モジュールはmeganetaaan名義で開発したSDK forkの新規追加モジュールを移したもの。移植元コミットと原本のハッシュは`source-provenance.json`に記録する。独自実装のSDK用テンプレートヘッダーを整理し、Apache-2.0を適用する。Moddable・ESP-IDF・Espressifのコード自体を再ライセンスするものではない。依存物の条件は[ライセンス記録](LICENSES.md)を参照。
