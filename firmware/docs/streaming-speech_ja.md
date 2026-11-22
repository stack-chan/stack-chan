# TTSのストリーミング合成

`TTS.open()` で作った1つの `Synthesis` に文章を順に渡せます。セッション中は同じ `output` を使います。最初の合成を始める前に、`output` をPCMの接続先へつなぎます。

| 操作 | 完了時に保証すること |
| --- | --- |
| `write(text)` | 文章の受付が完了した |
| `flush()` | 受け付けた文章のPCMを接続先に渡し終えた。次の文章を引き続き追加できる |
| `endInput()` | 入力を閉じ、残りのPCMを接続先に渡して出力を終了した |
| `close()` | 合成を中断し、処理中の資源の解放を待った |

```ts
await synthesis.write('こんにちは。')
await synthesis.flush()
await synthesis.write('今日は何をしますか。')
await synthesis.endInput()
```

スピーカーの再生完了は `PlaybackSink.finish(outputId)` で待ちます。`flush()` と `endInput()` は合成したPCMの受け渡しまでを待ちます。

## sanoTTSの区間合成

sanoTTSは空でない区間ごとにネイティブ合成器を開きます。接続先がPCMを受け取るまで、合成器はそのバッファを保持します。ひとつのセッションは、1区間512コード単位、合計4,096 UTF-16コード単位、64区間まで受け付けます。

`flush()` の間に `write()` または `flush()` を呼ぶと `device_busy` が返ります。`endInput()` は進行中の `flush()` を待ち、繰り返し呼んだ場合は同じPromiseを返します。ネイティブ資源の解放に失敗した場合、`close()` は失敗を返してsanoTTSのセッション予約を保持します。

OpenAI SpeechとStackchanVoiceの契約は [会話用アダプターの実装ガイド](./stackchan-voice-adapters.md) を参照してください。
