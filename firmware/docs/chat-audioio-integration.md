# Stack-chan の音声会話

MOD はマイク、会話、スピーカーを選んで `createConversationPipeline` に渡す。パイプラインは開始時に音声デバイスの使用権を取り、会話の終了処理を待って返す。1回の接続につき1個のパイプラインを作る。

```js
import { createConversationPipeline } from 'stackchan/voice'
import { createChatConversation } from 'chat'

const microphone = robot.audio.microphone
if (!microphone) throw new Error('この端末にはマイクがありません')

const pipeline = createConversationPipeline({
  microphone,
  speaker: robot.audio.speaker,
  conversation: createChatConversation({ config: chatConfig, tools }),
  mediaBudget: { maxBufferedMs: 2000, maxBufferedBytes: 128 * 1024 },
})
await pipeline.start()
// MOD の onClose や停止ボタンから呼ぶ。
await pipeline.close({ mode: 'abort' })
```

## 会話を差し替える

| 構成 | 会話の作り方 | 音声の経路 |
| --- | --- | --- |
| STT → LLM → TTS | `createCascadedConversation({ turnDetector, stt, agent, tts, voice })` | マイクから STT に PCM を渡し、TTS の PCM をスピーカーへ送る。 |
| ChatAudioIO | `createChatConversation({ config, tools, callbacks })` | provider の Worker が借用した PCM 入出力を使う。入力の空き容量を超えた場合はエラーを通知する。 |
| OpenAI Live | `createLiveConversation(options)` | CoreS3 の native WebRTC transport が借用した I2S を使う。JS では制御、transcript、tool call を処理する。 |

`mediaBudget` は音声をキューに保持する時間とバイト数の上限。モデルの履歴、HTTP、コーデック、WebRTC 自体が使うメモリはそれぞれの実装で管理する。`setMuted` は音声入力を切り替え、`interrupt` は再生済みの範囲と会話履歴の状態を返す。端末で聞こえた位置を特定できる精度はバックエンドによって異なる。

カスケード方式では、LLM が最終回答と明示したテキストを文単位で先に読み上げる。最終回答か判別できないモデルでは応答の完了を待つ。割り込まれたときは再生を終えた文までを履歴に残す。WebRTC の連続した音声には文と再生位置の対応がないため、割り込みは接続を終了し、`restart-required` を返す。続けて話すときは、新しいパイプラインを作って開始する。

## サンプルのバッファ設定

| MOD | PCM 経路に渡す上限 | 送受信の動作 |
| --- | --- | --- |
| `ai_stackchan` | 24 KiB、250 ms | マイク入力は 16 kHz、再生は 24 kHz。Whisper への送信用に約6秒分の音声を別途保持する。TTS の HTTP 受信はスピーカーに空きができるまで次の読み出しを待つ。 |
| `chat_audioio` | 128 KiB、2000 ms | 入力スロットは Worker が送信を終えた範囲から再利用する。SDK の WebSocket 送信待ちは別枠で 64 KiB まで。 |
| `openai_live_webrtc` | 128 KiB、1000 ms | CoreS3 の I2S と WebRTC の間はネイティブコードが送受信する。再生停止時はキューの静止を待ってデバイスを返す。 |

これらはキューの設定値。端末全体の空き RAM や会話の遅延を判断するには、実際の基板でネットワーク接続中に測定する。

## カメラとツール

`stackchan/ai` の LLM はテキスト・画像・関数定義を含むリクエストから1回の応答を生成する。`createToolSet` で関数定義と実装を対応づけ、`createAgent` に渡すとツールの実行結果を次の推論に渡せる。会話履歴はセッションが管理する。

`createVision({ camera: adaptRobotCamera(robot.camera), llm })` は質問を受けるたびに撮影し、画像と質問を LLM に送る。MOD が `observe` ツールとして登録すると、会話からも使える。

## 実装例

- [ボタンを押して話し、カメラで観察する](../mods/examples/ai_stackchan/mod.js)
- [ChatAudioIO の設定、顔や吹き出しへの反映](../mods/examples/chat_audioio/mod.js)
- [OpenAI Live の接続と終了](../mods/examples/openai_live_webrtc/session.js)
- [TypeScript の公開契約](../host/modules/voice/contracts.ts)
