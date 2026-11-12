# CoreS3の録音終了時の再起動

## 症状と原因

Wi-Fi接続後、AI会話MODの「押して話す」を離すと端末が再起動した。CoreS3の実機では、WhisperのHTTPS要求開始時に `XS abort: native stack overflow` を記録した。Moddable SDK10.1.0の製品構成は、XSを実行するCタスクに10KiBのスタックを割り当てる。これはJavaScriptのスタックスロット数とは別の容量である。

録音バッファにも別の不足があった。会話MODの上限194,560 bytesとWAVヘッダー44 bytesを通常のUint8Arrayで確保すると、固定262,144 bytesのXS chunk領域をほぼ占める。独立したXSテストでは、この録音を保持しながら上限内の約30KiBのJSON応答を処理すると `XS abort: memory full` が再現した。実機で観測した直接の再起動原因はCスタック不足であり、このヒープ不足とは区別する。

## 修正

- 録音をSharedArrayBufferで確保する。録音中の約190KiBをXS chunk領域の外へ配置し、HTTPとJSON処理の領域を確保する。総メモリ使用量が減る変更ではない。closeは所有参照を外し、送信中の参照もなくなった後にGCが実体を回収する。
- HTTPSの初期化前にPromiseの継続へ移り、呼び出し元のCスタックを解放する。これだけでは実機の10KiBスタック不足は解消しなかった。
- 3種類のCoreS3プラットフォームで `creation.nativeStack` を15KiBにする。Cタスクの固定メモリを5KiB増やす。JSスタック768スロット、XS chunk容量、PCMフレームの処理、モジュール分割、公開I/Fは変更しない。

## 検証

2026-11-12、M5StackChan CoreS3、COM6、Moddable SDK10.1.0、ESP-IDF6.1、PR777とPR778の統合構成で確認した。

| 構成 | 結果 |
| --- | --- |
| 10KiB Cスタック、通常の録音バッファ | 録音終了後に再起動 |
| 10KiB Cスタック、SharedArrayBuffer、HTTPS初期化の非同期化 | HTTPS要求開始時にnative stack overflow |
| 15KiB Cスタック、同じ録音・HTTPS修正、計測ホスト | 5.5秒の録音を文字起こしでき、再起動なし。実行タスクのスタック残量の最小値は4,212 bytes |
| 診断用abort hookとネイティブ計測を除いた製品版ホスト | 5.5秒録音後、文字起こし、LLM応答、音声再生、会話ターンのcompletedを確認。起動回数は増加しなかった |

繰り返し試験では再起動はなかったが、別の受信キュー上限により `Responses consumer is too slow` で会話が失敗した。Cスタックと録音バッファの修正だけで全ての会話失敗が解消したとは判断しない。

回帰テストは、実Whisperアダプターの要求開始前のキャンセル、送信量の上限、共有バッファのoffset、HTTP失敗、タイムアウトを検証する。XSの固定chunkテストは上限の録音とJSON応答が共存できることを検証する。NodeだけではESP32のCスタック不足を検出できないため、実機の録音終了と再起動ログを別に確認する。

実行コマンドはfirmwareディレクトリで `npm run test:unit` と `npm run test:moddable -- host/modules/voice/__tests__/whisper-memory-device/manifest.test.json`を使う。メモリ回帰テストは `host/modules/voice/__tests__/whisper-memory-device/manifest.test.json`、HTTP回帰テストは `host/modules/audio/__tests__/whisper-request.test.ts` にある。

他のCoreS3機種、RealtimeConversationとの同時負荷、長時間連続使用のメモリ余裕は未計測である。4,212 bytesはこの試験中の観測値であり、全処理の最大スタック深さを保証しない。
