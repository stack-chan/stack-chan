# STT・TTSアダプターを作る

通常の会話の構築は [音声会話ガイド](voice-quickstart.md) を参照してください。このページはPCMを供給・消費するバックエンド作者向けです。MODからは `stackchan/voice/adapters` をimportします。ホストのvoiceマニフェストに含まれるnamed exportなので、新しいホストに合わせてMODを再ビルドしてください。

```ts
import {
  createPcmSink, createPcmSource, subscribePcmSource, writeSink, mono,
} from 'stackchan/voice/adapters'
import type { STT, TTS, Synthesis } from 'stackchan/voice/adapters'
```

`AudioSource` はPCMの供給元、`AudioSink` はPCMの受取先です。独自に型をcastせず、上記の生成関数で作ります。フォーマットは符号付き16bit little-endian、monoまたはstereoです。チャンクの長さはフレームサイズの倍数にします。異なるサンプルレートを接続しても自動変換しません。

## PCMの所有権とbackpressure

```ts
const source = createPcmSource(mono(24000))
const samples = new Uint8Array(480)
const subscription = subscribePcmSource(source.output, {
  async write(bytes) {
    // 非同期の送信先がbytesを参照しなくなるまで待つ
    await consume(bytes)
  },
  end(error) {
    if (error) report(error)
  },
})
await source.push(samples)
// push完了後はsamplesを書き換えて再利用できる
source.end()
subscription.close()
```

この断片の `consume` と `report` はアダプター側が用意する関数です。`push` は全接続先の消費完了を待ちます。同期コールバックで使う `offer` は、待機不要なら `undefined`、待機が必要ならPromiseを返します。受取側はバッファを変更せず、返したPromiseがsettleした後は参照しません。同期の受取側はreturn後に参照しません。呼出側はその時点までバッファを保持し、上書きしません。

接続前のPCMは保存しません。接続を終えてから生成を開始してください。内部に無制限のキューはありません。前回の消費完了を待たずに次のPCMを送ると、遅れた接続先を `input_overrun` で切断します。会話の `MediaRuntime.connect` は設定されたメディア予算より大きいチャンクを拒否します。接続先は最大4つです。pre-rollを使う場合だけ、`createPcmSource(format, historyBytes)` の第二引数でフレーム境界に揃えた固定長の保存領域を指定します。会話の音声デバイス所有権を共有する機能ではありません。

`source.end()` は新しいPCMを拒否し、進行中の消費が終わってから接続先へ終了を通知します。`source.end(error)` は失敗を直ちに通知します。進行中のwriteに渡したバッファは、そのwriteがsettleするまで所有者が保持します。`subscription.close()` は購読の解除だけを行います。デバイスやプロバイダーの解放はアダプター所有者が行います。

STTの `Transcription.input` には `createPcmSink(format, write)` を返します。`write` のPromiseでバックプレッシャーを伝えます。単体試験などでsinkへ直接書く場合は `await writeSink(input, bytes)` を使います。`Transcription.finish()` は音声入力を終了して最終結果を待ち、`close()` は録音バッファや通信を解放します。ASRのsegment finalは利用者の発話終了や会話ターンのcommitとは別です。

## TTSの入力と出力

`TTS.capabilities.input` の `segmented` は、`write` で集めたテキストを `flush` または `endInput` で一つの要求として合成する方式です。`streaming` は要求を開いたままテキストを追加できる方式です。`output` の `streaming` はPCMを受信途中から供給すること、`buffered` は合成結果を揃えてから供給することを表します。入力と出力は独立した能力です。

`OpenAISpeechTTS` はsegmented入力・streaming出力です。双方向テキストストリームではありません。一つのSynthesisで次の順序が使えます。

```ts
const synthesis = await tts.open({ signal, voice: 'alloy', format: mono(24000) })
const link = await media.connect(synthesis.output, playbackSink, { signal, budget })
try {
  await synthesis.write('最初の文。')
  await synthesis.flush()
  await synthesis.write('次の文。')
  await synthesis.endInput()
  await link.done
  // スピーカーでの再生完了は、その所有者のPlaybackSink.finish(outputId)で待つ
} finally {
  await link.close()
  await synthesis.close()
}
```

`write` の完了はテキストの受付です。`flush` はそこまで受け付けた文の音声供給を待ち、入力とoutputを開いたままにします。`endInput` は入力を閉じ、進行中のflushと残りの文の供給を順に待ち、outputを終了します。同時・反復呼出しは同じ完了結果を返します。`flush` と `endInput` の完了はスピーカーでの再生完了ではありません。`close` は取消と資源解放です。

OpenAI実装では合成は同時に一件、待機テキストは4096文字までです。flush中に次の文をwriteできますが、もう一度flushする場合は前のflushをawaitしてください。同時flushは `device_busy`、文字上限超過は `resource_exhausted`、endInput後のwrite/flushは `cancelled` で拒否します。合成失敗後は新しいSynthesisを作ります。未入力のままendInputしてもHTTP要求を作らず、空のflushも要求を送りません。closeやsignalの中断は進行中のHTTPを取り消します。

文分割はTTSプロバイダーに隠さず、LLM出力を受ける会話層で行います。句読点での区切り、句読点がない場合の上限、末尾、取消、順序をそこで保ちます。`SpeechPlayback` は合成から再生までを持つ別のfacadeです。このSynthesisは音声Sourceを提供し、マイクやスピーカーのleaseを取得しません。

## 自作Agentの画像入力

`Agent.capabilities.image` は画像を受け取れるかを表します。`Agent.create()` はLLMの画像対応を引き継ぎます。自作Agentで省略すると画像非対応です。`run` が画像を処理できる場合だけ `capabilities: { image: true }` を宣言してください。CascadedConversationはこの宣言を `imageInput` に反映し、非対応の画像送信と画像を含む初期履歴を `unsupported_capability` で拒否します。拒否した画像を履歴へ残さないので、その後のテキスト会話に影響しません。
