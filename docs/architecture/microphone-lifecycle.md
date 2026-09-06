# 録音の完了とマイクの寿命

この段階はnativeのMicrophoneと共通のRuntimeAudioの接続を扱う。録音をV2 SDKへ公開する作業とWASMの入力bridgeの整理は継続中である。

## 完了の契約

`record(durationMs, { signal })`は、要求したPCMフレームを全て受信し、入力の解放が完了してからWAVを返す。時間の既定値は3,000 ms、有効範囲は1〜15,000 ms。フレーム数は端数を切り上げる。WAVヘッダーを含む確保の上限は512 KiBで、サンプルレートにより15秒以内でも上限に達する。実機の空きメモリーを保証する値ではない。

短い読み取りは実際に返されたバイト数だけ進める。空の読み取り、不完全なフレーム、要求より大きな返却は`IO`とし、残りをゼロで埋めた成功結果にしない。受信が進まない場合は、要求時間に1,000 msの猶予を加えた期限で`TIMEOUT`となる。期限はSDKのJavaScript操作に対するものであり、プラットフォームのC関数が戻らない場合を強制中断するものではない。

| 条件 | 結果 |
| --- | --- |
| 不正な時間・バッファ上限超過 | `INVALID_ARGUMENT` |
| 録音中・入力の解放中の再開始 | `BUSY` |
| 取消し・`stop()` | `CANCELLED` |
| `close()`後の操作・終了中の録音 | `CLOSED` |
| 受信期限切れ | `TIMEOUT` |
| 不正なPCM・開始や解放の失敗 | `IO` |

共通の`RuntimeAudio.record(durationMs, signal)`も同じ時間の検証と操作ごとの取消しを使う。待ち行列中の取消しでは、動作中の別の録音を止めない。返却形式は既存のOwnedAudioBufferを維持している。

## 取得と解放

入力はコンストラクターから取得した直後に所有者へ記録する。その後の形式確認、バッファ作成、取消し登録、期限設定、開始のいずれかが失敗しても入力を閉じる。完了・失敗・取消しで同じ終了処理を使い、Timerと購読を取り除く。解放失敗は成功として隠さず、そのMicrophoneでの再取得を拒否する。

各開始に世代を付け、通知元の入力と現在の入力も比較する。終了した入力の遅い通知は、新しい入力や利用者のonReadableを呼ばない。入力のcloseが戻るまで新しい取得を許可しない。`stop()`は再利用可能な終了、`close()`はそのMicrophoneの利用終了である。

SDK 9.5のESP32 AudioInには、onReadableを呼んでいる間はpendingCallbackが立ち、close時にはその通知が後で入力レコードを解放することを期待する処理がある。一方、その通知自身の実行中にcloseすると、以後の通知がない場合にレコードが残り得る。Microphoneは通知の実行中に閉じる要求を受けた場合、Promiseのjobへ解放を移す。SDKのxsCallFunctionから戻った後、ESP32の次のjobで閉じるため、現在の通知が終わってから解放できる。SDKのソースはmodules/io/audioin/esp32/audioin.cとxs/platforms/esp/xsHost.cを確認した。

このため`stop()`と`close()`は解放完了のPromiseを返すことがある。次の取得や所有者の終了では`await microphone.stop()` / `await microphone.close()`とする。共通のownMicrophoneもPromiseを返してResourceScopeに待たせる。既存の高頻度ストリーミング入力とAudioInの低レベルAPIは維持する。

## 試験と残る範囲

- XSの試験は実Timerと操作可能なAudioIn代替を使い、録音・取消し100回、短い読み取り、失敗時のrollback、期限、停止・再開、遅い通知、二重close、解放失敗を確認する。
- 代替入力は通知の呼び出し中にcloseされた回数も記録する。全入力のcloseが一度だけ行われ、その回数が0であることを検査する。
- Nodeは純粋なWAV構造・上限、注入したPromiseによるRuntimeAudioの取消しと非同期解放を検査する。以前のnative MicrophoneのNode試験4件はXSへ移した。

WASMの録音では、未対応を空バッファの成功にする経路、ポーリングTimer、入力と出力を同時に閉じるbridge、ブラウザー側の非同期操作の所有が残る。会話・USB・他の入力との物理資源の調停、V2 SDKと教材への公開、実機でのI2S・メモリー・音質・遅延の受入も継続する。今回の試験は実マイクによる受入ではない。
