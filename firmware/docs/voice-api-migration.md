# 音声APIの移行

このAPI変更のrelease impactは`major`です。会話MODは更新したホストと組み合わせて再ビルドしてください。既存のMODアーカイブを新しいホストへそのままロードすることはできません。

## 生成とimport

通常利用者は次のnamed exportを使います。生成はすべて`X.create(options)`です。戻り値の契約は型で定義され、実装がclassかobjectかには依存しません。

| import元 | 公開名 | 移行前 |
| --- | --- | --- |
| `stackchan/ai` | `OpenAIResponsesLLM` | `new OpenAIResponsesLLM(...)` |
| `stackchan/ai` | `ChatCompletionsLLM`, `ClaudeLLM`, `GeminiLLM` | `createChatCompletionsLLM`, `createClaudeLLM`, `createGeminiLLM` |
| `stackchan/ai` | `Agent`, `ToolSet`, `Vision` | `createAgent`, `createToolSet`, `createVision` |
| `stackchan/voice` | `ConversationPipeline`, `CascadedConversation`, `PushToTalk`, `VoiceScope` | 同名の`createX`関数 |
| `stackchan/voice/speech` | `WhisperSTT`, `OpenAISpeechTTS` | `createWhisperSTT`, `createOpenAISpeechTTS` |
| `chat` | `ChatConversation`, `XiaoZhiV1Connection` | `createChatConversation`, `createXiaozhiV1Connection` |
| `realtimeConversation` | `LiveConversation` | `createLiveConversation` |

```js
import { Agent, OpenAIResponsesLLM, ToolSet } from 'stackchan/ai'

const agent = Agent.create({
  llm: OpenAIResponsesLLM.create({ apiKey, model: 'gpt-4o-mini' }),
  tools: ToolSet.create(),
  instructions: '短く返答してください。',
  maxToolRounds: 1,
})
```

旧名の互換exportはありません。ホストのmanifestは公開module名を維持しますが、XSのMODリンクはnamed exportに依存するため、importの修正とアーカイブの再生成が必要です。通常のMODから`stackchan-ai-core`など内部moduleのfactoryをimportしないでください。

TypeScriptのMODで`stackchan/ai`・`stackchan/voice`・`stackchan/voice/speech`を使うときは、SDKの`manifest_mod.json`に加えて`firmware/typings/voice-api/manifest.json`をincludeしてください。パスはMODのmanifestからの相対パスです。[最小例のmanifest](../mods/examples/minimal_voice/manifest.json)を参照できます。この型専用manifestはホストの実ソースから型を再exportし、実装をMODへ重複収録しません。公開型の変化はMODビルド時に検査されます。

## マイクと再生方式

`pipeline.setMuted(value)`は`pipeline.setMicrophoneMuted(value)`へ変更します。対象はマイク入力です。開始前にも設定でき、開始時に適用されます。出力音量は`pipeline.setVolume(value)`で独立して設定します。

`robot.audio.useSpeechPlayback(player)`は`robot.audio.setSpeechPlayback(player)`へ変更します。戻り値は取り外したplayerです。音声処理が終わった後、戻り値を同じメソッドに渡して元へ戻します。

`SpeechPlayback`は音声合成から再生までを実行するfacadeです。runtimeは取り付けたplayerを借用して口パクのコールバックを設定し、差し替え時に古いコールバックを外します。runtimeはplayerをcloseしません。playerの作成者が、runtimeから取り外した後に必要な資源の解放を行います。

会話の`TTS`は音声Sourceを生成します。再生完了はスピーカー側で待ちます。入力終了の`endInput()`、継続可能な区切りの`flush()`、取消と解放の`close()`を区別してください。対応する入出力の形式は各TTSの`capabilities`に従います。

## 確認

`firmware`で`npm run test:unit`と`npm run check:architecture`を実行します。XSでのnamed export解決は`provider-dialogues`の`dialogue-smoke`と`dialogue-chatgpt`、最小例の型チェックでも確認します。MODのアーカイブ生成には`npm run mod:build -- mods/examples/ai_stackchan/manifest.json`を使います。`npm run mod`は実機への書き込みを行うため、ビルドだけの確認には使いません。
