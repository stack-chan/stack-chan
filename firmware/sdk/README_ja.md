# V2 SDK の実装契約

このブランチで実装済みの公開入口は `stackchan` です。公開型はこのディレクトリーのTypeScriptを正本とし、ホストの `capabilities` やテスト用の型を教材へ渡しません。再設計全体の進捗と未実装項目は[実装台帳](../../docs/architecture/firmware-sdk-redesign-progress.md)で管理します。

```js
import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    app.input.onPress('primary', async () => {
      await app.audio.tone(440, { durationMs: 200 })
      app.face.setEmotion('happy')
    })
  },
})
```

`defineApp` は `apiVersion: 2` とsetupを持つ定義を作ります。V2定義にはV1の既定動作をマージしません。setupは登録後に返り、アプリはホストが閉じるまで動作します。setupの失敗時は登録を解除し、同じ失敗を開始元へ返します。setupは任意で同期disposerを返せます。終了後に遅れて返ったdisposerも実行します。

配布用の `stackchan-mod.json` には schema 2 / app API 2 と必要な host API 世代を記録します。教材では世代2を要求し、標準 manifest の `data` で同梱しています。XS のコンパイル版とは別の検査です。CLI・WebSerial の接続状況と、旧 MOD・SD・WASM・起動時の移行上の制約は [MOD の互換性検査](../../docs/architecture/mod-package-compatibility.md) を参照してください。

| API | 完了と所有 |
| --- | --- |
| `face.setEmotion` / `setMouthOpen` / `setColor` | 同期更新。色0〜255、開度0〜1。未知の名前や不正値はエラー |
| `audio.say(text, options?)` | 自由文の発話完了を待つ。素材名として解釈しない |
| `audio.playClip(name, options?)` | ローカル音声素材の再生完了を待つ。名前には拡張子やパスを含めない |
| `audio.tone(hz, { durationMs, volume?, signal? })` | 音の再生操作を待つ。音量0〜1。音声操作は同じ出力キューで直列化 |
| `motion.move({ yawDeg, pitchDeg }, { durationMs, timeoutMs?, completion?, signal? })` | 指定時間の軌道を送り終えるまで待つ。位置を読める機種では到達も確認。結果は `measured` または `estimated` |
| `camera.capture({ width?, height?, format?, signal? })` | 一枚をコピーし、元フレーム解放・カメラ停止後に返す |
| `camera.info` | 使用可否と対応画像形式を取得 |
| `ui.showImage(image)` / `hideImage()` | RGB565画像を表示。置換・非表示・アプリ終了で表示を外す |
| `motion.info` | 使用可否、位置フィードバック、トルク解除の可否、設定済みの角度範囲を取得 |
| `motion.lookAt(target)` / `lookAway()` | 注視先を設定・解除。単発移動を優先し、終了後に最新の注視先へ戻る |
| `motion.stop()` | 注視と待機中の移動を取り消し、進行中の動作の停止処理を待つ |
| `input.onPress('primary', handler)` | 購読を登録し解除関数を返す。同じhandlerの実行中は連打を追加実行しない |
| `time.sleep(durationMs)` | アプリに所属する待機。終了時にタイマーを解除してreject |
| `time.every(intervalMs, handler)` | handlerの終了からintervalMs後に次回実行。例外は報告して周期処理を終了 |
| `ui.showBalloon(text)` / `hideBalloon()` | アプリの吹き出し。終了時に消去 |
| `capabilities.get(id)` | `native` / `simulated` / `unavailable` を取得。未対応時は理由を持つ |

有限の非同期操作はPromiseを返し、失敗は `StackchanError` の `code` で判別します。現在のコードは `INVALID_ARGUMENT`、`UNSUPPORTED`、`BUSY`、`TIMEOUT`、`CANCELLED`、`CLOSED`、`IO`、`CONFIG` です。終了後の操作は `CLOSED`。音声とmotionはそれぞれ待機8件、待機期限30秒、実行期限120秒、アプリの同時タスクと登録はそれぞれ64件を上限とします。

アプリ終了はすべてのSDK操作へ伝わります。個別の購読解除と操作取消しを結び付ける場合、handler引数の `task.signal` を音声・motion・撮影のoptionsへ渡します。`task.sleep` はこのsignalに最初から所属します。任意のJavaScript Promiseの内部処理を強制停止するものではありません。

```js
app.input.onPress('primary', async (task) => {
  await task.sleep(100)
  await app.audio.say('こんにちは', { signal: task.signal })
})
```

公開SDKと教材を `npm run check:sdk` でstrict検査します。構成検査はTypeScriptの構文木でSDKからホスト内部への依存がないことを確認し、コンパイラーが解決したファイル一覧で全教材の検査対象への包含を確認します。使用するTypeScript 7 APIは版に依存するため、開発依存は検証した版へ固定しています。

## 首の動作を待つ

```js
app.input.onPress('primary', async (task) => {
  const result = await app.motion.move(
    { yawDeg: 15, pitchDeg: 0 },
    { durationMs: 350, signal: task.signal },
  )
  app.ui.showBalloon(result.completion === 'measured' ? '到達を確認しました' : '動作指令が完了しました')
})
```

角度は校正した正面からの度数です。`yawDeg` の正はロボットから見た左、`pitchDeg` の負は上を向きます。範囲は `app.motion.info` から取得し、範囲外や `NaN` は `INVALID_ARGUMENT` になります。機種を判別して角度を補正する処理を教材へ書く必要はありません。

`durationMs` は0〜60,000msです。準備と初期位置の取得後に軌道時間を数え、0msでも最後の指令の送信を待ちます。`timeoutMs` は1〜120,000msで、キューから実行を始めた時点からの準備・軌道・到達確認を含む期限です。省略時は `durationMs + 5,000`。待機列にいる時間には別の30秒の期限があります。

位置を測れる機種では、軌道の最後に両軸が目標の±1°以内であることを50ms以上離れた2回の測定で確認し、`{ completion: 'measured' }` を返します。PWMとWASMは位置の実測を持たないので、最後の指令を送って `{ completion: 'estimated' }` を返します。これは実際の首や画面上のモデルが静止したという保証ではありません。実測が必要なら `completion: 'measured'` を指定し、未対応の機種では送信前に `UNSUPPORTED` を受け取ります。省略時と `'trajectory'` 指定時も、測定可能な機種は到達確認まで待ちます。

`lookAt` は最新の注視先を一つ保持します。単発の `move` が入ると注視動作を止め、単発移動の待機列が空になってから最新の注視先へ向き直ります。同じ注視先へ到達後は移動を追加し続けません。`lookAway` は解除要求を出して同期で返ります。

取消しを受けたアプリの処理は早くrejectする場合がありますが、内部の実行枠は停止処理が終わるまで保持します。停止処理を待つには `await app.motion.stop()` を使います。明示的なstopで移動は `CANCELLED`、停止中の新規受付は `BUSY` となります。位置を測れる機種では停止時の測定位置を保持し、PWMとWASMでは最後の指令位置を保持します。停止確認は2秒で期限となり、失敗した資源に次の移動を送らず、能力情報を `unavailable` にします。ホスト再起動を復旧境界とします。

アプリ終了も停止処理を待ち、対応機種のトルクを解除してdetachします。PWMはトルク解除を持たず `canRelax: false` です。物理PWMやUARTの解放はホスト終了時に行います。WASMは `availability: 'simulated'`、nativeのnone設定や必要なサーボ電源の未検出は `unavailable` です。

詳細な所有・停止契約と実機受入の残りは [motionの設計記録](../../docs/architecture/motion-operation-lifecycle.md) を参照してください。録音・会話・設定・Piu拡張のV2公開契約、全配布経路のV2互換性検査、既存MODの移行は引き続き未完了です。


## 一枚を撮って表示する

```js
app.input.onPress('primary', async (task) => {
  const image = await app.camera.capture({ width: 176, height: 144, signal: task.signal })
  app.ui.showImage(image)
})
```

撮影前に `app.camera.info.availability` を確認できます。利用できない機種は `unavailable`、ブラウザーのカメラ入力は `native`、明示的な合成画像は `simulated` です。ブラウザーの許可拒否や未取得を合成画像へ置き換えて成功にはしません。

`width` は1〜320、`height` は1〜240の整数です。省略値は176×144、形式は `rgb565le` です。対応形式は `app.camera.info.formats` で取得します。画像は実際の寸法、`format`、`source`、`data: ArrayBuffer` を持ち、nativeの手動解放は不要です。返却データは最大153,600 bytes。JPEGを取得できる機種でも、`ui.showImage` の対応形式はRGB565です。

撮影は一つずつ進め、待機2件、待機期限30秒、実行期限15秒、取消し時の停止確認2秒です。撮影中にアプリが終了すると取消します。画像を配列などに蓄積した場合のメモリーはアプリ自身が管理します。使用例は [06-camera](../lessons/06-camera/mod.js)、詳しい契約と移行事項は [撮影と画像表示](../../docs/architecture/camera-capture-lifecycle.md) にあります。
