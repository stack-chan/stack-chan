# WASM録音の所有と停止確認

F2 / F3 / F9の録音経路を扱う。公開SDKの録音・再生API、AppSessionの音声所有、会話と音声出力の調停は後続の作業であり、この変更だけで完了とはしない。

## 所有者と境界

| 層 | 所有するもの | 終了時の責務 |
| --- | --- | --- |
| WASM Microphone | 一つの録音識別子、ポーリングと期限のTimer、取消し購読 | 自分の録音を停止し、ブラウザーの解放確認後に完了する |
| C bridge | XSへコピーする録音バッファ | 識別子をブラウザーへ渡す。音声入力のPromiseや状態を重ねて保持しない |
| Browser AudioIn | getUserMediaの継続処理、MediaStream、MediaRecorder、データ変換、停止期限 | 停止通知とデータ変換の終了を待ち、すべての入力trackを止める |
| WasmView | ホストに接続したBrowser AudioInの寿命 | 再起動ではsuspendを待ち、次のVM起動直前にresumeする。破棄ではcloseを開始し、その失敗も観測する |

識別子は同じブラウザーサービスで再利用中のものと重ならない。古いMicrophoneのstop / closeが次の録音や音声出力を閉じることはない。録音結果をコピーした後、Microphoneがブラウザー側の識別子を返す。WASM側の音声出力closeは出力だけを対象とする。

MediaRecorderのstopは状態を同期的に変更するが、最後のdataavailableとstopイベントは後で配送される。そのため、状態がinactiveになったことだけでは解放を確認しない。[MediaStream Recording仕様](https://w3c.github.io/mediacapture-record/)に従い、stopイベントまでを一つの録音として所有する。

## 成功・取消し・失敗

- 成功は、要求期間の録音が止まり、非空の録音データをまとめ、入力trackを止めた後とする。個々のチャンクを独立した音声とは扱わない。
- ブラウザーが返したMIME typeとファイル拡張子をXSのArrayBufferへ付与する。WebM / OpusをWAVとして扱わない。C側で長さを検査し、XSが所有するArrayBufferへ全バイトをコピーする。
- 未対応のMediaRecorder・形式・マイク環境はUNSUPPORTED。空の録音を成功として返さず、不要な許可要求も送らない。
- 取消しとcloseは、それぞれCANCELLED / CLOSEDを返す。録音結果のPromiseとstop / closeの解放待ちを分け、取消しそのものを解放失敗として扱わない。
- 許可拒否、空・不整合なデータ、取得・開始の失敗はIO。取得済み資源を解放できれば次の録音を許可する。
- 停止・track解放・Timer解放の失敗は保持し、同じ所有者での後続録音を拒否する。一箇所の解放失敗でも他の解放を試す。

## 上限と遅延した許可

`firmware/contracts/audio-recording.js`をnativeとWASM、Webの共通定義とする。既定3秒、指定可能期間は1〜15,000ms、録音バッファは最大512KiB。ブラウザー側は取得準備30秒、通常の停止・変換に1秒、取消し時の停止確認に2秒の期限を持つ。WASM側にも準備・録音と停止確認の期限を置く。

512KiBは録音データの上限であり、変換・コピーを含むピークメモリー量ではない。ブラウザー側の保持識別子は4件、同時に取得する入力は1件、チャンク数は256件までに制限する。

許可待ち中のgetUserMedia自体には、このサービスから確実に中断する手段がない。取消し後に入力が届いた場合は、その継続処理が取得したtrackを直ちに止め、MediaRecorderを開始しない。期限内に解放を確認できなければTIMEOUTとし、入力の再利用と次のVMの起動を止める。古いPromiseの結果を空の成功へ変換しない。

遅れた許可要求やデータ変換が実際に終わり、すべての資源を解放できた場合は、次のsuspendでその状態を確認してから再起動できる。物理的な解放処理自体が失敗したサービスは再利用しない。

## 検証方法

- Webの注入可能なMediaRecorder試験で、100回の成功・取消し、停止通知待ち、遅延した許可・拒否、データ変換中の終了、上限と解放失敗を検証する。
- XSの`wasm-microphone-lifecycle`で、実Timerを使う100回の録音と取消し、購読とTimerの回収、識別子の一度だけの返却、停止確認待ちと失敗の保持を検証する。以前のNode上のWASM Microphone試験3件はここへ移した。
- `web/simulator/recording-visual.mjs`は、生成したWASMホストへ専用MODを読み込み、ChromiumのMediaRecorderが作った録音の長さ・バイト和・形式をC境界の前後で比較する。同じ録音のWeb Audio再生、取消し、録音中・許可待ち中の再起動、WasmViewの破棄も検証する。

ブラウザー試験用MODは内部実装の結合試験であり、初学者向け教材やV2 SDKの使用例として配布しない。実行手順:

```sh
# firmware/から。通常のModdable / ESP-IDF / Emscripten環境を設定しておく。
npm run build:wasm
npm run mod:build -- host/modules/audio/__tests__/wasm-recording-browser/manifest.json --mode=release

# web/から
npm run build
node simulator/recording-visual.mjs
```

試験のビルドが型エラーで失敗した場合、TypeScriptが先に出力したJavaScriptを次回の成功判定に使わない。XS試験runnerは失敗した対象の生成物を破棄し、準備ビルドの失敗も全体の失敗として扱う。WASMビルドもmake失敗時にその対象の途中出力を破棄する。
