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

`defineApp` は `apiVersion: 2` とsetupを持つ定義を作ります。既定動作も同じ定義で起動します。インストールされたMODへの既定フックの継承はありません。setupは登録後に返り、アプリはホストが閉じるまで動作します。setupの失敗時は登録を解除し、同じ失敗を開始元へ返します。setupは任意で同期disposerを返せます。終了後に遅れて返ったdisposerも実行します。

配布用の `stackchan-mod.json` には schema 2 / app API 2 と必要な host API 世代を記録します。教材では世代2を要求し、標準 manifest の `data` で同梱しています。XS のコンパイル版とは別の検査です。CLI・WebSerial の接続状況と、旧 MOD・SD・WASM・起動時の移行上の制約は [MOD の互換性検査](../../docs/architecture/mod-package-compatibility.md) を参照してください。

| API | 完了と所有 |
| --- | --- |
| `face.setEmotion` / `setMouthOpen` / `setColor` | 同期更新。色0〜255、開度0〜1。未知の名前や不正値はエラー |
| `audio.say(text, options?)` | 自由文の発話完了を待つ。素材名として解釈しない |
| `audio.playClip(name, options?)` | ローカル音声素材の再生完了を待つ。名前には拡張子やパスを含めない |
| `audio.tone(hz, { durationMs, volume?, signal? })` | 10〜20,000 Hz、0〜60,000 ms、音量0〜1。再生と出力解放を待つ |
| `audio.record({ durationMs?, signal? })` | 入力を解放してから録音データを返す。省略時3秒 |
| `audio.play(audio, { volume?, signal? })` | 録音などの音声データを再生する。発話・素材・toneと同じ出力キューで直列化 |
| `motion.move({ yawDeg, pitchDeg }, { durationMs, timeoutMs?, completion?, signal? })` | 指定時間の軌道を送り終えるまで待つ。位置を読める機種では到達も確認。結果は `measured` または `estimated` |
| `camera.capture({ width?, height?, format?, signal? })` | 一枚をコピーし、元フレーム解放・カメラ停止後に返す |
| `camera.info` | 使用可否と対応画像形式を取得 |
| `ui.showImage(image)` / `hideImage()` | RGB565画像を表示。置換・非表示・アプリ終了で表示を外す |
| `motion.info` | 使用可否、位置フィードバック、トルク解除の可否、設定済みの角度範囲を取得 |
| `motion.lookAt(target)` / `lookAway()` | 注視先を設定・解除。単発移動を優先し、終了後に最新の注視先へ戻る |
| `motion.relax()` | host API 4以上。停止を待ち、対応するドライバーのトルク解除完了を待つ。`canRelax: false` は `UNSUPPORTED` |
| `motion.stop()` | 注視と待機中の移動を取り消し、進行中の動作の停止処理を待つ |
| `input.onPress('primary', handler)` | 購読を登録し解除関数を返す。同じhandlerの実行中は連打を追加実行しない |
| `time.sleep(durationMs)` | アプリに所属する待機。終了時にタイマーを解除してreject |
| `time.after(durationMs, handler)` | host API 4以上。一度だけ実行。解除関数は待機と実行中handlerの両方を取り消す |
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

## 声を録音して再生する

```js
app.input.onPress('primary', async (task) => {
  const audio = await app.audio.record({ durationMs: 3000, signal: task.signal })
  await app.audio.play(audio, { volume: 0.5, signal: task.signal })
})
```

`app.capabilities.get('audio.recording')` と `audio.playback` で機能の有無を確認できます。ブラウザーではマイクの使用許可が必要です。録音は1〜15,000ms、最大512 KiBで、戻り値は `data: ArrayBuffer`、実際の `mimeType` と `filename` を持ちます。機種側はPCM WAV、ブラウザー側はWebMやMP4などを返すため、形式をWAVと決めつけないでください。許可拒否を無音の録音に置き換えることはありません。

録音と再生は完了時に入力・出力を解放し、アプリ終了時にも停止します。再生中は渡したバイト列を変更しないでください。nativeのバッファ再生は16-bit PCM WAV、8〜48 kHz、モノラルまたはステレオに対応し、上限は3 MiB・60秒です。ブラウザーの再生形式はそのdecoderに依存します。

機能がない場合はUNSUPPORTED、不正な引数はINVALID_ARGUMENT、録音・再生の失敗はIO等でrejectします。未対応時とエラー時の案内も含む例は [07-recording](../lessons/07-recording/mod.js)、詳しい形式・所有の契約は [録音とバッファ再生](../../docs/architecture/sdk-recording-playback.md) にあります。

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

詳細な所有・停止契約と実機受入の残りは [motionの設計記録](../../docs/architecture/motion-operation-lifecycle.md) を参照してください。会話・設定の公開契約、残るMODとBlocklyの移行、実機および初学者による受入は引き続き未完了です。


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

## Piu の画面拡張

Piu を使う画面は `stackchan/extensions/piu` の `definePiuApp` で宣言します。基本 SDK の入口には Piu 型・コンストラクターを追加しません。初めてのプログラムは `defineApp` と7つの教材から始め、独自画面が必要になったときにこの拡張へ進んでください。

```ts
import { Behavior, Container, Skin, definePiuApp } from 'stackchan/extensions/piu'

export default definePiuApp({
  screens: [{
    id: 'hello',
    title: 'Hello',
    create({ app, close }) {
      return new Container(null, {
        left: 0, right: 0, top: 0, bottom: 0,
        active: true,
        skin: new Skin({ fill: '#93c5fd' }),
        Behavior: class extends Behavior {
          onTouchEnded() { app.face.setEmotion('happy'); close() }
        },
      })
    },
  }],
})
```

この例は青い画面を表示し、タップすると表情を変えて顔画面へ戻ります。

画面の登録、任意の `setup(app)`、入力・音声・motion は同じ `AppSession` に所属します。`create` に渡る `ScreenContext` は `{ width, height, app, close }` です。高さは AppBar の44pxを除きます。ホストの Application / controller は公開しません。画面は最大16個で、IDは小文字ASCII英数字と `. _ -` の区切りで1〜64文字、タイトルは空白を除いて1〜32文字です。

`create` は Piu `Container`、または `{ content: Container, dispose() }` を返します。開くたびに作り直し、「戻る」・`close()`・アプリ停止で破棄します。Piu `Port` のフレーム更新は画面の `onUndisplaying` で止めてください。画面固有の外部資源は `dispose` で解放します。`context.app.time.every` などの SDK 登録を画面だけの寿命にする場合は、返された解除関数をこの `dispose` で実行してください。アプリ全体の停止でも SDK 登録は解除されます。`dispose` は、画面を作成したが表示に失敗した場合にも呼ばれるため、非表示処理に依存せず解放できるようにします。

画面登録や setup が失敗した場合は、登録済み画面を巻き戻します。ホストの画面切替や `dispose` の例外でも後続の後片付けを実行し、アプリ停止時には失敗を呼出元へ返します。Piu 自体が処理するイベント callback の例外は、この停止 Promise に伝わるとは限りません。Piu の生の表示オブジェクトを使う拡張であり、通常の MOD と同じ実行 realm です。任意コードを隔離する sandbox ではありません。

配布には schema 2 / app API 2 / **host API 3**、`entrypoints: ["mod"]` と `capabilities: ["ui.piu"]` を宣言します。旧 `miniapp` archive は起動前に拒否されるので、旧ソースをこの契約に移して再ビルドしてください。`manifest.json` は通常の MOD と同じで、アプリ内の相対 import に使うファイルを `modules` に列挙します。[ミニゲーム集](../mods/examples/stackchan_minigames/mod.ts) と [UI Playground](../mods/examples/mini_app_ui_sample/mod.ts) が実行可能な例です。

`npm run check:sdk` は基本 SDK / 教材の `tsconfig.sdk.json` と、Piu 拡張 / 利用例の `tsconfig.extensions.json` を分けて strict 検査します。構成検査は全 API 2 パッケージを列挙し、`ui.piu` を宣言したものだけに Piu 拡張の import を許します。

SDK の TypeScript ソースは `stackchan` というローカル npm workspace としても解決します。`firmware/` で `npm ci` すると型の正本へリンクされ、通常の `mod:build` でも同じ型を使います。ホスト SDK の実装を MOD archive へ複製する必要はありません。Gallery のソースをリポジトリー内でビルドする場合は、`web/` でも `npm ci` を実行してください。別のプロジェクトから使う場合は SDK ディレクトリーを `stackchan` のローカル依存として設定します。このパッケージはまだ npm へ公開していません。

## メニュー・入力・LEDの拡張

host API 4以上では、Piuの生成を伴わない操作を専用の入口から取得できます。いずれも `setup(app)` と同じアプリに所属し、別のセッションやコントローラーを作りません。

```js
import { defineApp } from 'stackchan'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  setup(app) {
    const view = ui(app)
    view.addAction({ id: 'hello', label: 'Hello' }, async (task) => {
      view.closeMenu()
      await app.audio.say('こんにちは', { signal: task.signal })
    })
    view.addToggle({ id: 'happy', label: 'Happy', value: false }, (enabled) => {
      app.face.setEmotion(enabled ? 'happy' : 'neutral')
      view.setEmoticon(enabled ? 'heart' : null)
    })
  },
})
```

`addAction` は解除関数、`addChoice` / `addToggle` は `{ setValue, close }` を返します。選択項目には `options: [{ value, label, color? }]` を渡します。`color` は `#RRGGBB` の色見本です。`handler(value, task)` が成功した後に値を確定し、失敗時は前の表示へ戻します。実行中に `setValue` で変更した値を、古いhandlerの完了で上書きしません。同じ登録は実行中に再入せず、`close` とアプリ終了はhandlerのsignalも取り消します。

IDはPiu画面と同じ1〜64文字の小文字ASCII英数字と区切り `. _ -`、labelは空白だけを除く1〜160文字です。選択肢は最大32個、valueは1〜80文字で一意にします。アプリの登録上限64件を他の入力・タイマーと共有します。

`setFaceStyle` は `default / simple / dog / image`、`setHandAnimation` は `none / rock-paper-scissors / clap / thinking`、`setEmoticon` は `heart / angry / sweat / tear / sleepy / null` を受け取ります。`default` は本体設定の顔へ戻します。アプリ終了時は顔・色・表情・手・装飾を本体の初期状態へ戻します。`localize(key, parameters?)` は本体と同じ言語でアプリの辞書を解決します。[顔と翻訳メニューの実行例](../mods/examples/face/mod.js) と [ローカライズ](../docs/localization_ja.md) を参照してください。配布宣言は app API 2 / host API 4 / `capabilities: ["ui.controls"]` です。

`input(app)` を `stackchan/extensions/input` から取得すると、`onPress('primary' | 'secondary' | 'tertiary', handler)`、`onHeadTouch(handler)`、`onMotion(handler)` を使えます。ボタン名は利用できるA/B/Cの順番で、primaryだけはボタンのない機種でメニューの「実行」を使えます。head touchは `gesture` と任意の `tapDurationMs`、motionは `motion` を持つ読み取り専用イベントです。時間はmsで、raw device・ticks・ドライバーは渡しません。実行前に `capabilities.get('input.headTouch')` などで対応を調べます。購読解除とアプリ終了で処理を取り消し、最後のmotion購読解除でIMUのポーリングを止めます。

`lighting(app)` を `stackchan/extensions/lighting` から取得すると、`names` に実際に使えるLED名が並びます。`color(name, { r, g, b })`、`rainbow(name)`、`off(name)` を使い、アプリが使用したLEDは終了時に消灯します。WASMは出力bridgeを持たないため `lighting` は `unavailable` です。未検出のPY32も成功として扱いません。未対応は `UNSUPPORTED`、未知の名前は `INVALID_ARGUMENT`、機器例外は `IO` です。個々のLED範囲・点滅などの高度な操作は、残る旧サンプルの移行時に接続します。
