# Gemini 音声のオフライン負荷試験

StopWatch 上で GeminiSpeechTTS の SSE / JSON / base64 処理、24→16 kHz の変換、現行 StopWatch 音声出力、Kasane の顔描画を同時に動かす診断用ファームウェアです。CascadedConversation 全体ではなく、TTS から現行 speaker adapter までを直接接続します。

## 実行範囲

- API、ネット接続、キー参照、マイク取得、設定保存は行いません。
- 音声は固定のゼロ PCM、出力音量も 0。実際の DMA 出力と drain の待機は省略しません。
- 8,192 バイトの SSE イベント 4 件相当を、decode-only（TTS→破棄）、raw-speaker（同量・同区切りの PCM→speaker）、full（TTS→speaker）の順に比較します。サイズは JSON と SSE 区切りを含み、PCM サイズではありません。続けて 65,536 バイトの full ケースも実行します。
- transport は最大 1,024 バイトずつ渡し、consumer の完了を待ちます。全イベントを fixture 側に保持しません。
- 起動後 1.5 秒で開始し、4 ケースを各 1 回実行して停止します。ケースごとの watchdog は 30 秒。リセットすると再実行します。

## ビルドのみ

firmware ディレクトリで、既存 StopWatch SDK 環境を使います。

```sh
node scripts/run-mcconfig.mjs -m -p esp32/m5stack_stopwatch -t build host/modules/muse-gadget/gemini-pressure-device/manifest.json
```

出力名は `gemini-pressure-stopwatch`。既存 build wrapper の変更は不要です。このコマンドには書込みを含めません。実機への書込みは通常版への復帰手順を用意して別途行います。

## 結果

シリアルの `GEMINI_PRESSURE` に続く JSON を確認します。

- `start` / `pass` / `fail`: ケース開始と結果。`done` は全ケース終了、`passed` はすべて成功したか。
- `mode`: `decode-only` / `raw-speaker` / `full`。raw-speaker は base64 / SSE を通しません。decode-only は出力デバイスを開きません。どのケースも同じ顔描画を動かします。
- `sinkCallMax` / `consumeCallMax`: 関数を呼び出して Promise が戻るまでの最大時間（ms）。`sinkAwaitMax` / `consumeAwaitMax` は await 完了までを含む最大時間。`sinkTotal` / `consumeTotal` は各呼出しの完了までの時間の合計です。consume は sink の待機を含むため両者は加算できません。sinkCallMax は変換・書込みの同期部分を含み、DMA だけの計測ではありません。
- `drainMs`: 最後の speaker drain に要した時間。decode-only は出力を開かないため実再生時間ではありません。
- `received`: TTS から出力へ渡した PCM バイト数。`pass` は期待数との一致と、speaker を使うケースでは drain 完了まで確認しています。
- `maximumLag`: 50 ms Timer の最大超過時間。`lateTicks` は 50 ms を超過した回数。顔の描画 FPS そのものではありません。
- `minimumInternal` / `minimumPsram`: このケース中の Timer サンプル最小値。瞬間的な底値を取り逃すことがあります。
- `internalMinimum`: ESP-IDF の起動以来の内部 heap 最低値。ケースごとにリセットされません。
- `elapsedMs`: 初期化、生成、再生、drain、最後の Timer サンプル待ちを含みます。ネットワーク遅延は含みません。

これは現在の作業ツリーの TTS / 出力を使います。過去版の再現や TLS のメモリ負荷を含む試験ではありません。`fatal` や結果が途中で途切れた場合は成功扱いにしません。watchdog も JS の Timer なので、イベントループが完全に停止すると発火できません。

## ホスト検証

```sh
node --test host/modules/muse-gadget/gemini-pressure-device/fixture.test.mjs
```

イベントの総サイズ、transport の上限、無音かつ偶数バイトの PCM、取消時の停止を検証します。実機のメモリ確保、時間特性、描画、DMA 動作はこのテストでは検証できません。

## 実機比較 (2026-11-17)

COM18 の同一 StopWatch、API/マイクなし、音量0、顔描画あり。8 KiB SSE 4件のPCMは24,216 B。

| 条件 | decode-only | full | full UI最大遅延 |
| --- | ---: | ---: | ---: |
| 変更前 | 30,765 msで期限切れ | 30,097 msで期限切れ | 10,286 ms |
| native base64 + ASCIIバイト検査 | 13,492 ms | 14,305 ms | 2,427 ms |
| 正規表現なしの行分割 | 4,199 ms | 4,822 ms | 89 ms |
| 受信を行単位で一括コピー | 1,027 ms | 1,626 ms | 95 ms |

最終版のraw-speakerは989 ms、内部RAM最小252,760 B。64 KiB SSE 4件（PCM196,248 B）も8,916 msで完了し、内部RAM最小252,760 B、PSRAM最小7,881,552 B。ただしUI最大遅延908 msは残る。64 KiBを超えるイベント制限は変更していない。

この結果はネットワークを含まない同一入力の比較。実Googleサービスとの会話、声の聞こえ方、物理画面の見た目の再確認は別途必要。途中で試したbase64全文字の正規表現検査は内部RAM最小124 Bまで悪化したため不採用。最終版はその検査を含まない。
